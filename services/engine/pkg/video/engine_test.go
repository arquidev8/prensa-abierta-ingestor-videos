package video

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"github.com/prensa-abierta/ingestor-engine/pkg/voice"
)

func TestWriteConcatFileUsesPathsRelativeToManifest(t *testing.T) {
	tempDir := t.TempDir()
	clipPath := filepath.Join(tempDir, "clip_lead_image.mp4")
	manifestPath := filepath.Join(tempDir, "concat.txt")
	if err := os.WriteFile(clipPath, []byte("clip"), 0600); err != nil {
		t.Fatal(err)
	}

	outsideDir := t.TempDir()
	outsideClip := filepath.Join(outsideDir, "outside.mp4")
	if err := os.WriteFile(outsideClip, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeConcatFile(manifestPath, tempDir, []string{clipPath, outsideClip}); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "file 'clip_lead_image.mp4'\n"+"file '../"+filepath.Base(outsideDir)+"/outside.mp4'\n" {
		t.Fatalf("unexpected concat manifest: %q", contents)
	}
}

func TestWriteConcatFilePropagatesErrors(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("clip on another Windows volume", func(t *testing.T) {
		if runtime.GOOS != "windows" {
			t.Skip("Windows paths on separate volumes")
		}
		volume := filepath.VolumeName(tempDir)
		if volume == "" {
			t.Skip("no volume in temporary directory")
		}
		otherVolume := "Z:"
		if strings.EqualFold(volume, otherVolume) {
			otherVolume = "Y:"
		}
		err := writeConcatFile(filepath.Join(tempDir, "concat.txt"), tempDir, []string{otherVolume + `\\outside\\clip.mp4`})
		if err == nil || !strings.Contains(err.Error(), "resolver la ruta del clip") {
			t.Fatalf("expected cross-volume relative-path error, got %v", err)
		}
	})

	t.Run("unwritable manifest", func(t *testing.T) {
		missingDir := filepath.Join(tempDir, "missing")
		err := writeConcatFile(filepath.Join(missingDir, "concat.txt"), tempDir, []string{filepath.Join(tempDir, "clip.mp4")})
		if err == nil || !strings.Contains(err.Error(), "escribir") {
			t.Fatalf("expected manifest write error, got %v", err)
		}
	})
}

func TestFFmpegConcatManifestOpensRelativeClip(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("reproduces the FFmpeg concat relative-path behavior on Windows")
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}

	if strings.TrimSpace(os.Getenv("FFMPEG_PATH")) == "" {
		t.Setenv("PATH", filepath.Dir(ffmpeg)+string(os.PathListSeparator)+os.Getenv("PATH"))
	}

	tempDir := t.TempDir()
	clipPath := filepath.Join(tempDir, "clip_lead_image.mp4")
	manifestPath := filepath.Join(tempDir, "concat.txt")
	createClip := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=red:s=160x120:r=5:d=0.4",
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clipPath,
	)
	if output, err := createClip.CombinedOutput(); err != nil {
		t.Fatalf("create test clip: %v: %s", err, output)
	}
	if err := writeConcatFile(manifestPath, tempDir, []string{clipPath}); err != nil {
		t.Fatal(err)
	}

	render := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error",
		"-f", "concat", "-safe", "0", "-i", manifestPath,
		"-frames:v", "1", "-f", "null", "-",
	)
	if output, err := render.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg could not open clip listed in concat manifest: %v: %s", err, output)
	}
}

