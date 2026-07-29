"""Numeração sequencial configurável (códigos / referências).

Formato típico:
  · Catálogo / clientes — ART-0001 (sem ano, por defeito)
  · Documentos — ORC-2026-0001 (com ano)

Os prefixos são editáveis em Definições → Referências.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.database import db
from app.repositories import (
    artigos_repo, maquinas_repo, consumiveis_repo, mao_obra_repo,
    tipos_repo, clientes_repo, empresa_repo, categorias_repo, subcategorias_repo,
)

NUMERACAO_DOC_ID = "numeracao"

# Defaults: chave interna → config
NUMERACAO_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "artigo": {
        "label": "Artigos",
        "grupo": "catalogo",
        "prefix": "ART",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "ART-0001",
    },
    "categoria": {
        "label": "Categorias",
        "grupo": "catalogo",
        "prefix": "CAT",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "CAT-0001",
    },
    "subcategoria": {
        "label": "Subcategorias",
        "grupo": "catalogo",
        "prefix": "SUB",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "SUB-0001",
    },
    "maquina": {
        "label": "Máquinas",
        "grupo": "catalogo",
        "prefix": "MAQ",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "MAQ-0001",
    },
    "material": {
        "label": "Materiais",
        "grupo": "catalogo",
        "prefix": "MAT",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "MAT-0001",
    },
    "mao_obra": {
        "label": "Mão de obra",
        "grupo": "catalogo",
        "prefix": "MOB",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "MOB-0001",
    },
    "tipo_personalizacao": {
        "label": "Tipos de personalização",
        "grupo": "catalogo",
        "prefix": "TIP",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "TIP-0001",
    },
    "cliente": {
        "label": "Clientes",
        "grupo": "negocio",
        "prefix": "CLI",
        "incluir_ano": False,
        "digitos": 4,
        "exemplo": "CLI-0001",
    },
    "orcamento": {
        "label": "Orçamentos",
        "grupo": "documentos",
        "prefix": "ORC",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "ORC-2026-0001",
    },
    "encomenda": {
        "label": "Encomendas",
        "grupo": "documentos",
        "prefix": "ENC",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "ENC-2026-0001",
    },
    "ordem_fabrico": {
        "label": "Ordens de fabrico",
        "grupo": "documentos",
        "prefix": "OF",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "OF-2026-0001",
    },
    "recibo": {
        "label": "Recibos",
        "grupo": "documentos",
        "prefix": "REC",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "REC-2026-0001",
    },
    "fatura": {
        "label": "Faturas",
        "grupo": "documentos",
        "prefix": "FAT",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "FAT-2026-0001",
    },
    "proforma": {
        "label": "Faturas Pro Forma",
        "grupo": "documentos",
        "prefix": "FP",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "FP-2026-0001",
    },
    "fatura_recibo": {
        "label": "Faturas-Recibo",
        "grupo": "documentos",
        "prefix": "FR",
        "incluir_ano": True,
        "digitos": 4,
        "exemplo": "FR-2026-0001",
    },
}

_PREFIX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$")


def sanitize_prefix(raw: str, fallback: str) -> str:
    p = (raw or "").strip().upper().replace(" ", "")
    if not p or not _PREFIX_RE.match(p):
        return fallback
    return p


def exemplo_codigo(prefix: str, incluir_ano: bool, digitos: int) -> str:
    digitos = max(2, min(8, int(digitos or 4)))
    seq = "1".zfill(digitos)
    if incluir_ano:
        year = datetime.now(timezone.utc).year
        return f"{prefix}-{year}-{seq}"
    return f"{prefix}-{seq}"


def merge_config(stored: Optional[dict] = None) -> Dict[str, dict]:
    stored = (stored or {}).get("referencias") or stored or {}
    out = {}
    for key, default in NUMERACAO_DEFAULTS.items():
        custom = stored.get(key) or {}
        prefix = sanitize_prefix(custom.get("prefix", default["prefix"]), default["prefix"])
        incluir_ano = bool(custom["incluir_ano"]) if "incluir_ano" in custom else default["incluir_ano"]
        digitos = int(custom.get("digitos") or default["digitos"])
        digitos = max(2, min(8, digitos))
        out[key] = {
            "label": default["label"],
            "grupo": default["grupo"],
            "prefix": prefix,
            "incluir_ano": incluir_ano,
            "digitos": digitos,
            "exemplo": exemplo_codigo(prefix, incluir_ano, digitos),
        }
    return out


async def get_numeracao() -> dict:
    doc = await empresa_repo.find_one({"id": NUMERACAO_DOC_ID}) or {}
    refs = merge_config(doc)
    return {"id": NUMERACAO_DOC_ID, "referencias": refs}


async def save_numeracao(payload: dict) -> dict:
    incoming = payload.get("referencias") or payload
    current = merge_config(await empresa_repo.find_one({"id": NUMERACAO_DOC_ID}) or {})
    cleaned = {}
    for key, default in NUMERACAO_DEFAULTS.items():
        src = incoming.get(key) or {}
        prefix = sanitize_prefix(src.get("prefix", current[key]["prefix"]), default["prefix"])
        incluir_ano = bool(src["incluir_ano"]) if "incluir_ano" in src else current[key]["incluir_ano"]
        digitos = int(src.get("digitos") or current[key]["digitos"])
        digitos = max(2, min(8, digitos))
        cleaned[key] = {"prefix": prefix, "incluir_ano": incluir_ano, "digitos": digitos}
    doc = {"id": NUMERACAO_DOC_ID, "referencias": cleaned}
    await empresa_repo.update_where({"id": NUMERACAO_DOC_ID}, doc, upsert=True)
    return await get_numeracao()


async def _cfg(chave: str) -> dict:
    if chave not in NUMERACAO_DEFAULTS:
        raise ValueError(f"Chave de numeração desconhecida: {chave}")
    return (await get_numeracao())["referencias"][chave]


async def next_codigo(chave: str) -> str:
    """Gera o próximo código sequencial para a entidade (ex.: artigo → ART-0001)."""
    cfg = await _cfg(chave)
    prefix = cfg["prefix"]
    digitos = cfg["digitos"]
    if cfg["incluir_ano"]:
        year = datetime.now(timezone.utc).year
        counter_id = f"{prefix}-{year}"
        doc = await db.counters.find_one_and_update(
            {"_id": counter_id},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True,
        )
        return f"{prefix}-{year}-{doc['seq']:0{digitos}d}"
    counter_id = f"{prefix}"
    doc = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"{prefix}-{doc['seq']:0{digitos}d}"


# Repos / campos para backfill de catálogo e clientes
_BACKFILL = [
    ("artigo", artigos_repo, "codigo"),
    ("categoria", categorias_repo, "codigo"),
    ("subcategoria", subcategorias_repo, "codigo"),
    ("maquina", maquinas_repo, "codigo"),
    ("material", consumiveis_repo, "codigo"),
    ("mao_obra", mao_obra_repo, "codigo"),
    ("tipo_personalizacao", tipos_repo, "codigo"),
    ("cliente", clientes_repo, "codigo"),
]


async def backfill_codigos() -> dict:
    """Atribui códigos a registos antigos sem `codigo`. Idempotente."""
    stats: Dict[str, int] = {}
    for chave, repo, field in _BACKFILL:
        missing = await repo.find({
            "$or": [{field: {"$exists": False}}, {field: ""}, {field: None}],
        }, sort=("created_at", 1), limit=5000)
        n = 0
        for doc in missing:
            codigo = await next_codigo(chave)
            await repo.update(doc["id"], {field: codigo})
            n += 1
        stats[chave] = n
    return stats
