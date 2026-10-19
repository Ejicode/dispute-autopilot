// Command server runs the Dispute Autopilot HTTP API and serves the statically
// exported frontend from a single binary.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpapi"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

func main() {
	config.LoadEnvFiles()

	mode, err := config.ApplicationMode()
	if err != nil {
		log.Fatalf("startup: %v", err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	webDir := os.Getenv("WEB_DIR")
	if webDir == "" {
		webDir = "./out"
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.New(webDir),
		ReadHeaderTimeout: 10 * time.Second,
		// SSE streams and PDF packets are long-lived; no write timeout applies.
		IdleTimeout: 120 * time.Second,
	}

	stop := make(chan struct{})
	// PayPal retry work stays on this service because SQLite is local to it.
	if mode != config.ModeDemo && os.Getenv("PAYPAL_MERCHANT_USER_ID") != "" {
		go retryLoop(stop, mode)
	}

	go func() {
		log.Printf("Dispute Autopilot listening on :%s | mode=%s | web=%s", port, mode, webDir)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals

	close(stop)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
	store.Close()
}

// retryLoop sweeps the PayPal webhook inbox every minute, mirroring the retry
// worker the previous Node deployment ran alongside Next.js.
func retryLoop(stop <-chan struct{}, mode config.Mode) {
	run := func() {
		ownerID := os.Getenv("PAYPAL_MERCHANT_USER_ID")
		owner, err := auth.AccountByID(context.Background(), ownerID)
		if err != nil {
			log.Printf("webhook retry: owner lookup failed: %v", err)
			return
		}
		if owner == nil {
			log.Printf("webhook retry: configured merchant %q does not exist in this DATA_DIR", ownerID)
			return
		}
		ctx, err := scope.With(context.Background(), owner.ID, mode, owner)
		if err != nil {
			log.Printf("webhook retry: %v", err)
			return
		}
		outcomes, err := paypal.RetryWebhookEvents(ctx, paypal.RetryOptions{Limit: 100})
		if err != nil {
			log.Printf("webhook retry: %v", err)
			return
		}
		attention := false
		for _, outcome := range outcomes {
			if outcome.StatusCode >= 400 {
				attention = true
				log.Printf("webhook retry: %s -> %d %s", outcome.EventID, outcome.StatusCode, outcome.Message)
			}
		}
		if dead, err := deadLetterCount(ctx); err == nil && dead > 0 {
			attention = true
			log.Printf("webhook retry: %d dead-letter receipt(s) require attention", dead)
		}
		if attention {
			log.Printf("webhook retry: inspect failed/dead-letter receipts")
		}
	}

	run()
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			run()
		}
	}
}

func deadLetterCount(ctx context.Context) (int64, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM webhook_inbox WHERE state = 'DEAD_LETTER'").Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}
