#!/usr/bin/env bash
# Duplo-clique — para o Velocely (Mac)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/resolve-env.sh"

echo "A parar Velocely…"

ENV_FILE="$(resolve_env_file "$ROOT" || true)"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    PROJ="${COMPOSE_PROJECT_NAME:-velocely-remote}"
    docker compose -p "$PROJ" -f docker-compose.remote.yml --env-file "$ENV_FILE" down 2>/dev/null || true
  fi
  [[ -f .env.shared ]] && docker compose -f docker-compose.remote.yml --env-file .env.shared down 2>/dev/null || true
  [[ -f .env.staging ]] && docker compose --env-file .env.staging down 2>/dev/null || true
fi

pkill -f "uvicorn server:app" 2>/dev/null || true
pkill -f "craco start" 2>/dev/null || true

echo "Parado."
read -r -p "Enter… "
