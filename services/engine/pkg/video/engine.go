package video

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// defaultRenderQueueSize is how many jobs can wait in the queue before
// Enqueue starts rejecting new requests with backpressure (503).
const defaultRenderQueueSize = 100

// defaultRenderTimeout bounds how long a single FFmpeg render may run
// before its context is cancelled by the worker that picked it up.
const defaultRenderTimeout = 2 * time.Minute

// Engine handles video assembly and rendering via FFmpeg
type Engine struct {
	ffmpegPath  string
	assetsDir   string
	outputDir   string
	defaultLogo string

	mu   sync.Mutex // protege jobs y las mutaciones de sus campos
	jobs map[string]*models.VideoJob

	queue         chan string
	workerCount   int
	renderTimeout time.Duration
}

// NewEngine creates a new FFmpeg video rendering engine.
// workerCount define el tamaño del worker pool que limita cuántos renders
// de FFmpeg corren en paralelo; si es <= 0 se usa un valor por defecto de 2.
func NewEngine(ffmpegPath, assetsDir, outputDir string, workerCount int) *Engine {
	if ffmpegPath == "" {
		ffmpegPath = os.Getenv("FFMPEG_PATH")
		if ffmpegPath == "" {
			ffmpegPath = "ffmpeg"
		}
	}

	_ = os.MkdirAll(outputDir, 0755)
	_ = os.MkdirAll(assetsDir, 0755)

	logoPath := filepath.Join(assetsDir, "logos", "prensa_abierta_logo.png")

	if workerCount <= 0 {
		workerCount = 2
	}

	return &Engine{
		ffmpegPath:    ffmpegPath,
		assetsDir:     assetsDir,
		outputDir:     outputDir,
		defaultLogo:   logoPath,
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

	outputFilename := fmt.Sprintf("video_%s_%d.mp4", job.Request.NewsID, time.Now().Unix())
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

	now := time.Now()
	e.mu.Lock()
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
	if len(req.ClipURLs) == 0 {
		// Buscar si existe video de plantilla en assets/contenido según la categoría
		if catVideo := e.findCategoryTemplateVideo(req.Category); catVideo != "" {
			req.ClipURLs = []string{catVideo}
		} else if req.ImageURL != "" {
			// Sin clip de video: fallback a la imagen destacada de la noticia (con Ken Burns)
			return e.renderFallbackImageVideo(ctx, job, outputPath)
		} else {
			// Último recurso: video de color de marca con el titular quemado
			return e.renderFallbackColorVideo(ctx, job, outputPath)
		}
	}
	clipDuration := float64(req.DurationSec) / float64(len(req.ClipURLs))

	// Prepare temporary list for concatenation
	tempDir := filepath.Join(e.outputDir, "temp_"+job.ID)
	_ = os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)

	var preparedClips []string

	for i, clipURL := range req.ClipURLs {
		if i >= 3 {
			break // Max 3 clips for 10-15s
		}
		trimmedPath := filepath.Join(tempDir, fmt.Sprintf("clip_%d.mp4", i))

		// Scale & Crop to 9:16 (1080x1920) and trim
		filter := "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30"
		args := []string{
			"-y",
			"-t", fmt.Sprintf("%.2f", clipDuration),
			"-i", clipURL,
			"-vf", filter,
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-an",
			trimmedPath,
		}

		cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("[VideoEngine] Warning: no se pudo procesar clip %s: %v (out: %s)", clipURL, err, string(out))
			continue
		}
		preparedClips = append(preparedClips, trimmedPath)
	}

	if len(preparedClips) == 0 {
		if req.ImageURL != "" {
			return e.renderFallbackImageVideo(ctx, job, outputPath)
		}
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}

	// Concat file
	concatListFile := filepath.Join(tempDir, "concat.txt")
	var sb strings.Builder
	for _, p := range preparedClips {
		sb.WriteString(fmt.Sprintf("file '%s'\n", filepath.ToSlash(p)))
	}
	_ = os.WriteFile(concatListFile, []byte(sb.String()), 0644)

	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(req.Headline), headlineMaxCharsPerLine, headlineMaxLines)
	categoryHeader := buildCategoryHeader(req.Category)

	videoFilter := strings.Join([]string{
		// Dark box at bottom for legibility
		"drawbox=y=ih-520:color=black@0.85:width=iw:height=520:t=fill",
		// Category header tag
		fmt.Sprintf("drawtext=text='%s':fontcolor=0xFFAA00:fontsize=36:x=70:y=h-440", categoryHeader),
		// Headline text, con salto de línea real (line_spacing) en vez de recortarse
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=46:x=70:y=h-370:line_spacing=18:fix_bounds=true", cleanHeadline),
	}, ",")

	inputArgs := []string{"-f", "concat", "-safe", "0", "-i", concatListFile}
	encodeArgs := []string{"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, req.DurationSec)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error al ejecutar FFmpeg: %v (salida: %s)", err, string(output))
	}

	return nil
}

