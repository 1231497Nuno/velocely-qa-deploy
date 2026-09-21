from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import get_current_user, require_perm
from app.core.pagination import parse_page, page_payload, text_search_cliente
from app.domain.models import Cliente, ClienteInput
from app.repositories import clientes_repo, orcamentos_repo, encomendas_repo, ordens_repo
from app.services.costing import compute_orcamento_totais, compute_encomenda, recompute_of_status
from app.services.numeracao import next_codigo
from app.services import audit
from app.services import cliente_default as cliente_default_svc
from app.core.database import round2

_CLIENTE_CAMPOS = [
    "nome", "tipo", "morada", "codigo_postal", "cidade", "pais",
    "contacto", "email", "nif", "notas", "responsavel",
    "condicoes_pagamento", "desconto_comercial_pct", "limite_credito",
]

router = APIRouter()


@router.get("/clientes/default")
async def get_cliente_default(_u: dict = Depends(require_perm("clientes", "view"))):
    """Cliente de sistema (Consumidor Final) usado quando o orçamento não indica cliente."""
    return await cliente_default_svc.get_cliente_default()


@router.get("/clientes/defaults")
async def list_clientes_default(_u: dict = Depends(require_perm("clientes", "view"))):
    """Lista só os clientes default (código + nome), como artigos diversos."""
    return await cliente_default_svc.list_clientes_default()


@router.post("/clientes/ensure-sistema")
async def ensure_cliente_sistema(user: dict = Depends(require_perm("clientes", "edit"))):
    """Garante Consumidor Final (sistema) e devolve-o."""
    return await cliente_default_svc.ensure_consumidor_final()


@router.get("/clientes/{cid}/historico-precos")
async def cliente_historico_precos(cid: str, _u: dict = Depends(require_perm("clientes", "view"))):
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
async def cliente_resumo(cid: str, _u: dict = Depends(require_perm("clientes", "view"))):
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
        "orcamentos_aceites": sum(1 for o in orcs_raw if o.get("status") in ("aceite", "ganho")),
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
async def list_clientes(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    sort: str = Query("nome", description="Campo: nome | codigo"),
    order: str = Query("asc", description="asc | desc"),
    _u: dict = Depends(require_perm("clientes", "view")),
):
    query = {}
    ts = text_search_cliente(q)
    if ts:
        query.update(ts)
    sort_field = sort if sort in ("nome", "codigo") else "nome"
    sort_dir = -1 if (order or "").lower() == "desc" else 1
    sort_spec = (sort_field, sort_dir)
    if page is None:
        return await clientes_repo.find(query, sort=sort_spec, limit=5000)
    import asyncio
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        clientes_repo.count(query),
        clientes_repo.find(query, sort=sort_spec, limit=ps, skip=skip),
    )
    return page_payload(items, total, p, ps)


@router.post("/clientes")
async def create_cliente(data: ClienteInput, user: dict = Depends(require_perm("clientes", "create"))):
    payload = data.model_dump()
    payload["sistema"] = False
    # is_default=True só a partir das Configurações (cliente default extra)
    c = Cliente(**payload)
    c.codigo = await next_codigo("cliente")
    await clientes_repo.insert(c.model_dump())
    await audit.registar("cliente", c.id, "criado", user, f"Cliente «{c.nome}» criado", c.codigo or c.nome)
    return c.model_dump()


@router.put("/clientes/{cid}")
async def update_cliente(cid: str, data: ClienteInput, user: dict = Depends(require_perm("clientes", "edit"))):
    existing = await clientes_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Cliente não encontrado")
    novo = data.model_dump()
    novo["sistema"] = bool(existing.get("sistema"))
    novo["is_default"] = bool(existing.get("is_default") or novo.get("is_default"))
    if existing.get("sistema"):
        novo["nome"] = existing.get("nome") or novo.get("nome")
        novo["is_default"] = True
    alteracoes = audit.diff_campos(existing, novo, _CLIENTE_CAMPOS)
    await clientes_repo.update(cid, novo)
    if alteracoes:
        await audit.registar("cliente", cid, "editado", user,
                             f"Cliente «{novo.get('nome')}» editado", novo.get("nome"), alteracoes)
    return {**existing, **novo}


@router.delete("/clientes/{cid}")
async def delete_cliente(cid: str, user: dict = Depends(require_perm("clientes", "delete"))):
    existing = await clientes_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Cliente não encontrado")
    if existing.get("sistema"):
        raise HTTPException(400, "Não é possível eliminar o cliente de sistema (Consumidor Final)")
    await clientes_repo.delete({"id": cid})
    await audit.registar("cliente", cid, "eliminado", user,
                         f"Cliente «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}
