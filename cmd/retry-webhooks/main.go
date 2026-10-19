// Command retry-webhooks sweeps the PayPal webhook inbox for retryable events.
// It mirrors the maintenance script the deployment ran on a schedule.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"strconv"
	"text/tabwriter"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

var ownerPattern = regexp.MustCompile(`^usr_[a-f0-9]{32}$`)

func main() {
	config.LoadEnvFiles()
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		eventID   string
		limit     = 100
		force     bool
		list      bool
		usageText = "Usage: retry-webhooks [--list] [--limit 100] [--event-id EVENT_ID --force]"
	)
	args := os.Args[1:]
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--event-id":
			index++
			if index >= len(args) {
				return fmt.Errorf("--event-id requires a value")
			}
			eventID = args[index]
		case "--limit":
			index++
			if index >= len(args) {
				return fmt.Errorf("--limit requires a value")
			}
			parsed, err := strconv.Atoi(args[index])
			if err != nil {
				return fmt.Errorf("--limit must be between 1 and 1000")
			}
			limit = parsed
		case "--force":
			force = true
		case "--list":
			list = true
		default:
			return fmt.Errorf("%s", usageText)
		}
	}
	if limit < 1 || limit > 1000 {
		return fmt.Errorf("--limit must be between 1 and 1000")
	}
	if force && eventID == "" {
		return fmt.Errorf("--force requires --event-id")
	}

	owner := os.Getenv("PAYPAL_MERCHANT_USER_ID")
	if owner == "" || !ownerPattern.MatchString(owner) {
		return fmt.Errorf("Set PAYPAL_MERCHANT_USER_ID to the configured integration owner.")
	}
	mode, err := config.ApplicationMode()
	if err != nil {
		return err
	}
	user, err := auth.AccountByID(context.Background(), owner)
	if err != nil {
		return err
	}
	if user == nil {
		return fmt.Errorf("Configured merchant account does not exist in this DATA_DIR.")
	}
	ctx, err := scope.With(context.Background(), owner, mode, user)
	if err != nil {
		return err
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}

	if list {
		rows, err := db.Query(ctx, `SELECT event_id, event_type, state, attempts, next_attempt_at, last_error
			FROM webhook_inbox WHERE state NOT IN ('PROCESSED','IGNORED') ORDER BY received_at LIMIT ?`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		writer := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		fmt.Fprintln(writer, "EVENT_ID\tEVENT_TYPE\tSTATE\tATTEMPTS\tNEXT_ATTEMPT_AT\tLAST_ERROR")
		for rows.Next() {
			var (
				id, eventType, state string
				attempts             int64
				nextAttempt          int64
				lastError            *string
			)
			if err := rows.Scan(&id, &eventType, &state, &attempts, &nextAttempt, &lastError); err != nil {
				return err
			}
			message := ""
			if lastError != nil {
				message = *lastError
			}
			fmt.Fprintf(writer, "%s\t%s\t%s\t%d\t%d\t%s\n", id, eventType, state, attempts, nextAttempt, message)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return writer.Flush()
	}

	outcomes, err := paypal.RetryWebhookEvents(ctx, paypal.RetryOptions{Limit: limit, EventID: eventID, Force: force})
	if err != nil {
		return err
	}
	writer := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(writer, "EVENT_ID\tSTATUS\tSTATUS_CODE\tMESSAGE")
	failed := false
	for _, outcome := range outcomes {
		fmt.Fprintf(writer, "%s\t%s\t%d\t%s\n", outcome.EventID, outcome.Status, outcome.StatusCode, outcome.Message)
		if outcome.StatusCode >= 400 {
			failed = true
		}
	}
	if err := writer.Flush(); err != nil {
		return err
	}

	stateRows, err := db.Query(ctx, `SELECT state, COUNT(*) FROM webhook_inbox GROUP BY state`)
	if err != nil {
		return err
	}
	defer stateRows.Close()
	stateWriter := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(stateWriter, "STATE\tCOUNT")
	for stateRows.Next() {
		var (
			state string
			count int64
		)
		if err := stateRows.Scan(&state, &count); err != nil {
			return err
		}
		fmt.Fprintf(stateWriter, "%s\t%d\n", state, count)
		if state == "DEAD_LETTER" && count > 0 {
			failed = true
		}
	}
	if err := stateRows.Err(); err != nil {
		return err
	}
	if err := stateWriter.Flush(); err != nil {
		return err
	}

	if failed {
		log.Println("Webhook retry requires attention; inspect failed/dead-letter receipts.")
		os.Exit(1)
	}
	return nil
}
