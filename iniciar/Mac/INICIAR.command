#!/usr/bin/env bash
# Duplo-clique no Finder — arranca o Velocely (Mac)
# Usa a base de dados na cloud (.env.shared) + Docker Desktop.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env.shared"

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

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: Falta o ficheiro .env.shared na pasta do projeto."
  echo "Copia .env.shared.example para .env.shared e preenche (ou pede o ficheiro a quem configurou)."
  read -r -p "Enter para fechar… "
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
WEB_PORT="${WEB_PUBLISH_PORT:-3080}"
API_PORT="${API_PUBLISH_PORT:-8000}"

echo "A preparar (a 1.ª vez pode demorar vários minutos)…"
docker compose -f docker-compose.remote.yml --env-file "$ENV_FILE" up -d --build

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
  echo "  docker compose -f docker-compose.remote.yml --env-file .env.shared logs -f"
  read -r -p "Enter para fechar… "
  exit 1
fi

URL="http://localhost:${WEB_PORT}"
echo
echo "OK — Velocely a correr."
echo "  App:   $URL"
echo "  Login: ${ADMIN_EMAIL:-ver .env.shared}"
echo
open "$URL" 2>/dev/null || true
read -r -p "Podes fechar esta janela. Enter… "
