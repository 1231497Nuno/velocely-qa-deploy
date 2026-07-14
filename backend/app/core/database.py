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
    """Sequential numbering that resets per year, e.g. ORC-2026-0001."""
    year = datetime.now(timezone.utc).year
    key = f"{prefix}-{year}"
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = doc["seq"]
    return f"{prefix}-{year}-{seq:04d}"
