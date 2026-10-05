package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadLocalEnvironmentFromRootEnv(t *testing.T) {
	root := t.TempDir()
	engineDir := filepath.Join(root, "services", "engine")
	if err := os.MkdirAll(engineDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("ELEVENLABS_API_KEY=test-api-key\n"), 0600); err != nil {
		t.Fatal(err)
	}

	processKey := ""
	hadPreviousKey := false
	for _, variable := range os.Environ() {
		if strings.HasPrefix(variable, "ELEVENLABS_API_KEY=") {
			processKey = strings.TrimPrefix(variable, "ELEVENLABS_API_KEY=")
			hadPreviousKey = true
			break
		}
	}
	if err := os.Unsetenv("ELEVENLABS_API_KEY"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if hadPreviousKey {
			if err := os.Setenv("ELEVENLABS_API_KEY", processKey); err != nil {
				t.Errorf("restore previous environment key: %v", err)
			}
		} else if err := os.Unsetenv("ELEVENLABS_API_KEY"); err != nil {
			t.Errorf("clear test environment key: %v", err)
		}
	})

	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(engineDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})

	loadLocalEnvironment()
	if os.Getenv("ELEVENLABS_API_KEY") != "test-api-key" {
		t.Fatal("expected the project root environment file to enable voice configuration")
	}
}

func TestLoadLocalEnvironmentPreservesProcessEnvironment(t *testing.T) {
	root := t.TempDir()
	engineDir := filepath.Join(root, "services", "engine")
	if err := os.MkdirAll(engineDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("ELEVENLABS_API_KEY=file-api-key\n"), 0600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("ELEVENLABS_API_KEY", "process-api-key")
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(engineDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})

	loadLocalEnvironment()
	if os.Getenv("ELEVENLABS_API_KEY") != "process-api-key" {
		t.Fatal("the project root .env must not override an explicitly configured process key")
	}
}
