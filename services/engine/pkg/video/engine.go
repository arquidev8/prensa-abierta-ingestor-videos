package video

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"github.com/prensa-abierta/ingestor-engine/pkg/voice"
)

// defaultRenderQueueSize is how many jobs can wait in the queue before
// Enqueue starts rejecting new requests with backpressure (503).
const defaultRenderQueueSize = 100

// defaultRenderTimeout bounds how long a single FFmpeg render may run
// before its context is cancelled by the worker that picked it up.
// 3 min: una composición puede encadenar descarga de imagen líder + descarga de
// clip de b-roll (Pexels) + 2 transcodes + concat + overlay. La descarga de cada
// recurso remoto está acotada aparte (downloadToTempFile), así que este límite
// cubre el peor caso realista sin colgar el worker pool indefinidamente.
const defaultRenderTimeout = 3 * time.Minute

// Engine handles video assembly and rendering via FFmpeg
type Engine struct {
	ffmpegPath  string
	assetsDir   string
	outputDir   string
	defaultLogo string
	promoImage  string        // banner "Descarga la App GRATIS", solo para el template "app-promo"
	voice       *voice.Client // nil = locución desactivada (sin ELEVENLABS_API_KEY)

	mu   sync.Mutex // protege jobs y las mutaciones de sus campos
	jobs map[string]*models.VideoJob

	queue         chan string
	workerCount   int
	renderTimeout time.Duration
}

// NewEngine creates a new FFmpeg video rendering engine.
// workerCount define el tamaño del worker pool que limita cuántos renders
// de FFmpeg corren en paralelo; si es <= 0 se usa un valor por defecto de 2.
//
// logoURL/promoImageURL son opcionales: si vienen configurados (banco de
// logos migrado a Cloudinary, ver .doc/context.md), el logo/banner se
// descarga UNA VEZ al arrancar y se cachea en la misma ruta local que ya
// usa el resto del código (`defaultLogo`/`promoImage`), sin cambiar nada
// más del pipeline de render. Si la descarga falla o las URLs están
// vacías, se usa el archivo local existente bajo `assetsDir/logos` (mismo
// comportamiento que antes de Cloudinary).
func NewEngine(ffmpegPath, assetsDir, outputDir string, workerCount int, logoURL, promoImageURL string) *Engine {
	if ffmpegPath == "" {
		ffmpegPath = os.Getenv("FFMPEG_PATH")
		if ffmpegPath == "" {
			ffmpegPath = "ffmpeg"
		}
	}

	_ = os.MkdirAll(outputDir, 0755)
	_ = os.MkdirAll(assetsDir, 0755)

	logoPath := filepath.Join(assetsDir, "logos", "prensa_abierta_logo.png")
	promoPath := filepath.Join(assetsDir, "logos", "descargar-app-gratis.jpg")

	downloadAssetIfConfigured(logoURL, logoPath)
	downloadAssetIfConfigured(promoImageURL, promoPath)

	if workerCount <= 0 {
		workerCount = 2
	}

	return &Engine{
		ffmpegPath:    ffmpegPath,
		assetsDir:     assetsDir,
		outputDir:     outputDir,
		defaultLogo:   logoPath,
		promoImage:    promoPath,
		jobs:          make(map[string]*models.VideoJob),
		queue:         make(chan string, defaultRenderQueueSize),
		workerCount:   workerCount,
		renderTimeout: defaultRenderTimeout,
	}
}

// StartWorkers lanza el worker pool de tamaño fijo que consume la cola de
// renders. Limita cuántos procesos FFmpeg corren simultáneamente, evitando
// que una ráfaga de POST /api/video/render sature la CPU del servidor.
func (e *Engine) StartWorkers() {
	for i := 0; i < e.workerCount; i++ {
		go e.workerLoop(i)
	}
	log.Printf("[VideoEngine] Worker pool iniciado con %d workers (cola máx. %d)", e.workerCount, defaultRenderQueueSize)
}

func (e *Engine) workerLoop(workerID int) {
	for jobID := range e.queue {
		ctx, cancel := context.WithTimeout(context.Background(), e.renderTimeout)
		if _, err := e.RenderVideo(ctx, jobID); err != nil {
			log.Printf("[VideoEngine worker %d] Error renderizando job %s: %v", workerID, jobID, err)
		}
		cancel()
	}
}

// Enqueue agrega un job a la cola de renderizado para que un worker lo
// procese de forma asíncrona. Devuelve error si la cola está llena, en vez
// de bloquear indefinidamente al llamador (backpressure explícito).
func (e *Engine) Enqueue(jobID string) error {
	select {
	case e.queue <- jobID:
		return nil
	default:
		return fmt.Errorf("cola de renderizado llena, intente más tarde")
	}
}

// CheckFFmpegAvailability tests if ffmpeg executable is functional
func (e *Engine) CheckFFmpegAvailability() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, e.ffmpegPath, "-version")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg no disponible en '%s': %v (salida: %s)", e.ffmpegPath, err, string(output))
	}
	return nil
}

// CreateJob registers a new video render job
func (e *Engine) CreateJob(req models.VideoRenderRequest) *models.VideoJob {
	jobID := uuid.New().String()
	if req.DurationSec <= 0 {
		req.DurationSec = 12
	}
	if req.Resolution == "" {
		req.Resolution = "1080x1920"
	}

	job := &models.VideoJob{
		ID:        jobID,
		Request:   req,
		Status:    "queued",
		Progress:  0,
		CreatedAt: time.Now(),
	}

	e.mu.Lock()
	e.jobs[jobID] = job
	e.mu.Unlock()
	return job
}

// GetJob retrieves the status of a render job
func (e *Engine) GetJob(jobID string) (*models.VideoJob, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	job, exists := e.jobs[jobID]
	return job, exists
}

// RenderVideo executes FFmpeg to assemble a 10-15s vertical video
func (e *Engine) RenderVideo(ctx context.Context, jobID string) (*models.VideoJob, error) {
	e.mu.Lock()
	job, exists := e.jobs[jobID]
	e.mu.Unlock()
	if !exists {
		return nil, fmt.Errorf("trabajo %s no encontrado", jobID)
	}

	e.mu.Lock()
	job.Status = "processing"
	job.Progress = 10
	e.mu.Unlock()

	outputFilename := fmt.Sprintf("video_%s_%s.mp4", job.Request.NewsID, job.ID)
	outputPath := filepath.Join(e.outputDir, outputFilename)

	log.Printf("[VideoEngine] Iniciando renderizado de video para '%s' (Duración: %ds, Salida: %s)",
		job.Request.Headline, job.Request.DurationSec, outputPath)

	// Build FFmpeg command
	err := e.executeFFmpegRender(ctx, job, outputPath)
	if err != nil {
		e.mu.Lock()
		job.Status = "failed"
		job.Error = err.Error()
		e.mu.Unlock()
		log.Printf("[VideoEngine ERROR] Fallo renderizado de %s: %v", jobID, err)
		return job, err
	}

	// Locución (opcional): nunca falla el render, a lo sumo el video queda mudo.
	voiceStatus := e.applyVoiceover(ctx, job, outputPath)

	now := time.Now()
	e.mu.Lock()
	job.VoiceStatus = voiceStatus
	job.Status = "completed"
	job.Progress = 100
	job.OutputPath = outputPath
	job.OutputURL = "/videos/" + outputFilename
	job.CompletedAt = &now
	e.mu.Unlock()

	log.Printf("[VideoEngine ✅] Video generado exitosamente: %s", outputPath)
	return job, nil
}

