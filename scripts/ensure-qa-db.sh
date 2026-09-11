#!/usr/bin/env bash
# Cria / marca a base Mongo QA (vazia de negócio) no mesmo cluster Atlas.
# Uso: ./scripts/ensure-qa-db.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE=""
if [[ -f .env.qa ]]; then
  ENV_FILE=".env.qa"
elif [[ -f .env.shared ]]; then
  ENV_FILE=".env.shared"
else
  echo "ERRO: falta .env.qa (ou .env.shared)."
  echo "Copia .env.qa.example → .env.qa e preenche MONGO_URL."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export DB_NAME="${DB_NAME_QA:-velocely_qa}"
export MONGO_URL

if [[ -z "${MONGO_URL:-}" ]]; then
  echo "ERRO: MONGO_URL vazio em $ENV_FILE"
  exit 1
fi

cd backend
# shellcheck disable=SC1091
source .venv/bin/activate
python - <<'PY'
import asyncio
import os
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    url = os.environ["MONGO_URL"]
    name = os.environ.get("DB_NAME", "velocely_qa")
    client = AsyncIOMotorClient(url)
    db = client[name]
    await db["_meta"].update_one(
        {"_id": "ambiente"},
        {"$set": {
            "ambiente": "qa",
            "db_name": name,
            "nota": "Base QA — sem dados de negócio. Admin criado no 1.º arranque da API.",
            "atualizado_em": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    cols = await db.list_collection_names()
    print(f"OK — base «{name}» pronta no cluster.")
    print(f"Coleções: {cols or '(vazia até ao 1.º arranque da API)'}")
    client.close()

asyncio.run(main())
PY
