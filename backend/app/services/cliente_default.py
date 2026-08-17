"""Clientes default (Consumidor Final de sistema + extras)."""
from __future__ import annotations

from app.domain.models import Cliente
from app.repositories import clientes_repo
from app.services.numeracao import next_codigo

CONSUMIDOR_FINAL_NOME = "Consumidor Final"


async def ensure_consumidor_final() -> dict:
    """Garante o cliente de sistema «Consumidor Final» (não eliminável)."""
    existing = await clientes_repo.find_one({"sistema": True})
    if not existing:
        existing = await clientes_repo.find_one({"nome": CONSUMIDOR_FINAL_NOME})
    if existing:
        patch = {}
        if not existing.get("sistema"):
            patch["sistema"] = True
        if not existing.get("is_default"):
            patch["is_default"] = True
        if existing.get("tipo") not in ("particular", "empresa"):
            patch["tipo"] = "particular"
        if patch:
            await clientes_repo.update(existing["id"], patch)
            existing.update(patch)
        return existing

    c = Cliente(
        nome=CONSUMIDOR_FINAL_NOME,
        tipo="particular",
        sistema=True,
        is_default=True,
        notas="Cliente de sistema — usado por defeito quando não é indicado outro.",
    )
    c.codigo = await next_codigo("cliente")
    doc = c.model_dump()
    await clientes_repo.insert(doc)
    return doc


async def get_cliente_default() -> dict:
    """Cliente usado automaticamente em orçamentos sem cliente = o de sistema."""
    d = await clientes_repo.find_one({"sistema": True})
    if d:
        return d
    return await ensure_consumidor_final()


async def list_clientes_default() -> list:
    await ensure_consumidor_final()
    return await clientes_repo.find({"is_default": True}, sort=("nome", 1), limit=500)


async def apply_cliente_default(orc: dict) -> dict:
    """Se o orçamento não tem cliente, preenche com o Consumidor Final."""
    if orc.get("cliente_id") or (orc.get("cliente") or "").strip():
        nome = (orc.get("cliente") or "").strip()
        if orc.get("cliente_id") or (nome and nome.lower() not in ("novo cliente", "novo", "-")):
            return orc
    d = await get_cliente_default()
    orc["cliente_id"] = d["id"]
    orc["cliente"] = d.get("nome") or CONSUMIDOR_FINAL_NOME
    return orc