func TestHeadlineWithPercentSignAndSpecialChars(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}

	headline := "UPR recortará 20% de plazas: crisis 'total' {100%}"
	clean := wrapTextForDrawtext(sanitizeTextForFFmpeg(headline), headlineMaxCharsPerLine, headlineMaxLines)

	fontCandidates := []string{
		filepath.Join("..", "..", "..", "..", "assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
		filepath.Join("..", "..", "..", "assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
		filepath.Join("..", "..", "assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
		filepath.Join("assets", "fonts", "DejaVu", "DejaVuSans-Bold.ttf"),
		filepath.Join(os.Getenv("WINDIR"), "Fonts", "arialbd.ttf"),
		filepath.Join(os.Getenv("WINDIR"), "Fonts", "arial.ttf"),
	}
	fontFile := ""
	for _, f := range fontCandidates {
		if fileExists(f) {
			fontFile = f
			break
		}
	}
	if fontFile == "" {
		t.Skip("DejaVu font not found")
	}

	filter := fmt.Sprintf("drawtext=fontfile='%s':text='%s':expansion=none:fontcolor=white:fontsize=24",
		escapeFontFilePath(fontFile), clean)

	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=black:s=200x200:d=0.2",
		"-vf", filter,
		"-frames:v", "1", "-f", "null", "-",
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg drawtext falló con signo de porcentaje y caracteres especiales: %v\nSalida:\n%s", err, output)
	}
}

func TestReproduceNoticentroRender(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}

	tempDir := t.TempDir()
	assetsDir := filepath.Join("..", "..", "..", "assets")
	e := NewEngine(ffmpeg, assetsDir, tempDir, 1, "", "")

	job := &models.VideoJob{
		ID: "test-noticentro",
		Request: models.VideoRenderRequest{
			NewsID:       "738e4fc1-836a-49ac-99f3-5d7dd991b567",
			Headline:     "Solicitud de NotiCentro destapa nueva petición de la defensa de Elvia Cabrera",
			Category:     "Noticias",
			Template:     "standard",
			DurationSec:  12,
			LeadImageURL: "https://bloximages.newyork1.vip.townnews.com/wapa.tv/content/tncms/assets/v3/editorial/2/45/245bd51d-122f-51d9-bdf1-0f70f12cebed/6ab87bf0b98cd.image.png?crop=1499%2C787%2C0%2C146&resize=1200%2C630&order=crop%2Cresize",
			ClipURLs:     []string{"https://res.cloudinary.com/yobvezme/video/upload/v1788798625/prensa-abierta/contenido/Ahora/Ahora%205.mp4"},
			VoiceText:    "Noticias. Solicitud de NotiCentro destapa nueva petición de la defensa de Elvia Cabrera.",
		},
	}

	outputPath := filepath.Join(tempDir, "output.mp4")
	if err := e.executeFFmpegRender(t.Context(), job, outputPath); err != nil {
		t.Fatalf("executeFFmpegRender falló: %v", err)
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		t.Fatalf("outputPath no existe: %v", err)
	}
	t.Logf("outputPath size before voiceover: %d bytes", info.Size())

	// Probar mezcla de locución con un sintetizador de audio
	voiceClient := voice.NewClientFromCache(tempDir, "test-key", func(ctx context.Context, text string) ([]byte, error) {
		audioFile := filepath.Join(tempDir, "test_speech.mp3")
		createAudio := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
			"-f", "lavfi", "-i", "sine=frequency=440:duration=6",
			"-c:a", "libmp3lame", audioFile,
		)
		if out, err := createAudio.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("crear audio: %v (%s)", err, out)
		}
		return os.ReadFile(audioFile)
	})
	e.SetVoice(voiceClient)

	voiceStatus := e.applyVoiceover(t.Context(), job, outputPath)
	if voiceStatus != "ok" {
		t.Fatalf("applyVoiceover devolvió status no ok: %q", voiceStatus)
	}

	infoAfter, err := os.Stat(outputPath)
	if err != nil {
		t.Fatalf("outputPath no existe tras locución: %v", err)
	}
	t.Logf("outputPath size after voiceover: %d bytes", infoAfter.Size())
	if infoAfter.Size() < 1_000_000 {
		t.Fatalf("outputPath tras locución es demasiado pequeño (%d bytes), posible pérdida de video", infoAfter.Size())
	}

	// Verificar con verifyMediaStreams que contiene TANTO video como audio
	if err := e.verifyMediaStreams(t.Context(), outputPath); err != nil {
		t.Fatalf("verifyMediaStreams falló tras locución: %v", err)
	}
}

