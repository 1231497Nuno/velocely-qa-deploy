from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
import uuid

from app.core import config

client = AsyncIOMotorClient(config.MONGO_URL)
db = client[config.DB_NAME]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def round2(v: float) -> float:
    return round(v + 1e-9, 2)


async def next_sequence(prefix: str) -> str:
    """Compatibilidade: ORC/ENC/OF/REC → códigos configuráveis.

    Preferir `app.services.numeracao.next_codigo(chave)`.
    """
    from app.services.numeracao import next_codigo, NUMERACAO_DEFAULTS

    prefix_map = {v["prefix"]: k for k, v in NUMERACAO_DEFAULTS.items()}
    chave = prefix_map.get((prefix or "").upper())
    if chave:
        return await next_codigo(chave)
    year = datetime.now(timezone.utc).year
    key = f"{prefix}-{year}"
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"{prefix}-{year}-{doc['seq']:04d}"