func (e *Engine) executeFFmpegRender(ctx context.Context, job *models.VideoJob, outputPath string) error {
	req := job.Request
	total := req.DurationSec
	if total <= 0 {
		total = 12
	}
	leadImage := strings.TrimSpace(req.LeadImageURL)

	// Nada que componer → cadena de fallbacks (plantilla → imagen destacada → color).
	if len(req.ClipURLs) == 0 && leadImage == "" {
		if !req.NoCategoryFallback {
			if catVideo := e.findCategoryTemplateVideo(req.Category); catVideo != "" {
				req.ClipURLs = []string{catVideo}
			}
		}
		if len(req.ClipURLs) == 0 {
			if req.ImageURL != "" {
				return e.renderImageZoomVideo(ctx, job, outputPath, req.ImageURL, total)
			}
			return e.renderFallbackColorVideo(ctx, job, outputPath)
		}
	}

	// Solo imagen temática, sin video → animarla durante toda la duración.
	if len(req.ClipURLs) == 0 && leadImage != "" {
		return e.renderImageZoomVideo(ctx, job, outputPath, leadImage, total)
	}

	// Cache de base b-roll pre-renderizada: permite cambiar texto, tipografía y estilos
	// en ~2s sin volver a descargar, recortar ni transcodificar los clips crudos.
	baseCacheDir := filepath.Join(e.outputDir, "base_cache")
	_ = os.MkdirAll(baseCacheDir, 0755)
	lo := layoutFor(req.Template)
	lo.boxColor, lo.boxOpacity = "black", 0.85
	lo.headFontSize, lo.headColor, lo.headX = headlineFontSize, "white", 74
	lo.showLogo, lo.logoSize, lo.logoX = true, 240, "W-w-60"
	lo.headFontFile = e.fontFileFor("classic")
	lo = e.applyStyleOverrides(lo, req.Style)

	headlineText := resolveHeadlineText(req)
	// Calcular dinámicamente el ancho de línea para que NUNCA se corte por la derecha
	maxChars := computeMaxCharsPerLine(lo.headFontSize, lo.headX, lo.headFontFile)
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headlineText), maxChars, headlineMaxLines)
	// Ajustar reactivamente titular, banner y caja de fondo para que NUNCA se corte abajo
	lo = adjustLayoutForContent(lo, cleanHeadline, lo.headFontSize)
	if cardPath, err := e.generateRoundedCardPNG(1000, lo.cardH, 32, lo.boxColor, lo.boxOpacity); err == nil {
		lo.cardImagePath = cardPath
	}

	baseHashKey := fmt.Sprintf("%s|%s|%.2f|%d|%t|%s|%s|%d",
		strings.Join(req.ClipURLs, ";"), leadImage, req.LeadImageSec, total, req.NoCategoryFallback, req.Category, lo.transition, lo.shotCount)
	baseHash := fmt.Sprintf("%x", sha1.Sum([]byte(baseHashKey)))
	baseVideoPath := filepath.Join(baseCacheDir, fmt.Sprintf("base_%s.mp4", baseHash))

	videoFilter := strings.Join([]string{
		// Punto pulsante + rótulo "ULTIMA HORA • CATEGORÍA"
		e.categoryHeaderFilters(req.Category, lo),
		// Headline text con alineación y salto de línea dinámico
		e.buildHeadlineDrawtext(cleanHeadline, lo),
	}, ",")

	encodeArgs := []string{"-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-threads", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}

	if stat, err := os.Stat(baseVideoPath); err == nil && stat.Size() > 0 {
		log.Printf("[VideoEngine ⚡] Reutilizando base b-roll pre-renderizada en caché (%s)", baseVideoPath)
		inputArgs := []string{"-i", baseVideoPath}
		args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, total, lo)
		cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("error al ejecutar FFmpeg: %v (salida: %s)", err, string(output))
		}
		return nil
	}

	// Prepare temporary list for concatenation
	tempDir := filepath.Join(e.outputDir, "temp_"+job.ID)
	_ = os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)

	var preparedClips []string
	var clipDurations []float64

	targetShots := lo.shotCount
	if targetShots <= 0 {
		targetShots = 3 // 3 tomas por defecto para dinamismo moderno
	}
	transName := lo.transition
	if transName == "" {
		transName = "fade"
	}
	transDur := 0.45
	if transName == "cut" || transName == "none" {
		transDur = 0.0
	}

	// Cantidad de clips de video a utilizar
	maxVideoClips := targetShots
	if leadImage != "" && maxVideoClips > 1 {
		maxVideoClips--
	}
	nClips := len(req.ClipURLs)
	if nClips > maxVideoClips {
		nClips = maxVideoClips
	}

	totalClips := nClips
	if leadImage != "" {
		totalClips++
	}
	if totalClips <= 0 {
		totalClips = 1
	}

	// Solapamiento total absorbido por las transiciones xfade
	totalRawDuration := float64(total) + float64(totalClips-1)*transDur

	// Segmento de imagen temática como PRIMER clip (imagen fija con zoom corto).
	imageSec := 0.0
	if leadImage != "" {
		imageSec = req.LeadImageSec
		if imageSec <= 0 {
			imageSec = 3.5
			if totalClips >= 4 {
				imageSec = 2.8
			}
		}
		if imageSec > 5 {
			imageSec = 5
		}
		if imageSec > totalRawDuration-2 {
			imageSec = totalRawDuration - 2
		}
		if imageSec < 1.5 {
			imageSec = 0 // muy poco tiempo: se omite la imagen
		}
		if imageSec > 0 {
			if seg, err := e.prepareImageSegment(ctx, tempDir, leadImage, imageSec); err == nil {
				preparedClips = append(preparedClips, seg)
				clipDurations = append(clipDurations, imageSec)
			} else {
				log.Printf("[VideoEngine] Warning: no se pudo preparar la imagen líder %s: %v", leadImage, err)
				imageSec = 0
			}
		}
	}

	// Clips de video para el tiempo restante.
	remaining := totalRawDuration - imageSec
	if remaining < 1 {
		remaining = totalRawDuration
	}
	clipDuration := remaining
	if nClips > 0 {
		clipDuration = remaining / float64(nClips)
	}

	videoClipsAdded := 0
	for i := 0; i < nClips; i++ {
		clipURL := req.ClipURLs[i]
		isImg := isImageClipURL(clipURL)

		inputPath := clipURL
		if strings.HasPrefix(clipURL, "http://") || strings.HasPrefix(clipURL, "https://") {
			ext := ".mp4"
			timeout := 60 * time.Second
			if isImg {
				ext = ".jpg"
				timeout = 20 * time.Second
			}
			local, derr := e.getOrDownloadMedia(ctx, clipURL, ext, timeout)
			if derr != nil {
				log.Printf("[VideoEngine] Warning: no se pudo descargar el clip %s: %v", clipURL, derr)
				continue
			}
			inputPath = local
		}

		trimmedPath := filepath.Join(tempDir, fmt.Sprintf("clip_%d.mp4", i))

		var args []string
		if isImg {
			secInt := int(clipDuration + 0.999)
			args = []string{
				"-y",
				"-loop", "1", "-t", fmt.Sprintf("%.2f", clipDuration),
				"-i", inputPath,
				"-filter_complex", "[0:v]" + coverImageFilter(secInt) + ",fps=30,format=yuv420p[cf_out]",
				"-map", "[cf_out]",
				"-c:v", "libx264",
				"-preset", "ultrafast",
				"-threads", "0",
				"-pix_fmt", "yuv420p",
				"-an",
				trimmedPath,
			}
		} else {
			// Scale & Crop to 9:16 (1080x1920) and trim
			filter := "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p"
			args = []string{
				"-y",
				"-t", fmt.Sprintf("%.2f", clipDuration),
				"-i", inputPath,
				"-vf", filter,
				"-c:v", "libx264",
				"-preset", "ultrafast",
				"-threads", "0",
				"-pix_fmt", "yuv420p",
				"-an",
				trimmedPath,
			}
		}

		cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("[VideoEngine] Warning: no se pudo procesar clip %s: %v (out: %s)", clipURL, err, string(out))
			continue
		}
		preparedClips = append(preparedClips, trimmedPath)
		clipDurations = append(clipDurations, clipDuration)
		videoClipsAdded++
	}

	// Ningún clip de video se pudo preparar (Pexels caído, URLs muertas, etc.): animar la imagen
	if videoClipsAdded == 0 {
		if leadImage != "" {
			return e.renderImageZoomVideo(ctx, job, outputPath, leadImage, total)
		}
		if req.ImageURL != "" {
			return e.renderImageZoomVideo(ctx, job, outputPath, req.ImageURL, total)
		}
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}

	// Ensamblar base de video con tomas y transiciones (xfade o concat)
	tempBasePath := filepath.Join(tempDir, fmt.Sprintf("base_%s.mp4", job.ID))
	if err := e.assembleBaseVideo(ctx, tempDir, preparedClips, clipDurations, transName, tempBasePath); err != nil {
		return fmt.Errorf("ensamblar base de video con tomas y transiciones: %w", err)
	}

	_ = os.Rename(tempBasePath, baseVideoPath)
	inputArgs := []string{"-i", baseVideoPath}
	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, total, lo)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error al ejecutar FFmpeg: %v (salida: %s)", err, string(output))
	}

	return nil
}

// assembleBaseVideo concatena los clips preparados aplicando transiciones fluidas
// (xfade: fade, slide, fadeblack) o corte limpio (concat demuxer), garantizando
// dinamismo visual en el Reel sin cortes bruscos.
func (e *Engine) assembleBaseVideo(ctx context.Context, tempDir string, clips []string, durations []float64, transition string, outPath string) error {
	if len(clips) == 0 {
		return fmt.Errorf("no hay clips para concatenar")
	}
	if len(clips) == 1 || transition == "cut" || transition == "none" {
		concatListFile := filepath.Join(tempDir, "concat.txt")
		if err := writeConcatFile(concatListFile, tempDir, clips); err != nil {
			return err
		}
		baseArgs := []string{
			"-y",
			"-f", "concat", "-safe", "0", "-i", concatListFile,
			"-c:v", "libx264", "-preset", "ultrafast", "-threads", "0",
			"-pix_fmt", "yuv420p", "-an",
			outPath,
		}
		cmd := exec.CommandContext(ctx, e.ffmpegPath, baseArgs...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("concat error: %w (%s)", err, string(out))
		}
		return nil
	}

	transName := "fade"
	switch transition {
	case "slide":
		transName = "slideleft"
	case "fadeblack":
		transName = "fadeblack"
	case "fade":
		transName = "fade"
	}

	const transDur = 0.45
	var filterParts []string
	currentStream := "[0:v]"
	accumulatedDuration := durations[0]

	for i := 1; i < len(clips); i++ {
		offset := accumulatedDuration - transDur
		if offset < 0 {
			offset = 0
		}
		nextStream := fmt.Sprintf("[%d:v]", i)
		outStream := fmt.Sprintf("[v%d]", i)
		if i == len(clips)-1 {
			outStream = "[vfinal]"
		}
		filterParts = append(filterParts, fmt.Sprintf("%s%sxfade=transition=%s:duration=%.2f:offset=%.2f%s",
			currentStream, nextStream, transName, transDur, offset, outStream))
		currentStream = outStream
		dur := 4.0
		if i < len(durations) {
			dur = durations[i]
		}
		accumulatedDuration = accumulatedDuration + dur - transDur
	}

	filterGraph := strings.Join(filterParts, ";")
	var args []string
	args = append(args, "-y")
	for _, c := range clips {
		args = append(args, "-i", c)
	}
	args = append(args,
		"-filter_complex", filterGraph,
		"-map", "[vfinal]",
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-threads", "0",
		"-pix_fmt", "yuv420p",
		"-an",
		outPath,
	)

	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[VideoEngine] Warning: xfade falló (%v: %s), recurriendo a corte limpio", err, string(out))
		concatListFile := filepath.Join(tempDir, "concat.txt")
		if werr := writeConcatFile(concatListFile, tempDir, clips); werr != nil {
			return werr
		}
		fbArgs := []string{
			"-y",
			"-f", "concat", "-safe", "0", "-i", concatListFile,
			"-c:v", "libx264", "-preset", "ultrafast", "-threads", "0",
			"-pix_fmt", "yuv420p", "-an",
			outPath,
		}
		cmdFallback := exec.CommandContext(ctx, e.ffmpegPath, fbArgs...)
		if fbout, fberr := cmdFallback.CombinedOutput(); fberr != nil {
			return fmt.Errorf("fallback concat error: %w (%s)", fberr, string(fbout))
		}
	}
	return nil
}

