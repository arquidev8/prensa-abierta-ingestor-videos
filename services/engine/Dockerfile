# --- Etapa 1: Build ---
FROM golang:1.24 AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

# --- Etapa 2: Runtime con FFmpeg ---
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /out/server ./server

EXPOSE 8080
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV ASSETS_DIR=/app/assets

CMD ["./server"]
