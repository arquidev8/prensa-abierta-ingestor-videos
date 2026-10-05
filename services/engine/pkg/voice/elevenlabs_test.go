package voice

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type testRoundTripper func(*http.Request) (*http.Response, error)

func (fn testRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestNewClientFromEnvDisablesVoiceWithoutAPIKey(t *testing.T) {
	t.Setenv("ELEVENLABS_API_KEY", " ")
	if got := NewClientFromEnv(filepath.Join(t.TempDir(), "cache")); got != nil {
		t.Fatal("expected nil client with a missing API key")
	}
}

func TestSpeechSendsConfiguredKeyAndCachesAudio(t *testing.T) {
	cacheDir := filepath.Join(t.TempDir(), "voice-cache")
	calls := 0
	client := newClient(cacheDir, " test-api-key ", &http.Client{
		Transport: testRoundTripper(func(req *http.Request) (*http.Response, error) {
			calls++
			if got := req.Header.Get("xi-api-key"); got != "test-api-key" {
				t.Fatalf("unexpected ElevenLabs API key header: %q", got)
			}
			if req.Header.Get("Accept") != "audio/mpeg" {
				t.Fatalf("unexpected audio response type: %q", req.Header.Get("Accept"))
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("test-mp3-audio")),
				Header:     make(http.Header),
				Request:    req,
			}, nil
		}),
	})

	path, err := client.Speech(context.Background(), "Titular de prueba.")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "test-mp3-audio" {
		t.Fatalf("unexpected cached speech: content=%q err=%v", got, err)
	}

	cachedPath, err := client.Speech(context.Background(), "Titular de prueba.")
	if err != nil {
		t.Fatal(err)
	}
	if cachedPath != path {
		t.Fatal("expected repeated speech to reuse the same cached audio")
	}
	if calls != 1 {
		t.Fatalf("expected one API request for cached speech, got %d", calls)
	}
}

func TestNewClientPreservesEnvironmentModelAndVoice(t *testing.T) {
	t.Setenv("ELEVENLABS_VOICE_ID", "configured-voice")
	t.Setenv("ELEVENLABS_MODEL_ID", "configured-model")
	client := newClient(t.TempDir(), "test-api-key", &http.Client{Transport: testRoundTripper(func(req *http.Request) (*http.Response, error) {
		return nil, nil
	})})
	if client == nil || client.voiceID != "configured-voice" || client.modelID != "configured-model" {
		t.Fatalf("configured ElevenLabs settings not used: %#v", client)
	}
}

func TestNewClientFromCacheCachesSynthesizedAudio(t *testing.T) {
	calls := 0
	client := NewClientFromCache(t.TempDir(), "test-api-key", func(_ context.Context, text string) ([]byte, error) {
		calls++
		if text != "Titular de prueba." {
			t.Errorf("synthesized unexpected text %q", text)
		}
		return []byte("synthetic test audio"), nil
	})
	first, err := client.Speech(context.Background(), "Titular de prueba.")
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.Speech(context.Background(), "Titular de prueba.")
	if err != nil {
		t.Fatal(err)
	}
	if first != second || calls != 1 {
		t.Fatalf("expected one cached synthesis, first=%q second=%q calls=%d", first, second, calls)
	}
}
