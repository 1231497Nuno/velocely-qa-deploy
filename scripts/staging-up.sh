#!/usr/bin/env bash
# Arranca o ambiente staging (Docker): Mongo + API + UI
# Uso:
#   ./scripts/staging-up.sh           # stack local com Mongo no Docker
#   ./scripts/staging-up.sh --remote  # API+UI com MONGO_URL (Atlas) no .env.staging
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  if [[ -f .env.shared ]]; then
    ENV_FILE=".env.shared"
  else
    ENV_FILE=".env.staging"
  fi
fi
MODE="local"

if [[ "${1:-}" == "--remote" ]]; then
  MODE="remote"
  shift || true
fi

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ "$ENV_FILE" == ".env.shared" ]]; then
    echo "A criar .env.shared a partir de .env.shared.example…"
    cp .env.shared.example "$ENV_FILE"
  else
    echo "A criar $ENV_FILE a partir de .env.staging.example…"
    cp .env.staging.example "$ENV_FILE"
  fi
  echo "Edita $ENV_FILE (MONGO_URL Atlas, JWT_SECRET, passwords) e volta a correr."
  exit 1
fi

if [[ "$MODE" == "remote" ]]; then
  echo "→ Stack remota (Atlas / Mongo externo)"
  docker compose -f docker-compose.remote.yml --env-file "$ENV_FILE" up -d --build
else
  echo "→ Stack completa (Mongo + API + UI)"
  docker compose --env-file "$ENV_FILE" up -d --build
fi

echo
echo "A aguardar API…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${API_PUBLISH_PORT:-8000}/docs" >/dev/null 2>&1; then
    echo "OK"
    echo "  App:  http://localhost:${WEB_PUBLISH_PORT:-3080}"
    echo "  API:  http://localhost:${API_PUBLISH_PORT:-8000}/docs"
    echo
    echo "Seguinte: ./scripts/seed-staging.sh"
    exit 0
  fi
  sleep 2
done
echo "Timeout — vê: docker compose logs -f api"
exit 1