func writeConcatFile(concatListFile, tempDir string, clips []string) error {
	var contents strings.Builder
	for _, clip := range clips {
		relativePath, err := filepath.Rel(tempDir, clip)
		if err != nil {
			return fmt.Errorf("resolver la ruta del clip %q: %w", clip, err)
		}
		contents.WriteString(fmt.Sprintf("file '%s'\n", filepath.ToSlash(relativePath)))
	}
	if err := os.WriteFile(concatListFile, []byte(contents.String()), 0644); err != nil {
		return fmt.Errorf("escribir %q: %w", concatListFile, err)
	}
	return nil
}

// coverImageFilter encuadra CUALQUIER imagen (retrato, apaisada o cuadrada) en el
// lienzo vertical 1080x1920 SIN recortar al sujeto: la imagen completa se ajusta
// centrada (`force_original_aspect_ratio=decrease`) y el espacio sobrante se rellena
// con una copia ampliada y desenfocada de la misma imagen (estilo Reels/TikTok).
//
// Antes se hacía un `crop` central del lienzo lleno (`...=increase,crop`), que
// cortaba a cualquier sujeto descentrado — p. ej. una foto de agencia donde la
// persona aparece a un lado (caso reportado: Mbappé quedaba cortado).
//
// Se le suma un zoom lento (~6%) para dar algo de movimiento; NO se usa `zoompan`,
// que combinado con `-loop 1` dispara muchísimos más frames de los pedidos.
//
// El string NO lleva prefijo `[0:v]` ni etiqueta final: quien lo use debe
// anteponer la etiqueta de entrada y encadenar (`,drawtext…`) o etiquetar la
// salida según su contexto (`-vf`, `-filter_complex`, dentro de buildRenderArgs).
// imageClipExtRe detecta si una URL de "clip" apunta en realidad a una imagen
// (el Editor de video del front permite importar una imagen en el slot de
// video), mirando la extensión del path — ignora query string.
var imageClipExtRe = regexp.MustCompile(`(?i)\.(jpe?g|png|webp|gif)(\?|$)`)

func isImageClipURL(u string) bool {
	return imageClipExtRe.MatchString(u)
}

func coverImageFilter(dur int) string {
	if dur < 1 {
		dur = 1
	}
	return fmt.Sprintf(
		"split=2[cf_bg][cf_fg];"+
			"[cf_bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"+
			"boxblur=luma_radius=20:luma_power=2,eq=brightness=-0.12:saturation=0.85[cf_bgb];"+
			"[cf_fg]scale=1080:1920:force_original_aspect_ratio=decrease[cf_fgf];"+
			"[cf_bgb][cf_fgf]overlay=(W-w)/2:(H-h)/2,"+
			"scale=w='1080*(1+0.06*min(t/%d,1))':h='1920*(1+0.06*min(t/%d,1))':eval=frame,"+
			"crop=1080:1920,setsar=1",
		dur, dur,
	)
}

// prepareImageSegment renderiza una imagen fija (URL) a un .mp4 corto con zoom, con
// los MISMOS parámetros que los clips de video (1080x1920, 30fps, yuv420p, h264)
// para poder concatenarlo como PRIMER segmento de la composición. Devuelve la ruta
// del archivo generado en tempDir.
func (e *Engine) prepareImageSegment(ctx context.Context, tempDir, imageURL string, sec float64) (string, error) {
	localImg, err := e.getOrDownloadMedia(ctx, imageURL, ".jpg", 20*time.Second)
	if err != nil {
		return "", err
	}

	out := filepath.Join(tempDir, "clip_lead_image.mp4")
	secInt := int(sec + 0.999)
	args := []string{
		"-y",
		"-loop", "1", "-t", fmt.Sprintf("%.2f", sec),
		"-i", localImg,
		// -filter_complex (no -vf) porque coverImageFilter usa split/overlay.
		"-filter_complex", "[0:v]" + coverImageFilter(secInt) + ",fps=30,format=yuv420p[cf_out]",
		"-map", "[cf_out]",
		"-c:v", "libx264", "-preset", "ultrafast",
		"-threads", "0",
		"-pix_fmt", "yuv420p",
		"-an",
		out,
	}
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	if o, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("ffmpeg segmento de imagen: %v (salida: %s)", err, string(o))
	}
	return out, nil
}

// renderImageZoomVideo genera el reel completo a partir de UNA imagen (URL) con
// zoom corto durante toda la duración + overlays (caja, rótulo, titular, logo).
// Se usa cuando no hay ningún clip de video (banco propio, Pexels ni destacada).
func (e *Engine) renderImageZoomVideo(ctx context.Context, job *models.VideoJob, outputPath, imageURL string, durationSec int) error {
	req := job.Request
	duration := durationSec
	if duration <= 0 {
		duration = 12
	}

	localImagePath, err := e.getOrDownloadMedia(ctx, imageURL, ".jpg", 20*time.Second)
	if err != nil {
		log.Printf("[VideoEngine] Warning: no se pudo descargar la imagen %s: %v", imageURL, err)
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}

	lo := layoutFor(req.Template)
	lo.boxColor, lo.boxOpacity = "black", 0.85
	lo.headFontSize, lo.headColor, lo.headX = headlineFontSize, "white", 74
	lo.showLogo, lo.logoSize, lo.logoX = true, 240, "W-w-60"
	lo.headFontFile = e.fontFileFor("classic")
	lo = e.applyStyleOverrides(lo, req.Style)

	headlineText := resolveHeadlineText(req)
	// Calcular dinámicamente el ancho de línea para que NUNCA se corte por la derecha
	maxChars := computeMaxCharsPerLine(lo.headFontSize, lo.headX, lo.headFontFile)
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headlineText), maxChars, headlineMaxLines)
	lo = adjustLayoutForContent(lo, cleanHeadline, lo.headFontSize)
	if cardPath, err := e.generateRoundedCardPNG(1000, lo.cardH, 32, lo.boxColor, lo.boxOpacity); err == nil {
		lo.cardImagePath = cardPath
	}

	baseImgKey := fmt.Sprintf("%s|%d", imageURL, duration)
	baseImgHash := fmt.Sprintf("%x", sha1.Sum([]byte(baseImgKey)))
	baseCacheDir := filepath.Join(e.outputDir, "base_cache")
	_ = os.MkdirAll(baseCacheDir, 0755)
	baseImagePath := filepath.Join(baseCacheDir, fmt.Sprintf("base_img_%s.mp4", baseImgHash))

	encodeArgs := []string{"-r", "30", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}

	var inputArgs []string
	var videoFilter string

	if stat, err := os.Stat(baseImagePath); err == nil && stat.Size() > 0 {
		log.Printf("[VideoEngine ⚡] Reutilizando imagen base pre-renderizada en caché (%s)", baseImagePath)
		inputArgs = []string{"-i", baseImagePath}
		videoFilter = strings.Join([]string{
			e.categoryHeaderFilters(req.Category, lo),
			e.buildHeadlineDrawtext(cleanHeadline, lo),
		}, ",")
	} else {
		// Primera vez: renderizar base animada con coverImageFilter a baseImagePath
		tempBaseImgPath := filepath.Join(baseCacheDir, fmt.Sprintf("base_img_%s_%s.tmp.mp4", baseImgHash, job.ID))
		defer os.Remove(tempBaseImgPath)
		prepArgs := []string{
			"-y",
			"-loop", "1", "-t", fmt.Sprintf("%d", duration),
			"-i", localImagePath,
			"-filter_complex", "[0:v]" + coverImageFilter(duration) + ",fps=30,format=yuv420p[out]",
			"-map", "[out]",
			"-c:v", "libx264", "-preset", "ultrafast", "-threads", "0",
			"-pix_fmt", "yuv420p", "-an",
			tempBaseImgPath,
		}
		cmdPrep := exec.CommandContext(ctx, e.ffmpegPath, prepArgs...)
		if _, err := cmdPrep.CombinedOutput(); err == nil {
			_ = os.Rename(tempBaseImgPath, baseImagePath)
			inputArgs = []string{"-i", baseImagePath}
			videoFilter = strings.Join([]string{
				e.categoryHeaderFilters(req.Category, lo),
				e.buildHeadlineDrawtext(cleanHeadline, lo),
			}, ",")
		} else {
			inputArgs = []string{"-loop", "1", "-t", fmt.Sprintf("%d", duration), "-i", localImagePath}
			videoFilter = strings.Join([]string{
				coverImageFilter(duration),
				e.categoryHeaderFilters(req.Category, lo),
				e.buildHeadlineDrawtext(cleanHeadline, lo),
			}, ",")
		}
	}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, duration, lo)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[VideoEngine] Warning: no se pudo renderizar desde la imagen %s: %v (salida: %s)", imageURL, err, string(output))
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}
	return nil
}

// renderFallbackImageVideo: compat — anima la imagen destacada de la noticia.
func (e *Engine) renderFallbackImageVideo(ctx context.Context, job *models.VideoJob, outputPath string) error {
	return e.renderImageZoomVideo(ctx, job, outputPath, job.Request.ImageURL, job.Request.DurationSec)
}

