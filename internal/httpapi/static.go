package httpapi

import (
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/httpx"
)

// static serves the Next.js static export and falls back to the app shell for
// client-routed pages (including the dynamic /case/<id> detail route).
func (a *API) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
	if strings.HasPrefix(clean, "/api") {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"error": "Not found."})
		return
	}

	rel := strings.TrimPrefix(clean, "/")
	if rel == "" {
		if a.serveFile(w, r, "index.html") {
			return
		}
		http.NotFound(w, r)
		return
	}
	if a.serveFile(w, r, rel) {
		return
	}
	if a.serveFile(w, r, rel+"/index.html") {
		return
	}

	// The dynamic case detail page ships as a placeholder shell; the client
	// resolves the real dispute id from the browser path.
	if clean == "/case" || strings.HasPrefix(clean, "/case/") {
		if a.serveFile(w, r, "case/_/index.html") {
			return
		}
	}

	if a.serveFileAs(w, r, "404.html", http.StatusNotFound) {
		return
	}
	if a.serveFile(w, r, "index.html") {
		return
	}
	http.NotFound(w, r)
}

func (a *API) resolve(rel string) (string, os.FileInfo, bool) {
	full := filepath.Join(a.webDir, filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return "", nil, false
	}
	return full, info, true
}

func (a *API) serveFile(w http.ResponseWriter, r *http.Request, rel string) bool {
	full, _, ok := a.resolve(rel)
	if !ok {
		return false
	}
	http.ServeFile(w, r, full)
	return true
}

// serveFileAs serves a file with an explicit status (used for the 404 shell).
func (a *API) serveFileAs(w http.ResponseWriter, r *http.Request, rel string, status int) bool {
	full, _, ok := a.resolve(rel)
	if !ok {
		return false
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return false
	}
	if contentType := mime.TypeByExtension(filepath.Ext(full)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
	return true
}
