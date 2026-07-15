from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user
from app.domain.models import Cliente, ClienteInput
from app.repositories import clientes_repo, orcamentos_repo, encomendas_repo, ordens_repo
from app.services.costing import compute_orcamento_totais, compute_encomenda, recompute_of_status
from app.core.database import round2

router = APIRouter()


@router.get("/clientes/{cid}/resumo")
async def cliente_resumo(cid: str, _u: dict = Depends(get_current_user)):
    c = await clientes_repo.get(cid)
    if not c:
        raise HTTPException(404, "Cliente não encontrado")
    nome = c.get("nome")

    def _match(rec):
        return rec.get("cliente_id") == cid or (not rec.get("cliente_id") and rec.get("cliente") == nome)

    orcs_raw = [compute_orcamento_totais(o) for o in await orcamentos_repo.find(limit=5000) if _match(o)]
    encs_raw = [await compute_encomenda(e) for e in await encomendas_repo.find(limit=5000) if _match(e)]
    ofs_raw = [recompute_of_status(o) for o in await ordens_repo.find(limit=5000) if _match(o)]

    orcamentos = sorted([
        {"id": o["id"], "numero": o.get("numero"), "status": o.get("status"),
         "total": o.get("total"), "data": o.get("data"), "of_numero": o.get("of_numero")}
        for o in orcs_raw
    ], key=lambda x: x.get("data") or "", reverse=True)

    encomendas = sorted([
        {"id": e["id"], "numero": e.get("numero"), "estado": e.get("estado"),
         "valor_total": e.get("valor_total"), "valor_pago": e.get("valor_pago"),
         "valor_pendente": e.get("valor_pendente"), "status_pagamento": e.get("status_pagamento"),
         "prazo_entrega": e.get("prazo_entrega"), "data": e.get("data"),
         "custo_real": e.get("custo_producao_real")}
        for e in encs_raw
    ], key=lambda x: x.get("data") or "", reverse=True)

    ordens_fabrico = sorted([
        {"id": o["id"], "numero": o.get("numero"), "status": o.get("status"),
         "progresso": o.get("progresso"), "prioritaria": bool(o.get("prioritaria")), "data": o.get("data")}
        for o in ofs_raw
    ], key=lambda x: x.get("data") or "", reverse=True)

    valor_faturado = round2(sum(e.get("valor_total") or 0 for e in encs_raw))
    custo_real = round2(sum(e.get("custo_producao_real") or 0 for e in encs_raw))
    stats = {
        "num_orcamentos": len(orcamentos),
        "orcamentos_aceites": sum(1 for o in orcs_raw if o.get("status") == "aceite"),
        "valor_orcamentos": round2(sum(o.get("total") or 0 for o in orcs_raw)),
        "num_encomendas": len(encomendas),
        "valor_faturado": valor_faturado,
        "valor_pago": round2(sum(e.get("valor_pago") or 0 for e in encs_raw)),
        "valor_pendente": round2(sum(e.get("valor_pendente") or 0 for e in encs_raw)),
        "custo_real": custo_real,
        "margem": round2(valor_faturado - custo_real),
        "num_ofs": len(ordens_fabrico),
    }
    return {"cliente": c, "orcamentos": orcamentos, "encomendas": encomendas,
            "ordens_fabrico": ordens_fabrico, "stats": stats}


@router.get("/clientes")
async def list_clientes(_u: dict = Depends(get_current_user)):
    return await clientes_repo.find(sort=("nome", 1), limit=5000)


@router.post("/clientes")
async def create_cliente(data: ClienteInput, _u: dict = Depends(get_current_user)):
    c = Cliente(**data.model_dump())
    await clientes_repo.insert(c.model_dump())
    return c.model_dump()


@router.put("/clientes/{cid}")
async def update_cliente(cid: str, data: ClienteInput, _u: dict = Depends(get_current_user)):
    existing = await clientes_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Cliente não encontrado")
    await clientes_repo.update(cid, data.model_dump())
    return {**existing, **data.model_dump()}


@router.delete("/clientes/{cid}")
async def delete_cliente(cid: str, _u: dict = Depends(get_current_user)):
    await clientes_repo.delete({"id": cid})
    return {"ok": True}