// getOrDownloadMedia descarga una URL a una carpeta de caché persistente (outputDir/media_cache)
// usando sha1(url) + extensión. Si el archivo ya existe y tiene tamaño > 0,
// se devuelve directamente SIN descargar por red (0 ms).
func (e *Engine) getOrDownloadMedia(ctx context.Context, mediaURL, ext string, timeout time.Duration) (string, error) {
	cacheDir := filepath.Join(e.outputDir, "media_cache")
	_ = os.MkdirAll(cacheDir, 0755)

	h := sha1.New()
	h.Write([]byte(mediaURL))
	cachedFile := filepath.Join(cacheDir, hex.EncodeToString(h.Sum(nil))+ext)

	if stat, err := os.Stat(cachedFile); err == nil && stat.Size() > 0 {
		return cachedFile, nil
	}

	tmpFile, err := os.CreateTemp(cacheDir, "dl_*"+ext)
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", err
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", fmt.Errorf("status HTTP %d al descargar %s", resp.StatusCode, mediaURL)
	}

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", err
	}
	tmpFile.Close()

	if err := os.Rename(tmpPath, cachedFile); err != nil {
		if stat, statErr := os.Stat(cachedFile); statErr == nil && stat.Size() > 0 {
			os.Remove(tmpPath)
			return cachedFile, nil
		}
		return tmpPath, nil
	}

	return cachedFile, nil
}

// downloadToTempFile descarga una URL a un archivo temporal en outputDir y
// devuelve su ruta local. El llamador es responsable de borrarlo (defer os.Remove).
// `pattern` es el patrón de os.CreateTemp (ej. "src_image_*.jpg", "src_clip_*.mp4");
// `timeout` acota la descarga (los videos necesitan más que las imágenes).
func (e *Engine) downloadToTempFile(ctx context.Context, url, pattern string, timeout time.Duration) (string, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status HTTP %d al descargar %s", resp.StatusCode, url)
	}

	tmpFile, err := os.CreateTemp(e.outputDir, pattern)
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		os.Remove(tmpFile.Name())
		return "", err
	}

	return tmpFile.Name(), nil
}

// downloadAssetIfConfigured descarga `url` a `dest` (sobreescribiendo lo que
// haya) si `url` no está vacía. Se usa solo en el arranque, para cachear
// localmente el logo/banner cuando el banco de medios vive en Cloudinary —
// así el overlay de FFmpeg sigue usando una ruta de archivo local (más
// simple y rápido que pasarle una URL remota por render). Si falla, se
// registra un warning y se deja el archivo local existente tal cual (si lo
// hay), sin interrumpir el arranque del servidor.
func downloadAssetIfConfigured(url, dest string) {
	if url == "" {
		return
	}
	if err := downloadFileTo(url, dest); err != nil {
		log.Printf("[VideoEngine] no se pudo descargar %s: %v (se usará el archivo local existente en %s, si lo hay)", url, err, dest)
	} else {
		log.Printf("[VideoEngine] asset descargado desde Cloudinary → %s", dest)
	}
}

func downloadFileTo(url, dest string) error {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status HTTP %d al descargar %s", resp.StatusCode, url)
	}

	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}

	tmp := dest + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	f.Close()

	return os.Rename(tmp, dest)
}

// renderFallbackColorVideo es el último recurso cuando no hay ni clip de video ni
// imagen destacada: un video de color de marca con el titular quemado.
func (e *Engine) renderFallbackColorVideo(ctx context.Context, job *models.VideoJob, outputPath string) error {
	req := job.Request
	duration := req.DurationSec
	if duration <= 0 {
		duration = 12
	}
	lo := layoutFor(req.Template)
	lo.boxColor, lo.boxOpacity = "black", 0.78
	lo.headFontSize, lo.headColor, lo.headX = 40, "white", 60
	lo.showLogo, lo.logoSize, lo.logoX = true, 240, "W-w-60"
	lo.headFontFile = e.fontFileFor("classic")
	lo = e.applyStyleOverrides(lo, req.Style)

	headlineText := resolveHeadlineText(req)
	// Calcular dinámicamente el ancho de línea para que NUNCA se corte por la derecha
	maxChars := computeMaxCharsPerLine(lo.headFontSize, lo.headX, lo.headFontFile)
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headlineText), maxChars, headlineMaxLines)
	lo = adjustLayoutForContent(lo, cleanHeadline, lo.headFontSize)
	if cardPath, err := e.generateRoundedCardPNG(1000, lo.cardH, 32, lo.boxColor, lo.boxOpacity); err == nil {
		lo.cardImagePath = cardPath
	}

	videoFilter := strings.Join([]string{
		fmt.Sprintf("drawtext=text='PRENSA ABIERTA - PUERTO RICO':fontcolor=yellow:fontsize=36:x=60:y=%s:box=1:boxcolor=red@0.9:boxborderw=10%s", lo.catTextY, fontFileClause(lo.headFontFile)),
		e.buildHeadlineDrawtext(cleanHeadline, lo),
	}, ",")

	inputArgs := []string{"-f", "lavfi", "-i", fmt.Sprintf("color=c=0x1a1a2e:s=1080x1920:d=%d:r=30", duration)}
	encodeArgs := []string{"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, duration, lo)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error generando video fallback: %v (salida: %s)", err, string(output))
	}
	return nil
}

func resolveHeadlineText(req models.VideoRenderRequest) string {
	if req.Style != nil && strings.TrimSpace(req.Style.HeadlineText) != "" {
		return strings.TrimSpace(req.Style.HeadlineText)
	}
	return req.Headline
}

func (e *Engine) buildHeadlineDrawtext(cleanHeadline string, lo overlayLayout) string {
	var headXExpr string
	var textAlignOpt string
	switch lo.headAlign {
	case "center":
		headXExpr = "(w-tw)/2"
		textAlignOpt = ":text_align=center"
	case "right":
		headXExpr = fmt.Sprintf("w-tw-%d", lo.headX)
		textAlignOpt = ":text_align=right"
	default:
		headXExpr = fmt.Sprintf("%d", lo.headX)
		textAlignOpt = ":text_align=left"
	}

	return fmt.Sprintf(
		"drawtext=text='%s':expansion=none:fontcolor=%s:fontsize=%d:x=%s:y=%s:line_spacing=%d:fix_bounds=true%s%s",
		cleanHeadline, lo.headColor, lo.headFontSize, headXExpr, lo.headY, lo.headLineSpacing, textAlignOpt, fontFileClause(lo.headFontFile),
	)
}

