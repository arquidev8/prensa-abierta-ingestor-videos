package video

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

func TestApplyVoiceoverMixesGeneratedAudioIntoFinalMP4(t *testing.T) {
	ffmpeg := strings.TrimSpace(os.Getenv("FFMPEG_PATH"))
	if ffmpeg == "" {
		var err error
		ffmpeg, err = exec.LookPath("ffmpeg")
		if err != nil {
			t.Skip("ffmpeg not installed")
		}
	}

	root := t.TempDir()
	outputPath := filepath.Join(root, "video.mp4")
	audioPath := filepath.Join(root, "voice.mp3")
	createAudio := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=1",
		"-c:a", "libmp3lame", audioPath,
	)
	if result, err := createAudio.CombinedOutput(); err != nil {
		t.Fatalf("crear audio sintético: %v: %s", err, result)
	}

	createVideo := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=160x120:r=5:d=3",
		"-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", outputPath,
	)
	if result, err := createVideo.CombinedOutput(); err != nil {
		t.Fatalf("crear MP4 de prueba: %v: %s", err, result)
	}

	engine := NewEngine(ffmpeg, t.TempDir(), t.TempDir(), 1, "", "")
	if err := engine.mixVoiceover(context.Background(), outputPath, audioPath, "adelay=300|300", outputPath+".voice.mp4"); err != nil {
		t.Fatal(err)
	}

	probeOutput, err := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "info", "-i", outputPath+".voice.mp4", "-f", "null", "-").CombinedOutput()
	if err != nil {
		t.Fatalf("verificar pistas del MP4 final: %v: %s", err, probeOutput)
	}
	if !strings.Contains(string(probeOutput), "Video:") {
		t.Fatalf("el MP4 final no contiene pista de video: %s", probeOutput)
	}
	if !strings.Contains(string(probeOutput), "Audio:") {
		t.Fatalf("el MP4 final no contiene pista de audio: %s", probeOutput)
	}
	if err := engine.verifyMediaStreams(context.Background(), outputPath+".voice.mp4"); err != nil {
		t.Fatalf("verifyMediaStreams reportó error en MP4 válido: %v", err)
	}
}

func TestApplyVoiceoverWithoutClientReportsDisabled(t *testing.T) {
	engine := NewEngine("ffmpeg", t.TempDir(), t.TempDir(), 1, "", "")
	job := &models.VideoJob{ID: "no-voice-test", Request: models.VideoRenderRequest{VoiceText: "Titular"}}
	if got := engine.applyVoiceover(context.Background(), job, filepath.Join(t.TempDir(), "video.mp4")); got != "disabled" {
		t.Fatalf("expected disabled voice status, got %q", got)
	}
}
