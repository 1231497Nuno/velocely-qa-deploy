#!/usr/bin/env bash
# Duplo-clique no Finder — arranca o Velocely (Mac)
# Ambiente = branch git (DEV / QA / PROD) ou VELOCELY_ENV.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/resolve-env.sh"

echo "========================================"
echo "  Velocely — Mac"
echo "========================================"
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker não encontrado."
  echo "Instala Docker Desktop:"
  echo "  https://www.docker.com/products/docker-desktop/"
  read -r -p "Enter para fechar… "
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "A abrir Docker Desktop…"
  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  for _ in $(seq 1 45); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: Docker Desktop ainda não está a correr."
  echo "Abre a app Docker, espera ficar verde, e volta a clicar neste ficheiro."
  read -r -p "Enter para fechar… "
  exit 1
fi

ENV_FILE="$(resolve_env_file "$ROOT" || true)"
if [[ -z "${ENV_FILE:-}" || ! -f "$ENV_FILE" ]]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
  echo "ERRO: Falta o ficheiro de ambiente para a branch «$BRANCH»."
  echo "  DEV  → copia .env.dev.example  para .env.dev"
  echo "  QA   → copia .env.qa.example   para .env.qa"
  echo "  PROD → copia .env.prod.example para .env.prod"
  echo "(Ou usa o legado .env.shared)"
  read -r -p "Enter para fechar… "
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
WEB_PORT="${WEB_PUBLISH_PORT:-3080}"
API_PORT="${API_PUBLISH_PORT:-8000}"
DB="${DB_NAME:-velocely}"
PROJ="${COMPOSE_PROJECT_NAME:-velocely-remote}"

echo "Ambiente: $(basename "$ENV_FILE")  |  BD: $DB  |  projecto Docker: $PROJ"
echo "A preparar (a 1.ª vez pode demorar vários minutos)…"
docker compose -p "$PROJ" -f docker-compose.remote.yml --env-file "$ENV_FILE" up -d --build

echo
echo "A aguardar a API…"
ok=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/docs" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "Ainda não respondeu. Logs:"
  echo "  docker compose -p $PROJ -f docker-compose.remote.yml --env-file $ENV_FILE logs -f"
  read -r -p "Enter para fechar… "
  exit 1
fi

URL="http://localhost:${WEB_PORT}"
echo
echo "OK — Velocely a correr."
echo "  App:   $URL"
echo "  BD:    $DB"
echo "  Login: ${ADMIN_EMAIL:-ver ficheiro .env.*}"
echo
open "$URL" 2>/dev/null || true
read -r -p "Podes fechar esta janela. Enter… "