// buildRenderArgs arma los argumentos de FFmpeg combinando el/los input(s) de video
// ya provistos (inputArgs) con el filtro de escalado/overlay (videoFilter, SIN los
// overlays de logo/banner) y agrega como inputs adicionales — vía -filter_complex —
// el logo de Prensa Abierta (si existe en disco) y, si la plantilla lo pide
// (overlayLayout.showPromo), el banner "Descarga la App GRATIS". Se reutiliza en
// los 3 modos de render (clips reales, imagen de respaldo, color de marca) para no
// triplicar esta lógica.
//
// durationSec es la duración objetivo del video base: se usa para acotar
// explícitamente los inputs en loop (logo/banner) con "-t". Sin esto (probado en
// la práctica), un input -loop 1 queda sin límite de duración y el render corre
// indefinidamente hasta que el timeout del worker lo mata ("signal: killed"), en
// vez de terminar cuando termina el video base.
//
// Los inputs en loop se acotan a durationSec + 2 como margen de seguridad, pero el
// overlay final lleva `shortest=1` para que la salida termine EXACTAMENTE cuando
// termina el video base (el input más corto) y no cuando terminan ellos — sin
// esto, la salida quedaba ~2s más larga de lo pedido con el b-roll congelado en su
// último frame durante esa cola.
func (e *Engine) buildRenderArgs(inputArgs []string, videoFilter string, outputPath string, encodeArgs []string, durationSec int, lo overlayLayout) []string {
	args := append([]string{"-y"}, inputArgs...)

	logoY := lo.logoY
	if logoY <= 0 {
		logoY = 92
	}
	promoWidth := lo.promoWidth
	if promoWidth <= 0 {
		promoWidth = 560
	}
	promoMargin := lo.promoBottomMargin
	if promoMargin <= 0 {
		promoMargin = 34
	}

	hasCard := lo.cardImagePath != "" && fileExists(lo.cardImagePath)
	hasLogo := lo.showLogo && fileExists(e.defaultLogo)
	roundedPromo := e.getRoundedPromoImage()
	hasPromo := lo.showPromo && fileExists(roundedPromo)

	logoSize := lo.logoSize
	if logoSize <= 0 {
		logoSize = 240
	}
	logoX := lo.logoX
	if logoX == "" {
		logoX = "W-w-60"
	}

	promoYExpr := fmt.Sprintf("H-h-%d", promoMargin)
	if lo.promoY > 0 {
		promoYExpr = fmt.Sprintf("%d", lo.promoY)
	}

	safeDuration := durationSec + 2 // margen de seguridad por encima del video base
	if safeDuration <= 2 {
		safeDuration = 15
	}
	loopInput := func(imgPath string) []string {
		return []string{"-loop", "1", "-t", fmt.Sprintf("%d", safeDuration), "-i", imgPath}
	}

	// Contar los inputs -i que ya vienen en inputArgs
	nextInputIdx := 0
	for _, a := range inputArgs {
		if a == "-i" {
			nextInputIdx++
		}
	}

	var cardIdx, logoIdx, promoIdx int
	if hasCard {
		args = append(args, loopInput(lo.cardImagePath)...)
		cardIdx = nextInputIdx
		nextInputIdx++
	}
	if hasLogo {
		args = append(args, loopInput(e.defaultLogo)...)
		logoIdx = nextInputIdx
		nextInputIdx++
	}
	if hasPromo {
		args = append(args, loopInput(roundedPromo)...)
		promoIdx = nextInputIdx
		nextInputIdx++
	}

	// Construir filter_complex encadenando cada capa de forma modular
	var fcParts []string
	currentStream := "[0:v]"

	// Si videoFilter contiene split= (ej. coverImageFilter de fallback en renderImageZoomVideo)
	if strings.Contains(videoFilter, "split=") {
		parts := strings.SplitN(videoFilter, "drawtext=", 2)
		if len(parts) == 2 {
			coverPart := strings.TrimSuffix(parts[0], ",")
			fcParts = append(fcParts, fmt.Sprintf("[0:v]%s[vbase]", coverPart))
			currentStream = "[vbase]"
			videoFilter = "drawtext=" + parts[1]
		}
	}

	if hasCard {
		cardY := lo.cardY
		if cardY <= 0 {
			cardY = 1300
		}
		fcParts = append(fcParts, fmt.Sprintf("%s[%d:v]overlay=x=40:y=%d[vcard]", currentStream, cardIdx, cardY))
		currentStream = "[vcard]"
	}

	if videoFilter != "" {
		fcParts = append(fcParts, fmt.Sprintf("%s%s[vtext]", currentStream, videoFilter))
		currentStream = "[vtext]"
	}

	if hasLogo {
		fcParts = append(fcParts, fmt.Sprintf("[%d:v]scale=%d:%d[logo]", logoIdx, logoSize, logoSize))
		fcParts = append(fcParts, fmt.Sprintf("%s[logo]overlay=x=%s:y=%d:shortest=1[vlogo]", currentStream, logoX, logoY))
		currentStream = "[vlogo]"
	}

	if hasPromo {
		fcParts = append(fcParts, fmt.Sprintf("[%d:v]scale=%d:-1[promo]", promoIdx, promoWidth))
		fcParts = append(fcParts, fmt.Sprintf("%s[promo]overlay=x=(W-w)/2:y=%s:shortest=1[vfinal]", currentStream, promoYExpr))
		currentStream = "[vfinal]"
	}

	if len(fcParts) > 0 {
		filterComplex := strings.Join(fcParts, ";")
		args = append(args, "-filter_complex", filterComplex, "-map", currentStream)
	} else if videoFilter != "" {
		args = append(args, "-vf", videoFilter)
	}

	args = append(args, encodeArgs...)
	args = append(args, outputPath)
	return args
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// overlayLayout agrupa las coordenadas de los overlays inferiores (caja oscura,
// rótulo de categoría, titular), del logo y del banner promocional opcional, para
// poder cambiarlas según la plantilla elegida (models.VideoRenderRequest.Template)
// sin duplicar la lógica en los 3 modos de render.
type overlayLayout struct {
	boxY, boxH        string  // ej. "ih-520", "520"
	boxColor          string  // color del drawbox de fondo, ej. "black" o "0xRRGGBB" (override de VideoStyle.BoxColor)
	boxOpacity        float64 // opacidad 0-1 del drawbox, ej. 0.85 (override de VideoStyle.BoxOpacity)
	catDotY, catTextY string  // ej. "h-441", "h-440"
	headerText        string  // "" = auto (buildCategoryHeader(category)); override de VideoStyle.HeaderText
	headerColor       string  // color del rótulo + punto pulsante, default categoryHeaderColor
	headY             string  // ej. "h-370"
	headYOffset       int     // mismo valor que headY pero numérico (distancia en px desde el borde inferior del lienzo de 1920px) — permite calcular dónde termina el titular para ubicar el banner promocional con un espaciado exacta.
	headLineSpacing   int
	headFontSize      int    // tamaño del titular (drawtext fontsize); default headlineFontSize (46) o 40 en el fallback de color
	headFontFile      string // ruta absoluta al .ttf del titular; "" = sin fontfile (fuente del sistema, comportamiento actual)
	headColor         string // color del titular (fontcolor), default "white"
	headX             int    // posición X del titular, default 70 (60 en el fallback de color)
	headAlign         string // alineación del titular: "left", "center", "right"
	logoY             int
	showLogo          bool   // si se debe pintar el logo (antes: implícito por fileExists); default true, override de VideoStyle.ShowLogo
	logoSize          int    // tamaño (cuadrado, px) del logo; default 240, override de VideoStyle.LogoSize
	logoX             string // expresión FFmpeg de posición X del logo; default "W-w-60" (ancla superior derecha), override de VideoStyle.LogoX (px absolutos desde la izquierda)

	// Banner "Descarga la App GRATIS" (assets/logos/descargar-app-gratis.jpg),
	// centrado horizontalmente. Solo lo usa la plantilla "app-promo" por defecto;
	// VideoStyle.ShowPromo puede forzarlo on/off en cualquier plantilla.
	showPromo         bool
	promoWidth        int // ancho al que se escala (alto = automático, mantiene aspecto)
	promoBottomMargin int // fallback: anclado al borde inferior si no se pudo calcular promoY
	promoY            int // posición Y calculada

	// Dinamismo & Transiciones entre tomas
	transition string // "fade", "slide", "fadeblack", "cut"
	shotCount  int    // 2, 3, 4

	// Tarjeta con esquinas redondeadas (reemplaza drawbox por un overlay PNG idéntico al preview)
	cardImagePath string
	cardY         int
	cardH         int
}

// canvasHeight es la altura fija del lienzo de salida (1080x1920, 9:16) — todos los
// renders escalan/recortan a esta resolución, así que las cuentas de posición del
// banner promocional pueden hacerse con este valor literal en vez de la expresión
// `h` de FFmpeg (que también vale 1920, pero como número no permite aritmética en Go).
const canvasHeight = 1920

// adjustLayoutForContent calcula las posiciones exactas de forma determinista y reactiva
// siguiendo el mismo flujo de contenido que CSS (padding superior -> rótulo -> espacio -> titular -> espacio -> banner -> padding inferior).
// Garantiza que la tarjeta envuelva TODO el contenido con márgenes interiores simétricos (28px arriba y abajo),
// que el banner promocional NUNCA se corte ni toque el borde inferior, y que la tarjeta flote con margen seguro (70px).
func adjustLayoutForContent(lo overlayLayout, cleanHeadline string, fontSize int) overlayLayout {
	lines := strings.Count(cleanHeadline, "\n") + 1
	// En FreeType / drawtext, el interlineado real entre líneas consecutivas es
	// ascender + descender (~1.25 * fontSize) + line_spacing.
	linePitch := int(float64(fontSize)*1.25) + lo.headLineSpacing
	// Altura real del bloque de titular desde la parte superior de la primera línea
	// hasta la parte inferior de los descendentes de la última línea:
	headlineH := (lines-1)*linePitch + int(float64(fontSize)*1.20)
	if lines == 1 {
		headlineH = int(float64(fontSize) * 1.20)
	}

	// Dimensiones interiores de la tarjeta idénticas a las clases CSS del preview
	const (
		cardPaddingV          = 32 // padding vertical superior e inferior
		categoryH             = 36 // altura del rótulo 'ULTIMA HORA • CATEGORIA'
		categoryToHeadlineGap = 20 // separación entre rótulo y titular
		headlineToPromoGap    = 32 // separación amplia y limpia entre titular y banner promocional
	)

	// Margen inferior seguro entre la base de la tarjeta y el borde inferior del lienzo
	cardBottomMargin := 70 // 70px deja espacio para el time indicator y el borde del mockup
	if lo.promoBottomMargin > 0 {
		cardBottomMargin = lo.promoBottomMargin
	}
	// Si está en plantilla reels-safe, proteger la zona UI inferior de Reels (360px)
	if strings.Contains(lo.boxY, "ih-8") || strings.Contains(lo.boxY, "ih-7") || lo.headYOffset >= 650 {
		if cardBottomMargin < 360 {
			cardBottomMargin = 360
		}
	}

	promoHeight := 0
	if lo.showPromo {
		pWidth := lo.promoWidth
		if pWidth <= 0 {
			pWidth = 560
		}
		promoHeight = int(float64(pWidth) * (1058.0 / 4492.0))
		if promoHeight < 60 {
			promoHeight = 132
		}
	}

	// Altura total de la tarjeta derivada naturalmente de su contenido (como flex-col en CSS)
	var cardH int
	if lo.showPromo {
		cardH = cardPaddingV + categoryH + categoryToHeadlineGap + headlineH + headlineToPromoGap + promoHeight + cardPaddingV
	} else {
		cardH = cardPaddingV + categoryH + categoryToHeadlineGap + headlineH + cardPaddingV
	}

	// Posición de la tarjeta anclada al margen inferior seguro
	cardBottom := canvasHeight - cardBottomMargin
	cardTop := cardBottom - cardH
	if cardTop < 60 {
		cardTop = 60
		cardH = cardBottom - cardTop
	}

	// Posiciones verticales relativas exactas de cada elemento
	categoryTop := cardTop + cardPaddingV
	lo.catTextY = fmt.Sprintf("%d", categoryTop)
	lo.catDotY = fmt.Sprintf("%d", categoryTop+6)

	headlineTop := categoryTop + categoryH + categoryToHeadlineGap
	lo.headY = fmt.Sprintf("%d", headlineTop)
	lo.headYOffset = canvasHeight - headlineTop

	if lo.showPromo {
		promoTop := headlineTop + headlineH + headlineToPromoGap
		lo.promoY = promoTop
	} else {
		lo.promoY = 0
	}

	lo.boxY = fmt.Sprintf("%d", cardTop)
	lo.boxH = fmt.Sprintf("%d", cardH)
	lo.cardY = cardTop
	lo.cardH = cardH

	return lo
}

func computePromoY(lo overlayLayout, cleanHeadline string, fontSize int) int {
	return lo.promoY
}

// layoutFor traduce el nombre de plantilla a coordenadas concretas de overlay.
//
// "reels-safe" (ver .agents/formato-video-reel.md): sube el bloque de titular a la
// safe zone del grid 1:1 (Y:1050–1450 en un lienzo de 1920), deja libres los
// ~430px inferiores para la UI de Reels, separa el logo ≥180px del borde superior
// y compacta el interlineado.
//
// "app-promo": layout basado en "standard" (mismo interlineado) pero con el
// rótulo+titular subidos 84px en total (offset-desde-el-borde +84: h-441→h-525,
// h-440→h-524, h-370→h-454 — 24px del ajuste inicial + 60px más a pedido del
// usuario) para dejar sitio, justo debajo, al banner "Descarga la App GRATIS" —
// que se posiciona dinámicamente (ver computePromoY) a promoGapBelowHeadline
// (16px) de la última línea del titular, sea cual sea su largo. La caja oscura
// (boxY/boxH) se estiró esos mismos 84px (520→604) para que siga cubriendo el
// rótulo "ULTIMA HORA • CATEGORÍA" con el mismo margen de 79px que tenía en
// "standard" — si solo se sube el texto sin estirar la caja, el rótulo queda
// por encima del borde superior de la caja y se ve "cortado".
func layoutFor(template string) overlayLayout {
	if template == "reels-safe" {
		return overlayLayout{
			boxY: "ih-880", boxH: "440",
			catDotY: "h-801", catTextY: "h-800",
			headY:           "h-740",
			headYOffset:     740,
			headLineSpacing: 10,
			logoY:           190,
		}
	}
	if template == "app-promo" {
		return overlayLayout{
			boxY: "ih-604", boxH: "604",
			catDotY: "h-525", catTextY: "h-524",
			headY:             "h-454",
			headYOffset:       454,
			headLineSpacing:   18,
			logoY:             92,
			showPromo:         true,
			promoWidth:        560,
			promoBottomMargin: 34,
		}
	}
	return overlayLayout{
		boxY: "ih-520", boxH: "520",
		catDotY: "h-441", catTextY: "h-440",
		headY:           "h-370",
		headYOffset:     370,
		headLineSpacing: 18,
		logoY:           92,
	}
}

// hexColorPattern valida un color "#RRGGBB" o "RRGGBB" (6 hex digits, con o sin #).
var hexColorPattern = regexp.MustCompile(`^#?([0-9A-Fa-f]{6})$`)

// sanitizeHexColor valida y normaliza un color hex de VideoStyle a "RRGGBB"
// (mayúsculas, sin "#"). Devuelve "" si el valor no es un hex válido — así un
// override malformado simplemente se ignora (se mantiene el default) en vez de
// romper el filtro de FFmpeg.
func sanitizeHexColor(v string) string {
	m := hexColorPattern.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return ""
	}
	return strings.ToUpper(m[1])
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// escapeFontFilePath adapta una ruta de archivo (incluyendo rutas Windows con
// letra de unidad, ej. "C:\...") al formato que espera el parámetro `fontfile`
// del filtro drawtext de FFmpeg: barras `/` (nunca `\`) y el `:` de la unidad
// escapado como `\:` (el filtro usa `:` como separador de opciones).
func escapeFontFilePath(path string) string {
	p := filepath.ToSlash(path)
	return strings.ReplaceAll(p, ":", "\\:")
}

// fontFileClause devuelve la cláusula `:fontfile='...'` lista para concatenar a
// un `drawtext=...`, o "" si path viene vacío (sin override de fuente: se deja
// que FFmpeg use la fuente por defecto de fontconfig, comportamiento actual).
func fontFileClause(path string) string {
	if path == "" {
		return ""
	}
	return fmt.Sprintf(":fontfile='%s'", escapeFontFilePath(path))
}

// fontFileFor resuelve la clave de fuente elegida en el Editor de video
// (VideoStyle.HeadlineFont) a una ruta de archivo .ttf bajo assetsDir/fonts.
// "league_spartan" resuelve a League Spartan Bold; cualquier otro valor
// (incluyendo "classic", vacío, o desconocido) resuelve al DejaVu Sans Bold
// bundleado — el look "clásico" original que antes se dejaba en manos de
// Fontconfig para resolver la fuente default del sistema.
//
// Se resuelve SIEMPRE a un archivo en disco (nunca "" salvo que falten ambos
// assets) a propósito: en Windows, cuando Fontconfig no tiene un fonts.conf
// válido (`Fontconfig error: Cannot load default config file`), el filtro
// `drawtext` sin `fontfile=` no solo falla — puede crashear FFmpeg entero
// (exit status 0xc0000005, access violation) en vez de solo loguear un error.
// Pasar siempre un `fontfile=` evita que drawtext dependa de Fontconfig.
func (e *Engine) fontFileFor(key string) string {
	if key == "league_spartan" {
		path := filepath.Join(e.assetsDir, "fonts", "League_Spartan", "LeagueSpartan-Bold.ttf")
		if fileExists(path) {
			return path
		}
	}
	classicPath := filepath.Join(e.assetsDir, "fonts", "DejaVu", "DejaVuSans-Bold.ttf")
	if fileExists(classicPath) {
		return classicPath
	}
	// Fallbacks adicionales si e.assetsDir no apunta a la carpeta assets correcta
	for _, candidate := range []string{
		filepath.Join("assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
		filepath.Join("..", "assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
		filepath.Join("..", "..", "assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
	} {
		if fileExists(candidate) {
			return candidate
		}
	}
	// En Windows, si no se encuentra la fuente bundleada, usar fuentes TrueType estándar del sistema
	// para evitar que Fontconfig falle y FFmpeg crashee con 0xc0000005:
	if windir := os.Getenv("WINDIR"); windir != "" {
		for _, name := range []string{"arialbd.ttf", "arial.ttf", "segoeuib.ttf", "segoeui.ttf"} {
			sysFont := filepath.Join(windir, "Fonts", name)
			if fileExists(sysFont) {
				return sysFont
			}
		}
	}
	return ""
}

// generateRoundedCardPNG genera una imagen PNG con esquinas redondeadas y borde de acento
// idéntico al estilo rounded-2xl border de la tarjeta en el preview web (HTML/CSS).
// Se guarda en cacheDir/card_{hash}.png para que solo se genere una vez por combinación de dimensiones y colores.
func (e *Engine) generateRoundedCardPNG(width, height, radius int, bgColorHex string, bgOpacity float64) (string, error) {
	if width <= 0 {
		width = 1000
	}
	if height <= 0 {
		height = 400
	}
	if radius <= 0 {
		radius = 32
	}

	cardCacheDir := filepath.Join(e.outputDir, "card_cache")
	_ = os.MkdirAll(cardCacheDir, 0755)

	hashKey := fmt.Sprintf("%d_%d_%d_%s_%.2f", width, height, radius, bgColorHex, bgOpacity)
	hash := fmt.Sprintf("%x", sha1.Sum([]byte(hashKey)))
	cardPath := filepath.Join(cardCacheDir, fmt.Sprintf("card_%s.png", hash))

	if fileExists(cardPath) {
		return cardPath, nil
	}

	// Parse background color (default black #000000)
	bgR, bgG, bgB := uint8(0), uint8(0), uint8(0)
	cleanHex := strings.TrimPrefix(strings.TrimPrefix(bgColorHex, "0x"), "#")
	if len(cleanHex) >= 6 {
		var r, g, b int
		fmt.Sscanf(cleanHex[0:2], "%x", &r)
		fmt.Sscanf(cleanHex[2:4], "%x", &g)
		fmt.Sscanf(cleanHex[4:6], "%x", &b)
		bgR, bgG, bgB = uint8(r), uint8(g), uint8(b)
	}
	bgA := uint8(clampFloat(bgOpacity, 0, 1) * 255)

	// Borde de marca Prensa Abierta: rgba(255, 85, 0, 0.38)
	borderR, borderG, borderB, borderA := uint8(255), uint8(85), uint8(0), uint8(98)
	borderWidth := 2.5

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	r := float64(radius)
	w := float64(width)
	h := float64(height)
	bw := borderWidth

	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			fx := float64(x) + 0.5
			fy := float64(y) + 0.5

			var dx, dy float64
			if fx < r {
				dx = r - fx
			} else if fx > w-r {
				dx = fx - (w - r)
			}
			if fy < r {
				dy = r - fy
			} else if fy > h-r {
				dy = fy - (h - r)
			}

			dist := math.Hypot(dx, dy)
			if dist <= r {
				if dist > r-bw || fx < bw || fx > w-bw || fy < bw || fy > h-bw {
					img.SetRGBA(x, y, color.RGBA{R: borderR, G: borderG, B: borderB, A: borderA})
				} else {
					img.SetRGBA(x, y, color.RGBA{R: bgR, G: bgG, B: bgB, A: bgA})
				}
			} else if dist <= r+1.0 {
				alpha := (1.0 - (dist - r)) * (float64(borderA) / 255.0)
				img.SetRGBA(x, y, color.RGBA{R: borderR, G: borderG, B: borderB, A: uint8(alpha * 255)})
			}
		}
	}

	tmpPath := fmt.Sprintf("%s.tmp.png", cardPath)
	f, err := os.Create(tmpPath)
	if err != nil {
		return "", err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return "", err
	}
	f.Close()
	_ = os.Rename(tmpPath, cardPath)

	return cardPath, nil
}

// getRoundedPromoImage devuelve la ruta a una versión de descargar-app-gratis con esquinas redondeadas
// (radio 16px y borde sutil), idéntica a la clase rounded-lg border border-white/20 de CSS.
func (e *Engine) getRoundedPromoImage() string {
	if !fileExists(e.promoImage) {
		return ""
	}
	cacheDir := filepath.Join(e.outputDir, "card_cache")
	_ = os.MkdirAll(cacheDir, 0755)
	roundedPath := filepath.Join(cacheDir, "promo_rounded.png")
	if fileExists(roundedPath) {
		return roundedPath
	}

	file, err := os.Open(e.promoImage)
	if err != nil {
		return e.promoImage
	}
	defer file.Close()

	src, _, err := image.Decode(file)
	if err != nil {
		return e.promoImage
	}

	bounds := src.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()
	radius := 64.0 // En imagen nativa de 4492x1058, 64px equivale a ~16px cuando se escala a 560px
	bw := 5.0

	out := image.NewRGBA(image.Rect(0, 0, w, h))

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			fx := float64(x) + 0.5
			fy := float64(y) + 0.5

			var dx, dy float64
			if fx < radius {
				dx = radius - fx
			} else if fx > float64(w)-radius {
				dx = fx - (float64(w) - radius)
			}
			if fy < radius {
				dy = radius - fy
			} else if fy > float64(h)-radius {
				dy = fy - (float64(h) - radius)
			}

			dist := math.Hypot(dx, dy)
			if dist <= radius {
				c := src.At(bounds.Min.X+x, bounds.Min.Y+y)
				if dist > radius-bw || fx < bw || fx > float64(w)-bw || fy < bw || fy > float64(h)-bw {
					out.SetRGBA(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 60})
				} else {
					out.Set(x, y, c)
				}
			} else if dist <= radius+1.0 {
				alpha := (1.0 - (dist - radius)) * (60.0 / 255.0)
				out.SetRGBA(x, y, color.RGBA{R: 255, G: 255, B: 255, A: uint8(alpha * 255)})
			}
		}
	}

	tmpPath := fmt.Sprintf("%s.tmp.png", roundedPath)
	f, err := os.Create(tmpPath)
	if err != nil {
		return e.promoImage
	}
	if err := png.Encode(f, out); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return e.promoImage
	}
	f.Close()
	_ = os.Rename(tmpPath, roundedPath)
	return roundedPath
}

