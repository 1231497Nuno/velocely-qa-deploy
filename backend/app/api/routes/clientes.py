from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user
from app.domain.models import Cliente, ClienteInput
from app.repositories import clientes_repo, orcamentos_repo, encomendas_repo, ordens_repo
from app.services.costing import compute_orcamento_totais, compute_encomenda, recompute_of_status
from app.services import audit
from app.core.database import round2

_CLIENTE_CAMPOS = ["nome", "morada", "codigo_postal", "cidade", "pais", "contacto", "email", "nif", "notas"]

router = APIRouter()


@router.get("/clientes/{cid}/historico-precos")
async def cliente_historico_precos(cid: str, _u: dict = Depends(get_current_user)):
    """Preços praticados por artigo em encomendas anteriores deste cliente."""
    encs = await encomendas_repo.find({"cliente_id": cid}, sort=("data", -1), limit=500)
    agg: dict = {}
    for e in encs:
        for a in e.get("artigos", []):
            aid = a.get("artigo_id")
            if not aid:
                continue
            entry = agg.setdefault(aid, {"artigo_id": aid, "artigo_nome": a.get("artigo_nome", ""), "precos": []})
            entry["precos"].append({
                "preco": round2(a.get("preco_unit") or 0),
                "data": e.get("data"),
                "doc_numero": e.get("numero"),
                "quantidade": a.get("quantidade") or 1,
            })
    out = []
    for v in agg.values():
        precos = v["precos"]
        v["ultimo_preco"] = precos[0]["preco"] if precos else 0
        v["ultima_data"] = precos[0]["data"] if precos else None
        v["ocorrencias"] = len(precos)
        out.append(v)
    out.sort(key=lambda x: (x.get("artigo_nome") or "").lower())
    return out


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
async def create_cliente(data: ClienteInput, user: dict = Depends(get_current_user)):
    c = Cliente(**data.model_dump())
    await clientes_repo.insert(c.model_dump())
    await audit.registar("cliente", c.id, "criado", user, f"Cliente «{c.nome}» criado", c.nome)
    return c.model_dump()


@router.put("/clientes/{cid}")
async def update_cliente(cid: str, data: ClienteInput, user: dict = Depends(get_current_user)):
    existing = await clientes_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Cliente não encontrado")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, _CLIENTE_CAMPOS)
    await clientes_repo.update(cid, novo)
    if alteracoes:
        await audit.registar("cliente", cid, "editado", user,
                             f"Cliente «{novo.get('nome')}» editado", novo.get("nome"), alteracoes)
    return {**existing, **novo}


@router.delete("/clientes/{cid}")
async def delete_cliente(cid: str, user: dict = Depends(get_current_user)):
    existing = await clientes_repo.get(cid)
    await clientes_repo.delete({"id": cid})
    if existing:
        await audit.registar("cliente", cid, "eliminado", user,
                             f"Cliente «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}
