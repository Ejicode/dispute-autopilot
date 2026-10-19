package httpapi

import (
	"io"
	"net/http"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// eventsStream serves the per-merchant server-sent event channel.
func (a *API) eventsStream(w http.ResponseWriter, r *http.Request, user *types.UserAccount) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return httpx.Errorf(http.StatusInternalServerError, "Streaming is not supported.")
	}
	sc, err := scope.From(r.Context())
	if err != nil {
		return err
	}
	events, unsubscribe := realtime.Default().Subscribe(realtime.Channel(sc.Mode, user.ID))
	defer unsubscribe()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Every write re-checks the session so revocations and expiry close live streams.
	writeRaw := func(text string) bool {
		if current, _ := auth.SessionUser(r); current == nil || current.ID != user.ID {
			return false
		}
		if _, err := io.WriteString(w, text); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	connected, err := httpx.Marshal(map[string]any{"type": "CONNECTED", "timestamp": config.NowISO()})
	if err != nil {
		return err
	}
	if !writeRaw("data: " + string(connected) + "\n\n") {
		return nil
	}

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return nil
		case <-ticker.C:
			if !writeRaw(": ping\n\n") {
				return nil
			}
		case event, ok := <-events:
			if !ok {
				return nil
			}
			payload, err := httpx.Marshal(event)
			if err != nil {
				continue
			}
			if !writeRaw("data: " + string(payload) + "\n\n") {
				return nil
			}
		}
	}
}