func TestHeadlineDynamicWrappingAndLayoutProtection(t *testing.T) {
	headline := "Miles de clientes de LUMA en San Juan amanecen sin luz por avería"
	cleanText := sanitizeTextForFFmpeg(headline)

	fontSizes := []int{46, 54, 60}
	for _, fs := range fontSizes {
		maxChars := computeMaxCharsPerLine(fs, 70, "")
		wrapped := wrapTextForDrawtext(cleanText, maxChars, 4)
		lines := strings.Split(wrapped, "\n")

		// 1. Verificar que ninguna línea exceda el límite seguro de caracteres
		for idx, line := range lines {
			if len(line) > maxChars {
				t.Errorf("fontSize %d: line %d exceeds maxChars %d: %q (len %d)", fs, idx, maxChars, line, len(line))
			}
		}

		// 2. Verificar que todas las palabras clave estén presentes (no cortadas ni truncadas)
		for _, word := range []string{"Miles", "clientes", "LUMA", "San", "Juan", "amanecen", "luz", "avería"} {
			if !strings.Contains(wrapped, word) {
				t.Errorf("fontSize %d: palabra esperada %q no está en el titular envuelto: %q", fs, word, wrapped)
			}
		}

		// 3. Probar adjustLayoutForContent con banner promocional activo y verificar espacios seguros
		lo := layoutFor("standard")
		lo.showPromo = true
		lo.promoWidth = 650
		lo.headFontSize = fs
		lo = adjustLayoutForContent(lo, wrapped, fs)

		// Verificar que el titular esté estrictamente arriba del banner con separación adecuada
		var headlineTop int
		fmt.Sscanf(lo.headY, "%d", &headlineTop)
		headlineBottom := headlineTop + (len(lines)-1)*(fs+lo.headLineSpacing) + int(float64(fs)*1.15)
		gap := lo.promoY - headlineBottom
		if gap < 24 {
			t.Errorf("fontSize %d: gap insuficiente entre titular y banner (%d px, esperado >= 24)", fs, gap)
		}
		if lo.promoY+int(float64(lo.promoWidth)*(1058.0/4492.0)) > canvasHeight-30 {
			t.Errorf("fontSize %d: banner desborda el margen inferior de seguridad", fs)
		}
	}
}

func TestRenderSampleFrame(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}

	headline := "Miles de clientes de LUMA en San Juan amanecen sin luz por avería"
	fs := 54
	maxChars := computeMaxCharsPerLine(fs, 70, "")
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headline), maxChars, 4)

	lo := layoutFor("standard")
	lo.showPromo = true
	lo.promoWidth = 650
	lo.headFontSize = fs
	lo.headColor = "white"
	lo.headerColor = categoryHeaderColor
	lo.boxColor = "black"
	lo.boxOpacity = 0.85
	lo.headFontFile = filepath.Join(os.Getenv("WINDIR"), "Fonts", "arialbd.ttf")
	lo = adjustLayoutForContent(lo, cleanHeadline, fs)

	videoFilter := strings.Join([]string{
		fmt.Sprintf("drawbox=y=%s:color=%s@%.2f:width=iw:height=%s:t=fill", lo.boxY, lo.boxColor, lo.boxOpacity, lo.boxH),
		fmt.Sprintf("drawtext=text='●':fontcolor=%s:fontsize=26:x=70:y=%s%s", lo.headerColor, lo.catDotY, fontFileClause(lo.headFontFile)),
		fmt.Sprintf("drawtext=text='ULTIMA HORA  •  LOCAL':fontcolor=%s:fontsize=36:x=116:y=%s%s", lo.headerColor, lo.catTextY, fontFileClause(lo.headFontFile)),
		fmt.Sprintf("drawtext=text='%s':expansion=none:fontcolor=%s:fontsize=%d:x=%d:y=%s:line_spacing=%d:fix_bounds=true%s", cleanHeadline, lo.headColor, lo.headFontSize, lo.headX, lo.headY, lo.headLineSpacing, fontFileClause(lo.headFontFile)),
	}, ",")

	promoPath := `c:\Users\Hector\Documents\codigo\Ingestor-videos\assets\logos\descargar-app-gratis.jpg`
	filterComplex := fmt.Sprintf(
		"[0:v]%s[vout];[1:v]scale=%d:-1[promo];[vout][promo]overlay=x=(W-w)/2:y=%d:shortest=1[vfinal]",
		videoFilter, lo.promoWidth, lo.promoY,
	)

	outImg := `C:\Users\Hector\.gemini\antigravity\brain\7415b610-1960-4219-8fd2-9b0a0fc995d5\scratch\test_go_render.png`
	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1080x1920:d=1",
		"-i", promoPath,
		"-filter_complex", filterComplex,
		"-map", "[vfinal]",
		"-frames:v", "1",
		outImg,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("render sample frame: %v (%s)", err, out)
	}
}

