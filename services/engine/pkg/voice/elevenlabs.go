// Package voice convierte texto en locución (text-to-speech) usando la API REST de
// ElevenLabs. Se usa desde el motor de video para sumar la voz al .mp4 de la nota.
//
// Referencia: .agents/skills/elevenlabs-skills/text-to-speech (endpoint, modelos y
// voice_settings). No se usa el SDK: es un único POST y evita una dependencia nueva.
package voice

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	apiBase = "https://api.elevenlabs.io"

	// Daniel: voz masculina "authoritative", pensada para noticias. Se cambia con ELEVENLABS_VOICE_ID.
	defaultVoiceID = "onwK4e9ZLuTAKqWW03F9"
	// Multilingüe v2: buena calidad en español y estable en textos cortos.
	defaultModelID = "eleven_multilingual_v2"

	// Tope duro de caracteres por locución: protege los créditos de ElevenLabs de un
	// texto desbordado (el guion legítimo de un video de ~15s ronda los 200-300).
	MaxTextChars = 600

	requestTimeout = 45 * time.Second
)

// Client sintetiza voz y cachea el audio en disco: un mismo texto+voz+modelo se paga
// una sola vez aunque el video se re-renderice (el modal del Feed re-renderiza en
// cada cambio del Editor de video).
type Client struct {
	apiKey  string
	voiceID string
	modelID string
	speed   float64
	// Perfil de voz_settings, ver references/voice-settings.md de la skill.
	stability       float64
	similarityBoost float64
	style           float64
	useSpeakerBoost bool
	cacheDir        string
	http            *http.Client
}

// Defaults del perfil "News / Professional" de references/voice-settings.md: tono
// estable y sobrio, poca exageración de estilo.
const (
	defaultStability       = 0.8
	defaultSimilarityBoost = 0.6
	defaultStyle           = 0.0
)

// NewClientFromEnv devuelve nil si ELEVENLABS_API_KEY no está configurada: la locución
// queda desactivada y los videos se generan mudos, como hasta ahora.
//
// Variables (todas opcionales salvo la key): ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID,
// ELEVENLABS_SPEED (0.7–1.2, default 1.0), ELEVENLABS_STABILITY (0.0–1.0, default 0.8),
// ELEVENLABS_SIMILARITY_BOOST (0.0–1.0, default 0.6), ELEVENLABS_STYLE (0.0–1.0, default 0.0).
func NewClientFromEnv(cacheDir string) *Client {
	key := strings.TrimSpace(os.Getenv("ELEVENLABS_API_KEY"))
	if key == "" {
		log.Println("[Voice] ELEVENLABS_API_KEY no configurada: los videos se generarán sin locución.")
		return nil
	}

	c := &Client{
		apiKey:          key,
		voiceID:         envOr("ELEVENLABS_VOICE_ID", defaultVoiceID),
		modelID:         envOr("ELEVENLABS_MODEL_ID", defaultModelID),
		speed:           envFloat("ELEVENLABS_SPEED", 1.0, 0.7, 1.2),
		stability:       envFloat("ELEVENLABS_STABILITY", defaultStability, 0.0, 1.0),
		similarityBoost: envFloat("ELEVENLABS_SIMILARITY_BOOST", defaultSimilarityBoost, 0.0, 1.0),
		style:           envFloat("ELEVENLABS_STYLE", defaultStyle, 0.0, 1.0),
		useSpeakerBoost: true,
		cacheDir:        cacheDir,
		http:            &http.Client{Timeout: requestTimeout},
	}
	_ = os.MkdirAll(cacheDir, 0755)
	log.Printf("[Voice] ✅ ElevenLabs listo (voz %s, modelo %s, velocidad %.2f, estabilidad %.2f, similitud %.2f, estilo %.2f).",
		c.voiceID, c.modelID, c.speed, c.stability, c.similarityBoost, c.style)
	return c
}

func envOr(name, def string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return def
}

