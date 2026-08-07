#!/usr/bin/env bash
# Duplo-clique — para o Velocely (Mac)
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "A parar Velocely…"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [[ -f .env.shared ]]; then
    docker compose -f docker-compose.remote.yml --env-file .env.shared down 2>/dev/null || true
  else
    docker compose -f docker-compose.remote.yml down 2>/dev/null || true
  fi
  [[ -f .env.staging ]] && docker compose --env-file .env.staging down 2>/dev/null || true
fi

pkill -f "uvicorn server:app" 2>/dev/null || true
pkill -f "craco start" 2>/dev/null || true

echo "Parado."
read -r -p "Enter… "