func TestRenderCanvaCenterAndManualBreaks(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not in PATH")
	}

	headline := "Miles de clientes de LUMA\nen San Juan amanecen\nsin luz por avería"
	fs := 50
	maxChars := computeMaxCharsPerLine(fs, 80, "")
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headline), maxChars, 4)

	e := &Engine{}

	lo := layoutFor("standard")
	lo.showPromo = true
	lo.promoWidth = 600
	lo.headFontSize = fs
	lo.headColor = "white"
	lo.headerColor = categoryHeaderColor
	lo.headAlign = "center"
	lo.boxColor = "black"
	lo.boxOpacity = 0.85
	lo.headFontFile = filepath.Join(os.Getenv("WINDIR"), "Fonts", "arialbd.ttf")
	lo = adjustLayoutForContent(lo, cleanHeadline, fs)

	videoFilter := strings.Join([]string{
		fmt.Sprintf("drawbox=y=%s:color=%s@%.2f:width=iw:height=%s:t=fill", lo.boxY, lo.boxColor, lo.boxOpacity, lo.boxH),
		e.categoryHeaderFilters("Economía", lo),
		e.buildHeadlineDrawtext(cleanHeadline, lo),
	}, ",")

	promoPath := `c:\Users\Hector\Documents\codigo\Ingestor-videos\assets\logos\descargar-app-gratis.jpg`
	filterComplex := fmt.Sprintf(
		"[0:v]%s[vout];[1:v]scale=%d:-1[promo];[vout][promo]overlay=x=(W-w)/2:y=%d:shortest=1[vfinal]",
		videoFilter, lo.promoWidth, lo.promoY,
	)

	outImg := `C:\Users\Hector\.gemini\antigravity\brain\7415b610-1960-4219-8fd2-9b0a0fc995d5\scratch\test_canva_render.png`
	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1080x1920:d=1",
		"-i", promoPath,
		"-filter_complex", filterComplex,
		"-map", "[vfinal]",
		"-frames:v", "1",
		outImg,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("render Canva sample frame: %v (%s)", err, out)
	}
}

func TestRenderEnlargedFontSize(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not in PATH")
	}

	headline := "Miles de clientes de LUMA en San Juan amanecen sin luz por avería"
	fs := 63
	headX := 70
	maxChars := computeMaxCharsPerLine(fs, headX, "")
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headline), maxChars, 4)

	t.Logf("fs: %d, maxChars: %d, wrapped:\n%s", fs, maxChars, cleanHeadline)

	e := &Engine{}

	lo := layoutFor("standard")
	lo.showPromo = true
	lo.promoWidth = 560
	lo.headFontSize = fs
	lo.headX = headX
	lo.headColor = "white"
	lo.headerColor = categoryHeaderColor
	lo.headAlign = "left"
	lo.boxColor = "black"
	lo.boxOpacity = 0.85
	lo.headFontFile = filepath.Join(os.Getenv("WINDIR"), "Fonts", "arialbd.ttf")
	lo = adjustLayoutForContent(lo, cleanHeadline, fs)

	videoFilter := strings.Join([]string{
		fmt.Sprintf("drawbox=y=%s:color=%s@%.2f:width=iw:height=%s:t=fill", lo.boxY, lo.boxColor, lo.boxOpacity, lo.boxH),
		e.categoryHeaderFilters("Economía", lo),
		e.buildHeadlineDrawtext(cleanHeadline, lo),
	}, ",")

	promoPath := `c:\Users\Hector\Documents\codigo\Ingestor-videos\assets\logos\descargar-app-gratis.jpg`
	filterComplex := fmt.Sprintf(
		"[0:v]%s[vout];[1:v]scale=%d:-1[promo];[vout][promo]overlay=x=(W-w)/2:y=%d:shortest=1[vfinal]",
		videoFilter, lo.promoWidth, lo.promoY,
	)

	outImg := `C:\Users\Hector\.gemini\antigravity\brain\7415b610-1960-4219-8fd2-9b0a0fc995d5\scratch\test_enlarged_63.png`
	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1080x1920:d=1",
		"-i", promoPath,
		"-filter_complex", filterComplex,
		"-map", "[vfinal]",
		"-frames:v", "1",
		outImg,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("render enlarged frame: %v (%s)", err, out)
	}
}

