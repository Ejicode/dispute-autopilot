// Package realtime is a per-merchant publish/subscribe hub backing the SSE stream.
package realtime

import (
	"context"
	"sync"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

// Event is a server-sent system event.
type Event struct {
	Type      string `json:"type"`
	Payload   any    `json:"payload"`
	Timestamp string `json:"timestamp"`
}

// Hub broadcasts events to subscribers keyed by channel.
type Hub struct {
	mu     sync.Mutex
	nextID int
	subs   map[string]map[int]chan Event
}

var defaultHub = &Hub{subs: map[string]map[int]chan Event{}}

// Default returns the process-wide hub.
func Default() *Hub { return defaultHub }

func channelFor(mode config.Mode, merchantID string) string {
	return "system_event:" + string(mode) + ":" + merchantID
}

// Publish emits an event to the current merchant's channel. It is a no-op when
// no scope is present (events are advisory, never load-bearing).
func (h *Hub) Publish(ctx context.Context, eventType string, payload any) {
	sc, err := scope.From(ctx)
	if err != nil {
		return
	}
	h.publishTo(channelFor(sc.Mode, sc.MerchantID), Event{
		Type:      eventType,
		Payload:   payload,
		Timestamp: config.NowISO(),
	})
}

// PublishRaw emits to an explicit channel (used by tests).
func (h *Hub) PublishRaw(channel, eventType string, payload any) {
	h.publishTo(channel, Event{Type: eventType, Payload: payload, Timestamp: config.NowISO()})
}

func (h *Hub) publishTo(channel string, event Event) {
	h.mu.Lock()
	targets := make([]chan Event, 0, len(h.subs[channel]))
	for _, ch := range h.subs[channel] {
		targets = append(targets, ch)
	}
	h.mu.Unlock()
	for _, ch := range targets {
		select {
		case ch <- event:
		default:
			// Slow consumer: drop rather than block the publisher.
		}
	}
}

// Subscribe registers a buffered subscriber for a channel.
func (h *Hub) Subscribe(channel string) (<-chan Event, func()) {
	ch := make(chan Event, 64)
	h.mu.Lock()
	if h.subs[channel] == nil {
		h.subs[channel] = map[int]chan Event{}
	}
	id := h.nextID
	h.nextID++
	h.subs[channel][id] = ch
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		if m, ok := h.subs[channel]; ok {
			if _, present := m[id]; present {
				delete(m, id)
				close(ch)
			}
			if len(m) == 0 {
				delete(h.subs, channel)
			}
		}
		h.mu.Unlock()
	}
	return ch, cancel
}

// Channel returns the channel name for a mode/merchant pair.
func Channel(mode config.Mode, merchantID string) string { return channelFor(mode, merchantID) }