// envFloat lee una variable numérica opcional dentro de [min, max]; ante valor
// ausente, no numérico o fuera de rango, cae al default (con log en este último caso).
func envFloat(name string, def, min, max float64) float64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v < min || v > max {
		log.Printf("[Voice] %s inválido ('%s', rango %.1f–%.1f), usando %.2f", name, raw, min, max, def)
		return def
	}
	return v
}

// Speech devuelve la ruta a un .mp3 con la locución de text (desde caché si ya existía).
// El archivo pertenece a la caché: el llamador NO debe borrarlo.
func (c *Client) Speech(ctx context.Context, text string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("texto vacío")
	}
	if r := []rune(text); len(r) > MaxTextChars {
		log.Printf("[Voice] ⚠️ Texto de %d caracteres excede el tope (%d): se recorta", len(r), MaxTextChars)
		text = string(r[:MaxTextChars])
	}

	settingsKey := strconv.FormatFloat(c.speed, 'f', 2, 64) + "," +
		strconv.FormatFloat(c.stability, 'f', 2, 64) + "," +
		strconv.FormatFloat(c.similarityBoost, 'f', 2, 64) + "," +
		strconv.FormatFloat(c.style, 'f', 2, 64)
	sum := sha1.Sum([]byte(c.voiceID + "|" + c.modelID + "|" + settingsKey + "|" + text))
	key := hex.EncodeToString(sum[:])[:10]
	cached := filepath.Join(c.cacheDir, hex.EncodeToString(sum[:])+".mp3")
	if st, err := os.Stat(cached); err == nil && st.Size() > 0 {
		log.Printf("[Voice] ♻️ Caché HIT [%s]: %d caracteres, %d bytes (sin gastar créditos)", key, len([]rune(text)), st.Size())
		return cached, nil
	}
	log.Printf("[Voice] Caché MISS [%s]: sintetizando %d caracteres (voz=%s modelo=%s velocidad=%.2f estabilidad=%.2f similitud=%.2f estilo=%.2f) → %q",
		key, len([]rune(text)), c.voiceID, c.modelID, c.speed, c.stability, c.similarityBoost, c.style, previewText(text, 120))

	payload, _ := json.Marshal(map[string]any{
		"text":     text,
		"model_id": c.modelID,
		"voice_settings": map[string]any{
			"stability":         c.stability,
			"similarity_boost":  c.similarityBoost,
			"style":             c.style,
			"speed":             c.speed,
			"use_speaker_boost": c.useSpeakerBoost,
		},
		// Que cifras, fechas y siglas se lean como palabras.
		"apply_text_normalization": "on",
	})

	endpoint := fmt.Sprintf("%s/v1/text-to-speech/%s?output_format=mp3_44100_128", apiBase, url.PathEscape(c.voiceID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("xi-api-key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "audio/mpeg")

	started := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		log.Printf("[Voice] ❌ [%s] Falló la petición a ElevenLabs tras %s: %v", key, time.Since(started).Round(time.Millisecond), err)
		return "", fmt.Errorf("petición a ElevenLabs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		log.Printf("[Voice] ❌ [%s] ElevenLabs respondió %d en %s: %s (401=key inválida, 422=voice_id/model_id inválido, 429=límite/créditos)",
			key, resp.StatusCode, time.Since(started).Round(time.Millisecond), strings.TrimSpace(string(body)))
		return "", fmt.Errorf("ElevenLabs respondió %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	audio, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("leyendo audio: %w", err)
	}
	if len(audio) == 0 {
		return "", fmt.Errorf("ElevenLabs devolvió audio vacío")
	}

	// Escritura atómica: un audio a medias jamás debe quedar como caché válida.
	tmp := cached + ".tmp"
	if err := os.WriteFile(tmp, audio, 0644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, cached); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	log.Printf("[Voice] ✅ [%s] Audio recibido: %d bytes en %s, guardado en caché", key, len(audio), time.Since(started).Round(time.Millisecond))
	return cached, nil
}

func previewText(s string, max int) string {
	r := []rune(strings.Join(strings.Fields(s), " "))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max]) + "…"
}
