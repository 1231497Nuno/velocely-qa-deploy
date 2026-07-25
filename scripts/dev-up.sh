#!/usr/bin/env bash
# Arranca Mongo (se necessário), API e frontend de desenvolvimento.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="${NVM_DIR}/versions/node/$(ls "$NVM_DIR/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

pkill -f "uvicorn server:app" 2>/dev/null || true
pkill -f "craco start" 2>/dev/null || true
sleep 1

# API — sem --reload para não cair com o terminal
cd "$ROOT/backend"
# shellcheck disable=SC1091
source .venv/bin/activate
nohup uvicorn server:app --host 127.0.0.1 --port 8000 > /tmp/velocely-api.log 2>&1 &
echo "API pid $!"

# Frontend
cd "$ROOT/frontend"
test -f .env || cp .env.example .env
BROWSER=none HOST=127.0.0.1 PORT=3000 nohup npm start > /tmp/velocely-fe.log 2>&1 &
echo "FE  pid $!"

echo "A aguardar..."
for i in $(seq 1 30); do
  A=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/docs || true)
  F=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || true)
  if [ "$A" = "200" ] && [ "$F" = "200" ]; then
    echo "OK — App http://127.0.0.1:3000  |  API http://127.0.0.1:8000/docs"
    exit 0
  fi
  sleep 1
done
echo "Timeout. Ver /tmp/velocely-api.log e /tmp/velocely-fe.log"
exit 1