// renderFallbackImageVideo genera el reel a partir de la imagen destacada de la
// noticia cuando no hay ningún clip de video disponible (ni banco propio ni
// proporcionado por el caller).
//
// La imagen se descarga primero a un archivo LOCAL (en vez de pasarle la URL
// remota directamente a `-loop 1 -i <url>`): en la práctica, loopear una imagen
// servida por HTTP hace que FFmpeg no termine nunca por su cuenta (el proceso
// sigue "vivo" tras escribir todos los frames, y el worker termina matándolo al
// llegar al timeout). Con un archivo local, `-loop 1 -t duration` sí respeta la
// duración exacta y el proceso termina solo.
//
// Nota: NO se usa el filtro `zoompan` (efecto Ken Burns) — probado en la práctica,
// combinado con `-loop 1` genera muchísimos más frames de los esperados (se
// observó una salida de +1 minuto de video para un pedido de 6s), por la manera
// en que zoompan reinterpreta cada repetición del loop como un frame de entrada
// nuevo. Se prefiere una imagen estática pero con duración correcta y confiable
// a un efecto más vistoso que puede colgar el render.
func (e *Engine) renderFallbackImageVideo(ctx context.Context, job *models.VideoJob, outputPath string) error {
	req := job.Request
	duration := req.DurationSec
	if duration <= 0 {
		duration = 12
	}

	localImagePath, err := e.downloadToTempFile(ctx, req.ImageURL)
	if err != nil {
		log.Printf("[VideoEngine] Warning: no se pudo descargar la imagen %s: %v", req.ImageURL, err)
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}
	defer os.Remove(localImagePath)

	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(req.Headline), headlineMaxCharsPerLine, headlineMaxLines)
	categoryHeader := buildCategoryHeader(req.Category)

	videoFilter := strings.Join([]string{
		"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
		"drawbox=y=ih-520:color=black@0.85:width=iw:height=520:t=fill",
		fmt.Sprintf("drawtext=text='%s':fontcolor=0xFFAA00:fontsize=36:x=70:y=h-440", categoryHeader),
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=46:x=70:y=h-370:line_spacing=18:fix_bounds=true", cleanHeadline),
	}, ",")

	inputArgs := []string{"-loop", "1", "-t", fmt.Sprintf("%d", duration), "-i", localImagePath}
	encodeArgs := []string{"-r", "30", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, duration)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[VideoEngine] Warning: no se pudo renderizar desde la imagen %s: %v (salida: %s)", req.ImageURL, err, string(output))
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}
	return nil
}

// downloadToTempFile descarga una URL a un archivo temporal en outputDir y
// devuelve su ruta local. El llamador es responsable de borrarlo (defer os.Remove).
func (e *Engine) downloadToTempFile(ctx context.Context, url string) (string, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status HTTP %d al descargar %s", resp.StatusCode, url)
	}

	tmpFile, err := os.CreateTemp(e.outputDir, "src_image_*.jpg")
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

// renderFallbackColorVideo es el último recurso cuando no hay ni clip de video ni
// imagen destacada: un video de color de marca con el titular quemado.
func (e *Engine) renderFallbackColorVideo(ctx context.Context, job *models.VideoJob, outputPath string) error {
	req := job.Request
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(req.Headline), headlineMaxCharsPerLine, headlineMaxLines)
	duration := req.DurationSec
	if duration <= 0 {
		duration = 12
	}

	videoFilter := strings.Join([]string{
		"drawbox=y=ih-480:color=black@0.75:width=iw:height=480:t=fill",
		"drawtext=text='PRENSA ABIERTA - PUERTO RICO':fontcolor=yellow:fontsize=36:x=60:y=h-410:box=1:boxcolor=red@0.9:boxborderw=10",
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=40:x=60:y=h-300:line_spacing=14:fix_bounds=true", cleanHeadline),
	}, ",")

	inputArgs := []string{"-f", "lavfi", "-i", fmt.Sprintf("color=c=0x1a1a2e:s=1080x1920:d=%d:r=30", duration)}
	encodeArgs := []string{"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, duration)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error generando video fallback: %v (salida: %s)", err, string(output))
	}
	return nil
}