func TestRenderDonOmarHeadline(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not in PATH")
	}

	headline := "Sospechoso de robo a sargento en Caguas fue arrestado en expreso PR-52"
	fs := 46
	headX := 74
	fontFile := filepath.Join(os.Getenv("WINDIR"), "Fonts", "arialbd.ttf")
	maxChars := computeMaxCharsPerLine(fs, headX, fontFile)
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headline), maxChars, headlineMaxLines)

	e := &Engine{}

	lo := layoutFor("app-promo")
	lo.showPromo = true
	lo.promoWidth = 560
	lo.headFontSize = fs
	lo.headX = headX
	lo.headColor = "white"
	lo.headerColor = categoryHeaderColor
	lo.headAlign = "left"
	lo.boxColor = "black"
	lo.boxOpacity = 0.85
	lo.headFontFile = fontFile
	lo = adjustLayoutForContent(lo, cleanHeadline, fs)

	var boxTop, boxH int
	fmt.Sscanf(lo.boxY, "%d", &boxTop)
	fmt.Sscanf(lo.boxH, "%d", &boxH)

	cardImg := createTestCard(1000, boxH, 32, 0, 0, 0, 220, 255, 85, 0, 95, 3.0)
	cardPath := filepath.Join(t.TempDir(), "card.png")
	cf, err := os.Create(cardPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(cf, cardImg); err != nil {
		t.Fatal(err)
	}
	cf.Close()

	textFilters := strings.Join([]string{
		e.categoryHeaderFilters("Farándula", lo),
		e.buildHeadlineDrawtext(cleanHeadline, lo),
	}, ",")

	promoPath := `c:\Users\Hector\Documents\codigo\Ingestor-videos\assets\logos\descargar-app-gratis.jpg`
	roundedPromoPath, _ := createTestRoundedPromo(promoPath, 64.0)
	if roundedPromoPath != "" {
		promoPath = roundedPromoPath
	}

	filterComplex := fmt.Sprintf(
		"[0:v][1:v]overlay=x=40:y=%d[vcard];"+
			"[vcard]%s[vtext];"+
			"[2:v]scale=%d:-1[promo];"+
			"[vtext][promo]overlay=x=(W-w)/2:y=%d:shortest=1[vfinal]",
		boxTop, textFilters, lo.promoWidth, lo.promoY,
	)

	outImg := `C:\Users\Hector\.gemini\antigravity\brain\7415b610-1960-4219-8fd2-9b0a0fc995d5\scratch\test_donomar_card.png`
	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1080x1920:d=1",
		"-i", cardPath,
		"-i", promoPath,
		"-filter_complex", filterComplex,
		"-map", "[vfinal]",
		"-frames:v", "1",
		outImg,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("render Don Omar frame: %v (%s)", err, out)
	}
}

func createTestRoundedPromo(srcPath string, radius float64) (string, error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	src, _, err := image.Decode(f)
	if err != nil {
		return "", err
	}

	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	bw := 5.0

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
				c := src.At(b.Min.X+x, b.Min.Y+y)
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

	outPath := filepath.Join(os.TempDir(), "test_promo_rounded.png")
	of, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer of.Close()
	return outPath, png.Encode(of, out)
}

