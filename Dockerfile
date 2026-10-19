# syntax=docker/dockerfile:1

# --- Stage 1: static frontend export -------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: Go backend -------------------------------------------------
FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# modernc.org/sqlite is pure Go, so the server needs no C toolchain.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

# --- Stage 3: runtime ----------------------------------------------------
FROM alpine:3.20
RUN adduser -D -u 10001 app
WORKDIR /app
COPY --from=backend /server /app/server
COPY --from=frontend /app/out /app/out
RUN mkdir -p /var/data && chown -R app:app /var/data /app
ENV PORT=3000 \
    WEB_DIR=/app/out \
    DATA_DIR=/var/data \
    APP_MODE=demo
EXPOSE 3000
USER app
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/app/server"]
