package config

import (
	"os"
	"path/filepath"
	"testing"
)

// TestApplicationModeDefaultsToDemo ports the test-environments.ts check
// "missing APP_MODE is offline demo" plus the fail-closed handling for an
// unknown value ("'typo'").
func TestApplicationModeDefaultsToDemo(t *testing.T) {
	t.Setenv("APP_MODE", "demo")
	if err := os.Unsetenv("APP_MODE"); err != nil {
		t.Fatalf("unset APP_MODE: %v", err)
	}
	mode, err := ApplicationMode()
	if err != nil {
		t.Fatalf("ApplicationMode with unset APP_MODE: %v", err)
	}
	if mode != ModeDemo {
		t.Fatalf("expected demo, got %q", mode)
	}
}

func TestApplicationModeUnknownFailsClosed(t *testing.T) {
	for _, value := range []string{"typo", "DEMO", "staging", " "} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("APP_MODE", value)
			if _, err := ApplicationMode(); err == nil {
				t.Fatalf("APP_MODE=%q should have failed closed", value)
			} else if got := err.Error(); got != "APP_MODE must be demo, sandbox, or live" {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestApplicationModeKnownValues(t *testing.T) {
	for _, mode := range []Mode{ModeDemo, ModeSandbox, ModeLive} {
		t.Run(string(mode), func(t *testing.T) {
			t.Setenv("APP_MODE", string(mode))
			got, err := ApplicationMode()
			if err != nil {
				t.Fatalf("ApplicationMode: %v", err)
			}
			if got != mode {
				t.Fatalf("expected %q, got %q", mode, got)
			}
			if MustApplicationMode() != mode {
				t.Fatalf("MustApplicationMode mismatch for %q", mode)
			}
		})
	}
}

func TestProvenanceFor(t *testing.T) {
	cases := map[Mode]Provenance{
		ModeDemo:    ProvenanceDemo,
		ModeSandbox: ProvenancePayPalSandbox,
		ModeLive:    ProvenancePayPalLive,
	}
	for mode, want := range cases {
		if got := ProvenanceFor(mode); got != want {
			t.Errorf("ProvenanceFor(%q) = %q, want %q", mode, got, want)
		}
	}
}

func TestProduction(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("NODE_ENV", "test")
	if Production() {
		t.Fatalf("non-production environment reported production")
	}
	t.Setenv("NODE_ENV", "production")
	if !Production() {
		t.Fatalf("NODE_ENV=production should report production")
	}
	t.Setenv("NODE_ENV", "test")
	t.Setenv("APP_ENV", "production")
	if !Production() {
		t.Fatalf("APP_ENV=production should report production")
	}
}

func TestOrigin(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:3000")
	if got := Origin(); got != "http://localhost:3000" {
		t.Fatalf("Origin() = %q", got)
	}
}

// trackEnv registers cleanup that restores each key to its prior value (or
// removes it), so LoadEnvFiles side effects never leak between tests.
func trackEnv(t *testing.T, keys ...string) {
	t.Helper()
	for _, key := range keys {
		prev, ok := os.LookupEnv(key)
		t.Cleanup(func() {
			if ok {
				_ = os.Setenv(key, prev)
				return
			}
			_ = os.Unsetenv(key)
		})
	}
}

func writeEnvFile(t *testing.T, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(name), []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// TestLoadEnvFilesPrecedence ports the @next/env ordering contract:
// .env.<mode>.local > .env.local > .env.<mode> > .env, with the process
// environment always winning.
func TestLoadEnvFilesPrecedence(t *testing.T) {
	keys := []string{
		"DA_TEST_A", "DA_TEST_B", "DA_TEST_C", "DA_TEST_D",
		"DA_TEST_PROCESS", "DA_TEST_QUOTED", "DA_TEST_SINGLE",
		"DA_TEST_URL", "DA_TEST_EXPORTED",
	}
	trackEnv(t, keys...)
	for _, key := range keys {
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("unset %s: %v", key, err)
		}
	}

	t.Chdir(t.TempDir())
	t.Setenv("NODE_ENV", "development")

	writeEnvFile(t, ".env", `DA_TEST_A=env
DA_TEST_B=env
DA_TEST_C=env
DA_TEST_D=env
DA_TEST_PROCESS=fromfile
DA_TEST_QUOTED="hello world"
DA_TEST_SINGLE='single value'
DA_TEST_URL=https://example.test/path?a=b
# a comment line is ignored
export DA_TEST_EXPORTED=exported
`)
	writeEnvFile(t, ".env.development", "DA_TEST_C=mode\nDA_TEST_D=mode\n")
	writeEnvFile(t, ".env.local", "DA_TEST_B=localfile\nDA_TEST_D=local\n")
	writeEnvFile(t, ".env.development.local", "DA_TEST_A=modelocal\n")

	if err := os.Setenv("DA_TEST_PROCESS", "process-wins"); err != nil {
		t.Fatalf("set process env: %v", err)
	}

	LoadEnvFiles()

	expected := map[string]string{
		"DA_TEST_A":        "modelocal",
		"DA_TEST_B":        "localfile",
		"DA_TEST_C":        "mode",
		"DA_TEST_D":        "local",
		"DA_TEST_PROCESS":  "process-wins",
		"DA_TEST_QUOTED":   "hello world",
		"DA_TEST_SINGLE":   "single value",
		"DA_TEST_URL":      "https://example.test/path?a=b",
		"DA_TEST_EXPORTED": "exported",
	}
	for key, want := range expected {
		if got := os.Getenv(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
}

func TestLoadEnvFilesMissingFilesAreIgnored(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("NODE_ENV", "production")
	// No .env* files exist; the call must be a no-op rather than panic.
	LoadEnvFiles()
}

func TestParseEnvLine(t *testing.T) {
	cases := []struct {
		line  string
		key   string
		value string
		ok    bool
	}{
		{"", "", "", false},
		{"   ", "", "", false},
		{"# comment", "", "", false},
		{"KEY=value", "KEY", "value", true},
		{"  export KEY=value  ", "KEY", "value", true},
		{`Q="quoted value"`, "Q", "quoted value", true},
		{"S='single'", "S", "single", true},
		{"URL=http://x?a=b=c", "URL", "http://x?a=b=c", true},
		{"NOEQUALS", "", "", false},
		{"=value", "", "", false},
	}
	for _, tc := range cases {
		key, value, ok := parseEnvLine(tc.line)
		if ok != tc.ok || key != tc.key || value != tc.value {
			t.Errorf("parseEnvLine(%q) = (%q,%q,%v), want (%q,%q,%v)",
				tc.line, key, value, ok, tc.key, tc.value, tc.ok)
		}
	}
}
