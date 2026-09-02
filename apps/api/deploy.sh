#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="compose.prod.yaml"
ENV_FILE=".env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found. Copy .env.example to .env and fill in the secrets."
  exit 1
fi

echo "Building images..."
docker compose -f "$COMPOSE_FILE" build --pull

echo "Starting infrastructure..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis mosquitto clamav

echo "Waiting for Postgres to be healthy..."
docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c \
  'until pg_isready -U smartcura -d smartcura; do sleep 1; done'

echo "Applying database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm api npm run db:migrate

echo "Starting API, worker and Caddy..."
docker compose -f "$COMPOSE_FILE" up -d api worker caddy

echo "Deployment complete. Check status with: docker compose -f $COMPOSE_FILE ps"
