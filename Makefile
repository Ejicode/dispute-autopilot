GO ?= go
NPM ?= npm
BIN_DIR := bin
SERVER := $(BIN_DIR)/server

.PHONY: all build frontend backend dev start seed bench test test-attacks test-webhooks backup-database retry-webhooks clean

all: build

# --- Build --------------------------------------------------------------

# Build the statically exported frontend consumed by the Go server.
frontend:
	$(NPM) ci
	$(NPM) run build

# Compile every Go binary into ./bin.
backend:
	$(GO) build -o $(SERVER) ./cmd/server
	$(GO) build -o $(BIN_DIR)/seed ./cmd/seed
	$(GO) build -o $(BIN_DIR)/bench ./cmd/bench
	$(GO) build -o $(BIN_DIR)/retry-webhooks ./cmd/retry-webhooks
	$(GO) build -o $(BIN_DIR)/backup-database ./cmd/backup-database

# Full production build: static frontend export + Go binaries.
build: frontend backend

# --- Run ----------------------------------------------------------------

# Build the frontend export if needed, then run the API/server locally.
dev: backend
	$(GO) run ./cmd/server

# Run the compiled binary (build first with `make build`).
start: build
	$(SERVER)

# --- Maintenance --------------------------------------------------------

seed:
	$(GO) run ./cmd/seed

bench:
	$(GO) run ./cmd/bench

# `make backup-database ARGS="data/auth.db /tmp/auth.backup.db"`
backup-database:
	$(GO) run ./cmd/backup-database $(ARGS)

# `make retry-webhooks ARGS="--list"`
retry-webhooks:
	$(GO) run ./cmd/retry-webhooks $(ARGS)

# --- Verification -------------------------------------------------------

test:
	$(GO) test ./...

test-attacks:
	$(GO) test ./internal/trustlab/ -count=1 -v

test-webhooks:
	$(GO) test ./internal/paypal/ -count=1

# --- Housekeeping -------------------------------------------------------

clean:
	rm -rf bin out .next
	rm -f data/*.db data/*.db-shm data/*.db-wal
	rm -rf data/merchants data/environments
