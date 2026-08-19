package video

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// Engine handles video assembly and rendering via FFmpeg
type Engine struct {
	ffmpegPath  string
	assetsDir   string
	outputDir   string
	defaultLogo string
	jobs        map[string]*models.VideoJob
}

// NewEngine creates a new FFmpeg video rendering engine
func NewEngine(ffmpegPath, assetsDir, outputDir string) *Engine {
	if ffmpegPath == "" {
		ffmpegPath = os.Getenv("FFMPEG_PATH")
		if ffmpegPath == "" {
			ffmpegPath = "ffmpeg"
		}
	}

	_ = os.MkdirAll(outputDir, 0755)
	_ = os.MkdirAll(assetsDir, 0755)

	logoPath := filepath.Join(assetsDir, "logos", "prensa_abierta_logo.png")

	return &Engine{
		ffmpegPath:  ffmpegPath,
		assetsDir:   assetsDir,
		outputDir:   outputDir,
		defaultLogo: logoPath,
		jobs:        make(map[string]*models.VideoJob),
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

	e.jobs[jobID] = job
	return job
}

// GetJob retrieves the status of a render job
func (e *Engine) GetJob(jobID string) (*models.VideoJob, bool) {
	job, exists := e.jobs[jobID]
	return job, exists
}

// RenderVideo executes FFmpeg to assemble a 10-15s vertical video
func (e *Engine) RenderVideo(ctx context.Context, jobID string) (*models.VideoJob, error) {
	job, exists := e.jobs[jobID]
	if !exists {
		return nil, fmt.Errorf("trabajo %s no encontrado", jobID)
	}

	job.Status = "processing"
	job.Progress = 10

	outputFilename := fmt.Sprintf("video_%s_%d.mp4", job.Request.NewsID, time.Now().Unix())
	outputPath := filepath.Join(e.outputDir, outputFilename)

	log.Printf("[VideoEngine] Iniciando renderizado de video para '%s' (Duración: %ds, Salida: %s)",
		job.Request.Headline, job.Request.DurationSec, outputPath)

	// Build FFmpeg command
	err := e.executeFFmpegRender(ctx, job, outputPath)
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		log.Printf("[VideoEngine ERROR] Fallo renderizado de %s: %v", jobID, err)
		return job, err
	}

	now := time.Now()
	job.Status = "completed"
	job.Progress = 100
	job.OutputPath = outputPath
	job.OutputURL = "/videos/" + outputFilename
	job.CompletedAt = &now

	log.Printf("[VideoEngine ✅] Video generado exitosamente: %s", outputPath)
	return job, nil
}

func (e *Engine) executeFFmpegRender(ctx context.Context, job *models.VideoJob, outputPath string) error {
	req := job.Request
	clipDuration := float64(req.DurationSec) / float64(len(req.ClipURLs))
	if len(req.ClipURLs) == 0 {
		// Fallback test color clip if no clip provided
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}

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
		filter := fmt.Sprintf("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30")
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

	// Drawtext overlay with banner and Prensa Abierta branding
	// Using standard drawbox + drawtext filters
	videoFilters := []string{
		// Dark gradient at bottom for legibility
		"drawbox=y=ih-420:color=black@0.75:width=iw:height=420:t=fill",
		// Prensa Abierta brand tag
		"drawtext=text='PRENSA ABIERTA':fontcolor=yellow:fontsize=38:x=60:y=h-360:box=1:boxcolor=red@0.9:boxborderw=10",
		// Headline text wrapped
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=48:x=60:y=h-260:fix_bounds=true", cleanHeadline),
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
