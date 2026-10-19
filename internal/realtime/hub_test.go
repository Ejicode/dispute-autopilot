package realtime

import (
	"context"
	"testing"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

func channelContext(t *testing.T, mode config.Mode) context.Context {
	t.Helper()
	ctx, err := scope.With(context.Background(), "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", mode, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

// TestPublishIsolatedByEnvironment ports the test-environments.ts check
// "realtime notifications are isolated by environment": a publish from a sandbox
// scope must not reach the demo channel for the same merchant, and vice versa.
func TestPublishIsolatedByEnvironment(t *testing.T) {
	const merchant = "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	demoCtx := channelContext(t, config.ModeDemo)
	sandboxCtx := channelContext(t, config.ModeSandbox)

	demoCh, cancelDemo := Default().Subscribe(Channel(config.ModeDemo, merchant))
	t.Cleanup(cancelDemo)
	sandboxCh, cancelSandbox := Default().Subscribe(Channel(config.ModeSandbox, merchant))
	t.Cleanup(cancelSandbox)

	drain := func(ch <-chan Event) []Event {
		var events []Event
		for {
			select {
			case ev := <-ch:
				events = append(events, ev)
			default:
				return events
			}
		}
	}

	Default().Publish(sandboxCtx, "DISPUTE_OPENED", map[string]any{"mode": "sandbox"})

	if got := drain(demoCh); len(got) != 0 {
		t.Fatalf("demo channel received sandbox event: %v", got)
	}
	sandboxEvents := drain(sandboxCh)
	if len(sandboxEvents) != 1 || sandboxEvents[0].Type != "DISPUTE_OPENED" {
		t.Fatalf("sandbox channel events = %v", sandboxEvents)
	}

	Default().Publish(demoCtx, "DISPUTE_OPENED", map[string]any{"mode": "demo"})

	demoEvents := drain(demoCh)
	if len(demoEvents) != 1 || demoEvents[0].Type != "DISPUTE_OPENED" {
		t.Fatalf("demo channel events = %v", demoEvents)
	}
	if extra := drain(sandboxCh); len(extra) != 0 {
		t.Fatalf("sandbox channel received demo event: %v", extra)
	}
}

func TestPublishWithoutScopeIsNoop(t *testing.T) {
	ch, cancel := Default().Subscribe("system_event:demo:demo")
	t.Cleanup(cancel)

	Default().Publish(context.Background(), "DISPUTE_OPENED", map[string]any{})

	select {
	case ev := <-ch:
		t.Fatalf("unscoped publish delivered %v", ev)
	case <-time.After(20 * time.Millisecond):
	}
}
