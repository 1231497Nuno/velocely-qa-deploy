#!/usr/bin/env bash
# Carrega dados de teste na BD do ambiente staging.
#
# Por defeito chama a API em Docker (POST /api/seed).
# Para seed directo à BD (incl. --reset):
#   ./scripts/seed-staging.sh --direct
#   ./scripts/seed-staging.sh --direct --reset
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
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

API_URL="${SEED_API_URL:-http://127.0.0.1:${API_PUBLISH_PORT:-8000}}"

cd "$ROOT/backend"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi
# Python no macOS (Homebrew/python.org) muitas vezes falha TLS sem o CA do certifi
if command -v python >/dev/null 2>&1; then
  _ca="$(python -c 'import certifi; print(certifi.where())' 2>/dev/null || true)"
  if [[ -n "${_ca}" ]]; then
    export SSL_CERT_FILE="${SSL_CERT_FILE:-$_ca}"
    export REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-$_ca}"
  fi
fi

if [[ "${1:-}" == "--direct" ]]; then
  shift
  # Usa MONGO_URL/DB_NAME já exportados do .env.staging / .env.shared
  # Se for a URL interna Docker (mongodb://mongo:27017), troca para localhost
  if [[ "${MONGO_URL:-}" == *"mongodb://mongo:"* ]]; then
    export MONGO_URL="mongodb://127.0.0.1:${MONGO_PUBLISH_PORT:-27018}"
  fi
  # --env-file garante Atlas/local mesmo se backend/.env apontar para outro sítio
  exec python scripts/seed_dev.py --env-file "$ROOT/$ENV_FILE" "$@"
fi

exec python scripts/seed_dev.py --api --url "$API_URL" "$@"
