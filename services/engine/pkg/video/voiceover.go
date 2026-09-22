package video

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"github.com/prensa-abierta/ingestor-engine/pkg/voice"
)

const (
	// Silencio inicial antes de hablar: que la voz no arranque pegada al primer frame.
	voiceLeadInSec = 0.3
	// Cola libre al final: la locución nunca llega a tocar el último frame.
	voiceTailSec = 0.5
	// Máximo que se acelera el audio para que entre en el video. Más que esto suena
	// apurado; en ese caso se recorta (con fade) en vez de acelerar más.
	voiceMaxTempo = 1.25
)

// SetVoice activa la locución con el cliente de ElevenLabs dado (nil la desactiva).
func (e *Engine) SetVoice(c *voice.Client) { e.voice = c }

// applyVoiceover convierte req.VoiceText en voz y la mezcla al video ya renderizado
// (sobrescribe outputPath). Devuelve el estado para job.VoiceStatus. Es de "mejor
// esfuerzo": ante cualquier error deja el video mudo original intacto.
func (e *Engine) applyVoiceover(ctx context.Context, job *models.VideoJob, outputPath string) string {
	text := strings.TrimSpace(job.Request.VoiceText)
	if text == "" {
		log.Printf("[Voice] Job %s: sin voice_text, el video sale mudo", job.ID)
		return ""
	}
	if e.voice == nil {
		log.Printf("[Voice] Job %s: se pidió locución pero ELEVENLABS_API_KEY no está configurada, video mudo", job.ID)
		return "disabled"
	}
	log.Printf("[Voice] Job %s: iniciando locución (%d palabras, %d caracteres) para \"%s\"",
		job.ID, len(strings.Fields(text)), len([]rune(text)), job.Request.Headline)

	fail := func(err error) string {
		log.Printf("[VideoEngine] Warning: locución omitida para %s: %v", job.ID, err)
		return "failed: " + err.Error()
	}

	audioPath, err := e.voice.Speech(ctx, text)
	if err != nil {
		return fail(err)
	}

	videoDur := float64(job.Request.DurationSec)
	if videoDur <= 0 {
		videoDur = 12
	}
	audioDur, err := e.mediaDuration(ctx, audioPath)
	if err != nil {
		return fail(fmt.Errorf("duración del audio: %w", err))
	}

	// El audio debe caber entre el lead-in y la cola: el límite del video manda.
	room := videoDur - voiceLeadInSec - voiceTailSec
	if room < 1 {
		return fail(fmt.Errorf("video demasiado corto (%.1fs) para locución", videoDur))
	}
	filter := voiceFilter(audioDur, room)
	switch {
	case audioDur <= room:
		log.Printf("[Voice] Job %s: audio %.2fs cabe en el video (%.2fs disponibles de %.0fs): sin ajustes", job.ID, audioDur, room, videoDur)
	case audioDur/voiceMaxTempo <= room:
		log.Printf("[Voice] Job %s: audio %.2fs excede %.2fs disponibles: se acelera x%.2f (filtro: %s)", job.ID, audioDur, room, audioDur/room, filter)
	default:
		log.Printf("[Voice] Job %s: ⚠️ audio %.2fs NO entra ni acelerado a x%.2f (%.2fs disponibles): se recorta con fade (filtro: %s). El guion es demasiado largo",
			job.ID, audioDur, voiceMaxTempo, room, filter)
	}

	muxed := outputPath + ".voice.mp4"
	defer os.Remove(muxed)

	args := []string{
		"-y",
		"-i", outputPath,
		"-i", audioPath,
		"-filter_complex", "[1:a]" + filter + "[a]",
		"-map", "0:v", "-map", "[a]",
		"-c:v", "copy", // el video ya está codificado: solo se agrega la pista de audio
		"-c:a", "aac", "-b:a", "128k",
		"-movflags", "+faststart",
		muxed,
	}
	if out, err := exec.CommandContext(ctx, e.ffmpegPath, args...).CombinedOutput(); err != nil {
		return fail(fmt.Errorf("mezclando audio: %v (salida: %s)", err, tailString(string(out), 400)))
	}
	if err := os.Rename(muxed, outputPath); err != nil {
		return fail(err)
	}

	log.Printf("[VideoEngine] 🔊 Locución agregada a %s (audio %.1fs, video %.0fs)", job.ID, audioDur, videoDur)
	return "ok"
}

// voiceFilter arma la cadena de filtros de audio: si la locución no entra en `room`
// segundos, la acelera hasta voiceMaxTempo y recorta el resto con un fade-out corto;
// luego agrega el lead-in de silencio. Función pura.
func voiceFilter(audioDur, room float64) string {
	var parts []string
	dur := audioDur
	if dur > room {
		tempo := dur / room
		if tempo > voiceMaxTempo {
			tempo = voiceMaxTempo
		}
		parts = append(parts, fmt.Sprintf("atempo=%.3f", tempo))
		dur /= tempo
	}
	if dur > room {
		// Aun acelerada al máximo no entra: corte duro con fade para no dejar un clic.
		parts = append(parts,
			fmt.Sprintf("atrim=0:%.2f", room),
			fmt.Sprintf("afade=t=out:st=%.2f:d=0.3", room-0.3))
	}
	delayMs := int(voiceLeadInSec * 1000)
	parts = append(parts, fmt.Sprintf("adelay=%d|%d", delayMs, delayMs))
	return strings.Join(parts, ",")
}

var durationRe = regexp.MustCompile(`Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)`)

// mediaDuration lee la duración de la salida de `ffmpeg -i` (así no se depende de
// que ffprobe esté instalado aparte).
func (e *Engine) mediaDuration(ctx context.Context, path string) (float64, error) {
	cmd := exec.CommandContext(ctx, e.ffmpegPath, "-i", path)
	var buf bytes.Buffer
	cmd.Stderr = &buf
	_ = cmd.Run() // sale con error por no tener output; solo interesa el stderr
	m := durationRe.FindStringSubmatch(buf.String())
	if m == nil {
		return 0, fmt.Errorf("no se encontró Duration en la salida de ffmpeg")
	}
	h, _ := strconv.ParseFloat(m[1], 64)
	mi, _ := strconv.ParseFloat(m[2], 64)
	s, _ := strconv.ParseFloat(m[3], 64)
	d := h*3600 + mi*60 + s
	if d <= 0 {
		return 0, fmt.Errorf("duración inválida")
	}
	return d, nil
}

func tailString(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