func createTestCard(width, height, radius int, bgR, bgG, bgB, bgA, bR, bG, bB, bA uint8, bw float64) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	r := float64(radius)
	w := float64(width)
	h := float64(height)

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
					img.SetRGBA(x, y, color.RGBA{R: bR, G: bG, B: bB, A: bA})
				} else {
					img.SetRGBA(x, y, color.RGBA{R: bgR, G: bgG, B: bgB, A: bgA})
				}
			} else if dist <= r+1.0 {
				alpha := (1.0 - (dist - r)) * (float64(bA) / 255.0)
				img.SetRGBA(x, y, color.RGBA{R: bR, G: bG, B: bB, A: uint8(alpha * 255)})
			}
		}
	}
	return img
}

func TestBoxerHeadlineRenderAt65(t *testing.T) {
	assetsDir := filepath.Join("..", "..", "..", "..", "assets")
	absAssets, _ := filepath.Abs(assetsDir)
	e := &Engine{
		ffmpegPath:  "ffmpeg",
		assetsDir:   absAssets,
		outputDir:   t.TempDir(),
		defaultLogo: filepath.Join(absAssets, "logos", "prensa_abierta_logo.png"),
		promoImage:  filepath.Join(absAssets, "logos", "descargar-app-gratis.jpg"),
	}

	headline := "¿Qué le pasó “Lobito” Torres? Murió días después de desplomarse al terminar una pelea"
	fontSize := 65
	fontFile := e.fontFileFor("league_spartan")
	maxChars := computeMaxCharsPerLine(fontSize, 74, fontFile)
	cleanHeadline := wrapTextForDrawtext(sanitizeTextForFFmpeg(headline), maxChars, 5)

	lo := layoutFor("standard")
	lo.showPromo = true
	lo.promoWidth = 560
	lo.headFontSize = fontSize
	lo.headColor = "white"
	lo.headerColor = "0xFF5500"
	lo.headX = 74
	lo.headLineSpacing = 18
	lo.headFontFile = fontFile
	lo = adjustLayoutForContent(lo, cleanHeadline, fontSize)

	rp := e.getRoundedPromoImage()
	t.Logf("e.promoImage=%s (exists=%v), roundedPromo=%s (exists=%v)", e.promoImage, fileExists(e.promoImage), rp, fileExists(rp))

	// Verificar márgenes
	lines := strings.Count(cleanHeadline, "\n") + 1
	linePitch := int(float64(fontSize)*1.25) + lo.headLineSpacing
	headlineH := (lines-1)*linePitch + int(float64(fontSize)*1.20)

	var headlineTop int
	fmt.Sscanf(lo.headY, "%d", &headlineTop)
	expectedPromoMin := headlineTop + headlineH + 20

	if lo.promoY < expectedPromoMin {
		t.Fatalf("Promo banner overlaps text! promoY=%d, text ends at %d", lo.promoY, expectedPromoMin)
	}

	// Renderizar frame real con FFmpeg y guardarlo en scratch
	cardPath, err := e.generateRoundedCardPNG(1000, lo.cardH, 32, "black", 0.85)
	if err != nil {
		t.Fatalf("Error generando card PNG: %v", err)
	}
	lo.cardImagePath = cardPath

	outPng := filepath.Join("..", "..", "scratch", "boxer_verified_65.png")
	_ = os.MkdirAll(filepath.Dir(outPng), 0755)

	videoFilter := strings.Join([]string{
		e.categoryHeaderFilters("NOTICIAS", lo),
		e.buildHeadlineDrawtext(cleanHeadline, lo),
	}, ",")

	inputArgs := []string{"-f", "lavfi", "-i", "color=c=0x111118:s=1080x1920:d=1"}
	encodeArgs := []string{"-frames:v", "1"}
	args := e.buildRenderArgs(inputArgs, videoFilter, outPng, encodeArgs, 1, lo)

	cmd := exec.Command("ffmpeg", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("FFmpeg failed: %v\nOutput: %s", err, string(out))
	}

	t.Logf("Successfully rendered boxer_verified_65.png at promoY=%d, cardH=%d, cardY=%d", lo.promoY, lo.cardH, lo.cardY)
}