// applyStyleOverrides sobreescribe, campo por campo, los valores de lo con los
// que vengan en style — nil, "", 0 o false-no-explícito (los *bool solo se leen
// si son no-nil) significan "no tocar", se mantiene el default ya puesto por el
// caller (layoutFor + los defaults propios de cada modo de render). Así, un
// VideoRenderRequest.Style ausente o parcial rinde igual que antes de esta
// feature. Todos los valores numéricos/color se clampan a rangos seguros para
// que un payload fuera de rango nunca rompa el filtro de FFmpeg ni produzca
// coordenadas fuera del lienzo 1080x1920.
func (e *Engine) applyStyleOverrides(lo overlayLayout, style *models.VideoStyle) overlayLayout {
	if style == nil {
		return lo
	}
	if style.HeadlineFont != "" {
		lo.headFontFile = e.fontFileFor(style.HeadlineFont)
	}
	if style.HeadlineFontSize > 0 {
		lo.headFontSize = clampInt(style.HeadlineFontSize, 24, 72)
	}
	if c := sanitizeHexColor(style.HeadlineColor); c != "" {
		lo.headColor = "0x" + c
	}
	if style.HeadlineX > 0 {
		lo.headX = clampInt(style.HeadlineX, 0, 1080)
	}
	if style.HeadlineY > 0 {
		offset := clampInt(style.HeadlineY, 100, 1800)
		lo.headYOffset = offset
		lo.headY = fmt.Sprintf("h-%d", offset)
	}
	if style.HeadlineLineSpacing > 0 {
		lo.headLineSpacing = clampInt(style.HeadlineLineSpacing, 0, 60)
	}
	if style.HeadlineAlign != "" {
		align := strings.ToLower(strings.TrimSpace(style.HeadlineAlign))
		if align == "center" || align == "centre" {
			lo.headAlign = "center"
		} else if align == "right" {
			lo.headAlign = "right"
		} else {
			lo.headAlign = "left"
		}
	}
	if c := sanitizeHexColor(style.BoxColor); c != "" {
		lo.boxColor = "0x" + c
	}
	if style.BoxOpacity > 0 {
		lo.boxOpacity = clampFloat(style.BoxOpacity, 0, 1)
	}
	if style.BoxHeight > 0 {
		h := clampInt(style.BoxHeight, 100, 1920)
		lo.boxH = fmt.Sprintf("%d", h)
		lo.boxY = fmt.Sprintf("ih-%d", h)
	}
	if style.HeaderText != "" {
		lo.headerText = sanitizeTextForFFmpeg(style.HeaderText)
	}
	if c := sanitizeHexColor(style.HeaderColor); c != "" {
		lo.headerColor = "0x" + c
	}
	if style.ShowLogo != nil {
		lo.showLogo = *style.ShowLogo
	}
	if style.LogoSize > 0 {
		lo.logoSize = clampInt(style.LogoSize, 60, 500)
	}
	if style.LogoX > 0 {
		lo.logoX = fmt.Sprintf("%d", clampInt(style.LogoX, 0, 1080))
	}
	if style.LogoY > 0 {
		lo.logoY = clampInt(style.LogoY, 0, 1920)
	}
	if style.ShowPromo != nil {
		lo.showPromo = *style.ShowPromo
	}
	if style.PromoWidth > 0 {
		lo.promoWidth = clampInt(style.PromoWidth, 200, 1080)
	}
	if style.Transition != "" {
		lo.transition = style.Transition
	}
	if style.ShotCount > 0 {
		lo.shotCount = clampInt(style.ShotCount, 1, 5)
	}
	return lo
}

