package video

import (
	"context"
	"fmt"
	"log"
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
		catVideo := e.findCategoryTemplateVideo(req.Category)
		if catVideo != "" {
			req.ClipURLs = []string{catVideo}
		} else {
			// Fallback test color clip if no clip provided
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
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}

	// Concat file
	concatListFile := filepath.Join(tempDir, "concat.txt")
	var sb strings.Builder
	for _, p := range preparedClips {
		sb.WriteString(fmt.Sprintf("file '%s'\n", filepath.ToSlash(p)))
	}
	_ = os.WriteFile(concatListFile, []byte(sb.String()), 0644)

	// Clean escaped headline for FFmpeg drawtext
	cleanHeadline := sanitizeTextForFFmpeg(req.Headline)

	categoryHeader := fmt.Sprintf("ULTIMA HORA  •  %s", strings.ToUpper(req.Category))
	if req.Category == "" {
		categoryHeader = "ULTIMA HORA  •  NOTICIAS"
	}

	videoFilters := []string{
		// Dark box at bottom for legibility
		"drawbox=y=ih-520:color=black@0.85:width=iw:height=520:t=fill",
		// Category header tag
		fmt.Sprintf("drawtext=text='%s':fontcolor=0xFFAA00:fontsize=36:x=70:y=h-440", categoryHeader),
		// Headline text wrapped
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=46:x=70:y=h-370:fix_bounds=true", cleanHeadline),
	}

	filterChain := strings.Join(videoFilters, ",")

	args := []string{
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", concatListFile,
		"-vf", filterChain,
		"-c:v", "libx264",
		"-preset", "veryfast",
		"-crf", "23",
		"-pix_fmt", "yuv420p",
		"-movflags", "+faststart",
		outputPath,
	}

	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error al ejecutar FFmpeg: %v (salida: %s)", err, string(output))
	}

	return nil
}

func (e *Engine) renderFallbackColorVideo(ctx context.Context, job *models.VideoJob, outputPath string) error {
	cleanHeadline := sanitizeTextForFFmpeg(job.Request.Headline)
	duration := job.Request.DurationSec

	filter := fmt.Sprintf(
		"drawbox=y=ih-420:color=black@0.75:width=iw:height=420:t=fill,"+
			"drawtext=text='PRENSA ABIERTA - PUERTO RICO':fontcolor=yellow:fontsize=36:x=60:y=h-360:box=1:boxcolor=red@0.9:boxborderw=10,"+
			"drawtext=text='%s':fontcolor=white:fontsize=44:x=60:y=h-260:fix_bounds=true",
		cleanHeadline,
	)

	args := []string{
		"-y",
		"-f", "lavfi",
		"-i", fmt.Sprintf("color=c=0x1a1a2e:s=1080x1920:d=%d:r=30", duration),
		"-vf", filter,
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-pix_fmt", "yuv420p",
		outputPath,
	}

	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error generando video fallback: %v (salida: %s)", err, string(output))
	}
	return nil
}

func sanitizeTextForFFmpeg(text string) string {
	text = strings.ReplaceAll(text, "'", "")
	text = strings.ReplaceAll(text, ":", "\\:")
	text = strings.ReplaceAll(text, "%", "%%")
	text = strings.ReplaceAll(text, "\n", " ")
	if len(text) > 90 {
		text = text[:87] + "..."
	}
	return text
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
