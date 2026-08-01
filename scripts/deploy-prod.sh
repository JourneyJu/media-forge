#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/docker/.env.prod"
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy infra/docker/.env.prod.example and fill production values first." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "==> Pull latest code"
git pull --ff-only

echo "==> Validate compose config"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "==> Build application images"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build web auth service worker

echo "==> Start infrastructure and application"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "==> Show service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "==> Health checks"
PUBLIC_ORIGIN="$(grep -E '^PUBLIC_ORIGIN=' "$ENV_FILE" | tail -n 1 | cut -d '=' -f 2-)"
curl -fsSk "$PUBLIC_ORIGIN/health" >/dev/null
curl -fsSk "$PUBLIC_ORIGIN/auth/password-key" >/dev/null

echo "Deployment completed: $PUBLIC_ORIGIN"
