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

	// Prepare temporary list for concatenation
	tempDir := filepath.Join(e.outputDir, "temp_"+job.ID)
	_ = os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)

	var preparedClips []string

	// Segmento de imagen temática como PRIMER clip (imagen fija con zoom corto).
	imageSec := 0.0
	if leadImage != "" {
		imageSec = req.LeadImageSec
		if imageSec <= 0 {
			imageSec = float64(total) * 0.4
		}
		if imageSec > 5 {
			imageSec = 5
		}
		if imageSec > float64(total)-3 {
			imageSec = float64(total) - 3
		}
		if imageSec < 2 {
			imageSec = 0 // muy poco tiempo: se omite la imagen
		}
		if imageSec > 0 {
			if seg, err := e.prepareImageSegment(ctx, tempDir, leadImage, imageSec); err == nil {
				preparedClips = append(preparedClips, seg)
			} else {
				log.Printf("[VideoEngine] Warning: no se pudo preparar la imagen líder %s: %v", leadImage, err)
				imageSec = 0
			}
		}
	}

	// Clips de video para el tiempo restante.
	nClips := len(req.ClipURLs)
	if nClips > 3 {
		nClips = 3 // Máx. 3 clips para 10-15s
	}
	remaining := float64(total) - imageSec
	if remaining < 1 {
		remaining = float64(total)
	}
	clipDuration := remaining / float64(nClips)

	videoClipsAdded := 0
	for i := 0; i < nClips; i++ {
		clipURL := req.ClipURLs[i]
		trimmedPath := filepath.Join(tempDir, fmt.Sprintf("clip_%d.mp4", i))

		// Scale & Crop to 9:16 (1080x1920) and trim
		filter := "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p"
		args := []string{
			"-y",
			"-t", fmt.Sprintf("%.2f", clipDuration),
			"-i", clipURL,
			"-vf", filter,
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-pix_fmt", "yuv420p",
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
		videoClipsAdded++
	}

	// Ningún clip de video se pudo preparar (Pexels caído, URLs muertas, etc.): no
	// dejar un video de solo ~4s (el segmento de imagen); animar la imagen la
	// duración completa.
	if videoClipsAdded == 0 {
		if leadImage != "" {
			return e.renderImageZoomVideo(ctx, job, outputPath, leadImage, total)
		}
		if req.ImageURL != "" {
			return e.renderImageZoomVideo(ctx, job, outputPath, req.ImageURL, total)
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
	lo := layoutFor(req.Template)

	videoFilter := strings.Join([]string{
		// Dark box at bottom for legibility
		fmt.Sprintf("drawbox=y=%s:color=black@0.85:width=iw:height=%s:t=fill", lo.boxY, lo.boxH),
		// Punto pulsante + rótulo "ULTIMA HORA • CATEGORÍA"
		categoryHeaderFilters(req.Category, lo),
		// Headline text, con salto de línea real (line_spacing) en vez de recortarse
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=46:x=70:y=%s:line_spacing=%d:fix_bounds=true", cleanHeadline, lo.headY, lo.headLineSpacing),
	}, ",")

	inputArgs := []string{"-f", "concat", "-safe", "0", "-i", concatListFile}
	encodeArgs := []string{"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, total, lo.logoY)
	cmd := exec.CommandContext(ctx, e.ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error al ejecutar FFmpeg: %v (salida: %s)", err, string(output))
	}

	return nil
}

// kenBurnsFilter devuelve la cadena de filtros para hacer zoom-in lento (~10% a lo
// largo de `dur` segundos) sobre una imagen fija: lienzo 1.5x (1620x2880) →
// `scale:eval=frame` (re-evalúa el factor cada frame según `t`, tope min(t/dur,1))
// → `crop` central a 1080x1920. NO se usa `zoompan`, que combinado con `-loop 1`
// dispara muchísimos más frames de los pedidos (bug observado: +1 min de salida
// para un pedido de 6s).
func kenBurnsFilter(dur int) string {
	if dur < 1 {
		dur = 1
	}
	return fmt.Sprintf(
		"scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,"+
			"scale=w='1080*(1+0.10*min(t/%d,1))':h='1920*(1+0.10*min(t/%d,1))':eval=frame,"+
			"crop=1080:1920,setsar=1",
		dur, dur,
	)
}

// prepareImageSegment renderiza una imagen fija (URL) a un .mp4 corto con zoom, con
// los MISMOS parámetros que los clips de video (1080x1920, 30fps, yuv420p, h264)
// para poder concatenarlo como PRIMER segmento de la composición. Devuelve la ruta
// del archivo generado en tempDir.
func (e *Engine) prepareImageSegment(ctx context.Context, tempDir, imageURL string, sec float64) (string, error) {
	localImg, err := e.downloadToTempFile(ctx, imageURL)
	if err != nil {
		return "", err
	}
	defer os.Remove(localImg)

	out := filepath.Join(tempDir, "clip_lead_image.mp4")
	secInt := int(sec + 0.999)
	args := []string{
		"-y",
		"-loop", "1", "-t", fmt.Sprintf("%.2f", sec),
		"-i", localImg,
		"-vf", kenBurnsFilter(secInt) + ",fps=30,format=yuv420p",
		"-c:v", "libx264", "-preset", "ultrafast",
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
//
// La imagen se descarga a un archivo LOCAL antes de `-loop 1 -i`: loopear una
// imagen servida por HTTP hace que FFmpeg no termine solo (sigue "vivo" tras
// escribir todos los frames y el worker lo mata al llegar al timeout).
func (e *Engine) renderImageZoomVideo(ctx context.Context, job *models.VideoJob, outputPath, imageURL string, durationSec int) error {
	req := job.Request
	duration := durationSec
	if duration <= 0 {
		duration = 12
	}

	localImagePath, err := e.downloadToTempFile(ctx, imageURL)
	if err != nil {
		log.Printf("[VideoEngine] Warning: no se pudo descargar la imagen %s: %v", imageURL, err)
		return e.renderFallbackColorVideo(ctx, job, outputPath)
	}
	defer os.Remove(localImagePath)

	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(req.Headline), headlineMaxCharsPerLine, headlineMaxLines)
	lo := layoutFor(req.Template)

	videoFilter := strings.Join([]string{
		kenBurnsFilter(duration),
		fmt.Sprintf("drawbox=y=%s:color=black@0.85:width=iw:height=%s:t=fill", lo.boxY, lo.boxH),
		categoryHeaderFilters(req.Category, lo),
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=46:x=70:y=%s:line_spacing=%d:fix_bounds=true", cleanHeadline, lo.headY, lo.headLineSpacing),
	}, ",")

	inputArgs := []string{"-loop", "1", "-t", fmt.Sprintf("%d", duration), "-i", localImagePath}
	encodeArgs := []string{"-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, duration, lo.logoY)
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
	lo := layoutFor(req.Template)

	videoFilter := strings.Join([]string{
		fmt.Sprintf("drawbox=y=%s:color=black@0.78:width=iw:height=%s:t=fill", lo.boxY, lo.boxH),
		fmt.Sprintf("drawtext=text='PRENSA ABIERTA - PUERTO RICO':fontcolor=yellow:fontsize=36:x=60:y=%s:box=1:boxcolor=red@0.9:boxborderw=10", lo.catTextY),
		fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=40:x=60:y=%s:line_spacing=%d:fix_bounds=true", cleanHeadline, lo.headY, lo.headLineSpacing),
	}, ",")

	inputArgs := []string{"-f", "lavfi", "-i", fmt.Sprintf("color=c=0x1a1a2e:s=1080x1920:d=%d:r=30", duration)}
	encodeArgs := []string{"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"}

	args := e.buildRenderArgs(inputArgs, videoFilter, outputPath, encodeArgs, duration, lo.logoY)
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
//
// El input del logo se acota a durationSec + 2 como margen de seguridad, pero el
// overlay lleva `shortest=1` para que la salida termine EXACTAMENTE cuando termina
// el video base (el input más corto) y no cuando termina el logo — sin esto, la
// salida quedaba ~2s más larga de lo pedido con el b-roll congelado en su último
// frame durante esa cola.
func (e *Engine) buildRenderArgs(inputArgs []string, videoFilter string, outputPath string, encodeArgs []string, durationSec int, logoY int) []string {
	args := append([]string{"-y"}, inputArgs...)

	if logoY <= 0 {
		logoY = 92
	}

	if fileExists(e.defaultLogo) {
		filterComplex := fmt.Sprintf(
			"[0:v]%s[vout];[1:v]scale=240:240[logo];[vout][logo]overlay=x=W-w-60:y=%d:shortest=1[vfinal]",
			videoFilter, logoY,
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

// overlayLayout agrupa las coordenadas de los overlays inferiores (caja oscura,
// rótulo de categoría, titular) y del logo, para poder cambiarlas según la
// plantilla elegida (models.VideoRenderRequest.Template) sin duplicar la lógica en
// los 3 modos de render.
type overlayLayout struct {
	boxY, boxH        string // ej. "ih-520", "520"
	catDotY, catTextY string // ej. "h-441", "h-440"
	headY             string // ej. "h-370"
	headLineSpacing   int
	logoY             int
}

// layoutFor traduce el nombre de plantilla a coordenadas concretas de overlay.
// "reels-safe" (ver .agents/formato-video-reel.md): sube el bloque de titular a la
// safe zone del grid 1:1 (Y:1050–1450 en un lienzo de 1920), deja libres los
// ~430px inferiores para la UI de Reels, separa el logo ≥180px del borde superior
// y compacta el interlineado.
func layoutFor(template string) overlayLayout {
	if template == "reels-safe" {
		return overlayLayout{
			boxY: "ih-880", boxH: "440",
			catDotY: "h-801", catTextY: "h-800",
			headY:           "h-740",
			headLineSpacing: 10,
			logoY:           190,
		}
	}
	return overlayLayout{
		boxY: "ih-520", boxH: "520",
		catDotY: "h-441", catTextY: "h-440",
		headY:           "h-370",
		headLineSpacing: 18,
		logoY:           92,
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
func categoryHeaderFilters(category string, lo overlayLayout) string {
	dot := fmt.Sprintf(
		"drawtext=text='●':fontcolor=%s:fontsize=26:x=70:y=%s:alpha='0.2+0.8*abs(sin(PI*t))'",
		categoryHeaderColor, lo.catDotY,
	)
	text := fmt.Sprintf(
		"drawtext=text='%s':fontcolor=%s:fontsize=36:x=116:y=%s",
		buildCategoryHeader(category), categoryHeaderColor, lo.catTextY,
	)
	return dot + "," + text
}

const (
	// Ancho de línea del titular antes de forzar salto de línea. drawtext de FFmpeg
	// no hace wrap solo, así que wrapTextForDrawtext corta por conteo de caracteres.
	// 38 está calibrado midiendo el render real: lienzo de 1080px, margen izquierdo
	// x=70; con DejaVu Sans Bold a fontsize 46 el ancho medio por carácter ronda los
	// ~24px, así que ~38 caracteres llegan a ~910px y dejan ~100px de aire a la
	// derecha sin tocar el borde. El valor previo (28) cortaba demasiado pronto y
	// dejaba un hueco grande a la derecha.
	headlineMaxCharsPerLine = 38
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
