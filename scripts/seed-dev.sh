#!/usr/bin/env bash
# Atalho: carrega dados de teste na BD de desenvolvimento.
# Uso (raiz do repo):
#   ./scripts/seed-dev.sh
#   ./scripts/seed-dev.sh --reset
#   ./scripts/seed-dev.sh --api
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
elif [[ -f .venv/Scripts/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/Scripts/activate
fi

exec python scripts/seed_dev.py "$@"