// StyleDefaultsFor devuelve, para el template dado, los valores de estilo por
// defecto que hoy usan executeFFmpegRender/renderImageZoomVideo ANTES de
// cualquier override — así el Editor de video (frontend) puede precargar sus
// controles con los valores reales de cada plantilla, sin duplicar constantes
// en TypeScript. No requiere una instancia de Engine (no resuelve rutas de
// fuente en disco): el frontend solo necesita los NÚMEROS/colores de partida.
func StyleDefaultsFor(template string) models.VideoStyle {
	lo := layoutFor(template)
	showLogo := true
	showPromo := lo.showPromo
	return models.VideoStyle{
		HeadlineFont:        "classic",
		HeadlineFontSize:    headlineFontSize,
		HeadlineColor:       "#FFFFFF",
		HeadlineX:           80,
		HeadlineY:           lo.headYOffset,
		HeadlineLineSpacing: lo.headLineSpacing,
		HeadlineAlign:       "left",
		BoxColor:            "#000000",
		BoxOpacity:          0.85,
		HeaderColor:         "#FFAA00",
		ShowLogo:            &showLogo,
		LogoSize:            240,
		LogoY:               lo.logoY,
		ShowPromo:           &showPromo,
		PromoWidth:          560,
		Transition:          "fade",
		ShotCount:           3,
	}
}

// buildCategoryHeader arma el rótulo pequeño mostrado arriba del titular.
func buildCategoryHeader(category string) string {
	if category == "" {
		return "ULTIMA HORA  •  NOTICIAS"
	}
	return fmt.Sprintf("ULTIMA HORA  •  %s", strings.ToUpper(category))
}

// categoryHeaderColor es el color del rótulo "ULTIMA HORA • …" y del punto que lo precede.
const categoryHeaderColor = "0xFFAA00"

// categoryHeaderFilters devuelve las cláusulas `drawtext` del rótulo superior
// precedido de un punto (●) que titila en el mismo color, replicando el indicador
// pulsante que el preview (VideoPlayerPreview.tsx) dibuja a la izquierda de
// "ÚLTIMA HORA". El alpha del punto oscila ~0.2→1.0 una vez por segundo (abs(sin)).
func (e *Engine) categoryHeaderFilters(category string, lo overlayLayout) string {
	color := lo.headerColor
	if color == "" {
		color = categoryHeaderColor
	}
	headerText := lo.headerText
	if headerText == "" {
		headerText = buildCategoryHeader(category)
	}
	fontClause := fontFileClause(lo.headFontFile)
	// Para el punto (●) usar SIEMPRE la fuente clásica (DejaVu Sans) que contiene los glifos geométricos Unicode,
	// evitando que fuentes como League Spartan muestren un glifo faltante '▯':
	classicFontClause := fontFileClause(e.fontFileFor("classic"))

	if lo.headAlign == "center" {
		return fmt.Sprintf(
			"drawtext=text='%s':expansion=none:fontcolor=%s:fontsize=34:x=(w-tw)/2:y=%s%s",
			sanitizeTextForFFmpeg(headerText), color, lo.catTextY, fontClause,
		)
	}

	dotX := lo.headX
	if dotX <= 0 {
		dotX = 70
	}
	textX := dotX + 46
	dot := fmt.Sprintf(
		"drawtext=text='●':fontcolor=%s:fontsize=26:x=%d:y=%s:alpha='0.2+0.8*abs(sin(PI*t))'%s",
		color, dotX, lo.catDotY, classicFontClause,
	)
	text := fmt.Sprintf(
		"drawtext=text='%s':expansion=none:fontcolor=%s:fontsize=36:x=%d:y=%s%s",
		sanitizeTextForFFmpeg(headerText), color, textX, lo.catTextY, fontClause,
	)
	return dot + "," + text
}

const (
	// Ancho de línea por defecto del titular para wrapTextForDrawtext cuando no se conoce el tamaño.
	headlineMaxCharsPerLine = 34
	headlineMaxLines        = 6 // Permite hasta 6 líneas con fuentes grandes (60-72px) para que NUNCA se corte el titular
	// Tamaño de fuente del titular por defecto en los 3 modos de render.
	headlineFontSize = 46
)

// computeMaxCharsPerLine calcula el límite seguro de caracteres por línea según el
// tamaño de fuente (fontSize), el margen horizontal izquierdo (x) y la fuente en uso
// (fontFile), garantizando que NINGUNA línea se desborde ni se corte por el borde
// derecho en un lienzo de 1080px. La fuente determina el factor de ancho medio por
// carácter: League Spartan (condensada display) necesita ~0.55x mientras que DejaVu
// Sans Bold necesita ~0.62x.
func computeMaxCharsPerLine(fontSize, x int, fontFile string) int {
	if x <= 0 {
		x = 80
	}
	// Margen derecho: igual que el padding derecho de la caja en el preview (34px)
	// más el margen exterior (40px) = 74px.
	rightMargin := 74
	if x > rightMargin {
		rightMargin = x
	}
	usableWidth := 1080 - x - rightMargin
	if usableWidth < 380 {
		usableWidth = 380
	}

	// Factor de ancho medio por carácter según la fuente, calibrado empíricamente
	// para que el wrapping manual produzca las MISMAS líneas que CSS (break-words
	// en el preview del browser a 1080px de ancho de lienzo).
	factor := 0.58 // default para fuentes sans-serif bold genéricas
	if strings.Contains(strings.ToLower(fontFile), "leaguespartan") {
		factor = 0.52 // League Spartan Bold es condensada, caracteres más estrechos
	} else if strings.Contains(strings.ToLower(fontFile), "dejavu") ||
		strings.Contains(strings.ToLower(fontFile), "arial") {
		factor = 0.58 // DejaVu Sans Bold / Arial Bold: ancho medio estándar
	}

	avgCharWidth := float64(fontSize) * factor
	if avgCharWidth <= 0 {
		avgCharWidth = 28
	}

	chars := int(float64(usableWidth) / avgCharWidth)
	if chars < 15 {
		chars = 15
	}
	if chars > 42 {
		chars = 42
	}
	return chars
}