// buildRenderArgs arma los argumentos de FFmpeg combinando el/los input(s) de video
// ya provistos (inputArgs) con el filtro de escalado/overlay (videoFilter, SIN el
// overlay del logo) y, si existe el archivo del logo de Prensa Abierta en disco, lo
// agrega como segundo input y usa -filter_complex en vez de -vf para superponerlo
// en la esquina superior derecha. Se reutiliza en los 3 modos de render (clips
// reales, imagen de respaldo, color de marca) para no triplicar esta lógica.
//
// durationSec es la duración objetivo del video base: se usa para acotar
// explícitamente el input del logo con "-t". Sin esto (probado en la práctica),
// el logo -loop 1 queda sin límite de duración y el render corre indefinidamente
// hasta que el timeout del worker lo mata ("signal: killed"), en vez de terminar
// cuando termina el video base.
func (e *Engine) buildRenderArgs(inputArgs []string, videoFilter string, outputPath string, encodeArgs []string, durationSec int) []string {
	args := append([]string{"-y"}, inputArgs...)

	if fileExists(e.defaultLogo) {
		filterComplex := fmt.Sprintf(
			"[0:v]%s[vout];[1:v]scale=180:180[logo];[vout][logo]overlay=x=W-w-70:y=70[vfinal]",
			videoFilter,
		)
		safeDuration := durationSec + 2 // margen de seguridad por encima del video base
		if safeDuration <= 2 {
			safeDuration = 15
		}
		args = append(args, "-loop", "1", "-t", fmt.Sprintf("%d", safeDuration), "-i", e.defaultLogo, "-filter_complex", filterComplex, "-map", "[vfinal]")
	} else {
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

// buildCategoryHeader arma el rótulo pequeño mostrado arriba del titular.
func buildCategoryHeader(category string) string {
	if category == "" {
		return "ULTIMA HORA  •  NOTICIAS"
	}
	return fmt.Sprintf("ULTIMA HORA  •  %s", strings.ToUpper(category))
}

const (
	// Valores tomados de la implementación de Node ya retirada (lib/videoGenerator.ts),
	// que ya estaban calibrados para el ancho disponible (1080px - márgenes) a fontsize ~46.
	headlineMaxCharsPerLine = 28
	headlineMaxLines        = 4
)

// sanitizeTextForFFmpeg escapa caracteres especiales del filtro drawtext (comillas,
// dos puntos, porcentaje) y colapsa saltos de línea que vengan del texto original.
// El salto de línea REAL para mostrar el titular en varias líneas se agrega después
// con wrapTextForDrawtext — antes esta función truncaba a 90 caracteres con "...",
// lo que cortaba titulares largos a la mitad en vez de partirlos en líneas.
func sanitizeTextForFFmpeg(text string) string {
	text = strings.ReplaceAll(text, "'", "")
	text = strings.ReplaceAll(text, ":", "\\:")
	text = strings.ReplaceAll(text, "%", "%%")
	text = strings.ReplaceAll(text, "\r", "")
	text = strings.ReplaceAll(text, "\n", " ")
	return strings.TrimSpace(text)
}

// wrapTextForDrawtext parte el texto en líneas de máximo maxCharsPerLine caracteres
// (cortando por palabra completa, nunca a mitad de palabra) para que un titular
// largo haga salto de línea real en vez de solaparse o cortarse. El filtro drawtext
// de FFmpeg soporta saltos de línea reales dentro del texto junto con line_spacing.
func wrapTextForDrawtext(text string, maxCharsPerLine, maxLines int) string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return text
	}

	var lines []string
	current := ""
	for _, w := range words {
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

func (e *Engine) findCategoryTemplateVideo(category string) string {
	contenidoDir := filepath.Join(e.assetsDir, "contenido")
	if _, err := os.Stat(contenidoDir); err != nil {
		return ""
	}

	catLower := strings.ToLower(category)
	entries, err := os.ReadDir(contenidoDir)
	if err != nil {
		return ""
	}

	var matchedFolder string
	for _, entry := range entries {
		if entry.IsDir() {
			nameLower := strings.ToLower(entry.Name())
			if strings.Contains(catLower, nameLower) || strings.Contains(nameLower, catLower) {
				matchedFolder = entry.Name()
				break
			}
		}
	}

	if matchedFolder == "" {
		// Fallback a "Ahora" o primera carpeta
		for _, entry := range entries {
			if entry.IsDir() && strings.ToLower(entry.Name()) == "ahora" {
				matchedFolder = entry.Name()
				break
			}
		}
	}

	if matchedFolder != "" {
		folderPath := filepath.Join(contenidoDir, matchedFolder)
		files, _ := os.ReadDir(folderPath)
		for _, f := range files {
			ext := strings.ToLower(filepath.Ext(f.Name()))
			if ext == ".mp4" || ext == ".mov" || ext == ".webm" {
				return filepath.Join(folderPath, f.Name())
			}
		}
	}

	return ""
}
