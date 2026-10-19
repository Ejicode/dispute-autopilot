package config

import (
	"bufio"
	"os"
	"strings"
)

// LoadEnvFiles loads .env files with the same precedence Next.js applies:
//
//	.env.<mode>.local, .env.local, .env.<mode>, .env
//
// Variables already present in the process environment always win, and earlier
// files win over later ones. The mode suffix uses NODE_ENV (defaulting to
// "development"), matching @next/env.
func LoadEnvFiles() {
	mode := os.Getenv("NODE_ENV")
	if mode == "" {
		mode = "development"
	}

	// Track keys seen across files so the first definition wins.
	seen := map[string]bool{}
	for _, key := range os.Environ() {
		if name, _, ok := strings.Cut(key, "="); ok {
			seen[name] = true
		}
	}

	for _, name := range []string{
		".env." + mode + ".local",
		".env.local",
		".env." + mode,
		".env",
	} {
		loadEnvFile(name, seen)
	}
}

func loadEnvFile(name string, seen map[string]bool) {
	file, err := os.Open(name)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		key, value, ok := parseEnvLine(scanner.Text())
		if !ok || seen[key] {
			continue
		}
		seen[key] = true
		if err := os.Setenv(key, value); err != nil {
			return
		}
	}
}

// parseEnvLine parses a single dotenv assignment, returning ok=false for blank
// lines and comments.
func parseEnvLine(line string) (string, string, bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")
	key, value, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", "", false
	}
	value = strings.TrimSpace(value)
	// Strip a single layer of matching quotes, like dotenv.
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	return key, value, true
}