// sanitizeTextForFFmpeg escapa caracteres especiales del filtro drawtext (comillas,
// dos puntos, barras) preservando saltos de línea intencionales (\n).
// Al usar expansion=none en drawtext, los símbolos como % y { } se tratan de forma literal
// sin necesidad de reemplazarlos por %%, evitando el error 'Stray %'.
func sanitizeTextForFFmpeg(text string) string {
	text = strings.ReplaceAll(text, "\\", "\\\\")
	text = strings.ReplaceAll(text, "'", "")
	text = strings.ReplaceAll(text, ":", "\\:")
	text = strings.ReplaceAll(text, "\r", "")
	return strings.TrimSpace(text)
}

// wrapTextForDrawtext parte el texto en líneas de máximo maxCharsPerLine caracteres
// (cortando por palabra completa, nunca a mitad de palabra) para que un titular
// largo haga salto de línea real en vez de solaparse o cortarse. Si el texto ya
// incluye saltos de línea explícitos (\n), se respetan esos cortes y sólo se
// subdividen las líneas que aún excedan maxCharsPerLine.
func wrapTextForDrawtext(text string, maxCharsPerLine, maxLines int) string {
	text = strings.ReplaceAll(text, "\r", "")
	rawLines := strings.Split(text, "\n")
	var lines []string

	for _, rawLine := range rawLines {
		rawTrimmed := strings.TrimSpace(rawLine)
		if rawTrimmed == "" {
			continue
		}
		words := strings.Fields(rawTrimmed)
		if len(words) == 0 {
			continue
		}
		current := ""
		for _, w := range words {
			// Si una sola palabra es más ancha que toda la línea permitida, partirla limpiamente
			for len(w) > maxCharsPerLine && maxCharsPerLine > 5 {
				chunk := w[:maxCharsPerLine-1] + "-"
				if current != "" {
					lines = append(lines, current)
					current = ""
				}
				lines = append(lines, chunk)
				w = w[maxCharsPerLine-1:]
			}

			candidate := w
			if current != "" {
				candidate = current + " " + w
			}
			if len(candidate) > maxCharsPerLine && current != "" {
				lines = append(lines, current)
				current = w
			} else {
				current = candidate
			}
		}
		if current != "" {
			lines = append(lines, current)
		}
	}

	if len(lines) == 0 {
		return text
	}

	if len(lines) > maxLines {
		lines = lines[:maxLines]
		last := lines[len(lines)-1]
		cut := maxCharsPerLine - 3
		if cut < 0 {
			cut = 0
		}
		if len(last) > cut {
			last = last[:cut]
		}
		lines[len(lines)-1] = strings.TrimSpace(last) + "..."
	}

	return strings.Join(lines, "\n")
}

// folderRouting es el espejo (compacto) de FOLDER_ROUTING en
// apps/web/src/lib/contentLibrary.ts: lleva cualquier categoría de noticia a una
// de las 8 carpetas canónicas de assets/contenido. El orden importa (gana el
// primero cuyo keyword esté contenido en la categoría). Sin match → "Ahora".
//
// Nota: en la práctica este camino casi no se ejecuta — el frontend
// (render-video/route.ts) ya resuelve el clip y lo manda en clip_urls; esto solo
// corre si llega una petición SIN clips. Se mantiene alineado por robustez.
var folderRouting = []struct {
	folder   string
	keywords []string
}{
	{"Deportes", []string{"deporte", "baloncesto", "bsn", "futbol", "beisbol", "pelota", "mlb", "nba", "nfl", "voleibol", "tenis", "boxeo", "atletismo", "atleta", "maraton", "olimpic", "campeonato", "torneo", "liga", "seleccion nacional", "medalla", "grandes ligas", "doble a"}},
	{"Sucesos", []string{"suceso", "tribunal", "justicia", "fiscal", "policia", "crimen", "criminal", "delito", "arrest", "detenid", "asesinat", "homicidio", "tiroteo", "balacera", "balead", "accidente", "choque", "incendio", "bomberos", "robo", "hurto", "asalt", "atraco", "droga", "narcotrafic", "allanamiento", "carcel", "convicto", "sentenciad", "condenad", "juicio", "imputad", "acusad", "querella", "desaparecid", "secuestro", "violacion", "agresion", "emergencia", "rescate", "corte federal"}},
	{"Economía", []string{"economia", "economic", "finanzas", "financier", "negocio", "comercio", "empresa", "mercado", "bolsa", "wall street", "banco", "banca", "prestamo", "hipoteca", "inflacion", "recesion", "deuda publica", "presupuesto", "hacienda", "ivu", "impuesto", "contribucion", "arancel", "empleo", "desemple", "salario", "nomina", "jubilacion", "pension", "turismo", "hotel", "inversion", "pyme", "criptomoneda", "bitcoin", "gasolina"}},
	{"Estados Unidos", []string{"estados unidos", "ee. uu", "ee.uu", "eeuu", "washington", "casa blanca", "capitolio federal", "congreso de estados unidos", "congreso federal", "senado federal", "camara federal", "corte suprema federal", "supremo federal", "gobierno federal", "reserva federal", "donald trump", "trump", "joe biden", "kamala harris", "departamento de estado", "homeland security", "servicio de inmigracion", "deportacion", "frontera sur", "nueva york", "la florida", "republicanos", "democratas"}},
	{"Internacional", []string{"internacional", "del mundo", "a nivel mundial", "extranjero", "naciones unidas", "union europea", "europa", "america latina", "latinoamerica", "republica dominicana", "venezuela", "cuba", "haiti", "mexico", "colombia", "brasil", "argentina", "espana", "china", "rusia", "ucrania", "israel", "palestina", "gaza", "medio oriente", "guerra en", "conflicto en", "cumbre de", "vaticano", "la haya"}},
	{"Gobierno", []string{"gobierno", "gobernador", "fortaleza", "legislatura", "legislador", "senado", "senador", "camara de representantes", "representante", "proyecto de ley", "resolucion", "reforma", "politic", "partido", "pnp", "ppd", "pip", "mvc", "primarias", "elecciones", "eleccion", "electoral", "plebiscito", "estatus", "estadidad", "independencia", "junta de control", "promesa", "alcalde", "alcaldesa", "alcaldia", "municipio", "municipal", "aee", "prepa", "aaa", "acueductos", "departamento de", "negociado de", "contralor", "corrupcion", "fondos federales", "fema"}},
	{"Local", []string{"local", "comunidad", "vecinos", "vecindario", "barrio", "barriada", "municipio de", "pueblo de", "casco urbano", "fiestas patronales", "festival", "carnaval", "tradicion", "patrimonio", "cultura", "farandul", "artista", "cantante", "concierto", "musica", "pelicula", "cine", "television", "novela", "celebridad", "influencer", "el tiempo", "clima", "pronostico del tiempo", "lluvia", "tormenta", "huracan", "meteorolog", "salud", "hospital", "medico", "enfermedad", "epidemia", "dengue", "vacuna", "paciente", "educacion", "escuela", "universidad", "upr", "estudiante", "maestro", "matricula", "san juan", "bayamon", "carolina", "ponce", "caguas", "guaynabo", "mayaguez", "arecibo", "aguadilla", "fajardo", "humacao", "trafico", "peaje", "tren urbano", "reciclaje", "playa"}},
}

const fallbackFolder = "Ahora"

// folderForCategory mapea una categoría de noticia a una de las 8 carpetas canónicas.
func folderForCategory(category string) string {
	cat := strings.ToLower(strings.TrimSpace(category))
	if cat == "" {
		return fallbackFolder
	}
	for _, r := range folderRouting {
		if strings.EqualFold(cat, r.folder) {
			return r.folder
		}
	}
	if strings.EqualFold(cat, fallbackFolder) {
		return fallbackFolder
	}
	for _, r := range folderRouting {
		for _, kw := range r.keywords {
			if strings.Contains(cat, kw) {
				return r.folder
			}
		}
	}
	return fallbackFolder
}

func (e *Engine) findCategoryTemplateVideo(category string) string {
	contenidoDir := filepath.Join(e.assetsDir, "contenido")
	if _, err := os.Stat(contenidoDir); err != nil {
		return ""
	}
	entries, err := os.ReadDir(contenidoDir)
	if err != nil {
		return ""
	}

	// Carpeta objetivo según el ruteo; si no existe en disco, se cae a "Ahora" y
	// luego a la primera carpeta disponible.
	pickFrom := func(folderName string) string {
		for _, entry := range entries {
			if entry.IsDir() && strings.EqualFold(entry.Name(), folderName) {
				folderPath := filepath.Join(contenidoDir, entry.Name())
				files, _ := os.ReadDir(folderPath)
				for _, f := range files {
					ext := strings.ToLower(filepath.Ext(f.Name()))
					if ext == ".mp4" || ext == ".mov" || ext == ".webm" {
						return filepath.Join(folderPath, f.Name())
					}
				}
			}
		}
		return ""
	}

	if v := pickFrom(folderForCategory(category)); v != "" {
		return v
	}
	if v := pickFrom(fallbackFolder); v != "" {
		return v
	}
	for _, entry := range entries {
		if entry.IsDir() {
			if v := pickFrom(entry.Name()); v != "" {
				return v
			}
		}
	}
	return ""
}
