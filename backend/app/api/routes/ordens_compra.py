from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload, text_search
from app.domain.models import OrdemCompra, OrdemCompraInput, TIPO_DESPESA_PT, TIPO_DESPESA_DESC, OC_ESTADO_PT
from app.repositories import ordens_compra_repo, fornecedores_repo
from app.services.numeracao import next_codigo
from app.services.oc_classificacao import classificar_tipo_despesa
from app.services import audit

_OC_CAMPOS = [
    "assunto", "fornecedor_id", "fornecedor_nome", "tipo_compra", "tipo_despesa", "estado",
    "data", "vencimento", "data_pagamento", "subtotal", "total", "valor_pago",
    "desconto_percentual", "valor_desconto", "valor_taxa", "moeda", "responsavel",
    "tipologia", "transportadora", "notas",
]

router = APIRouter()


async def _resolve_fornecedor(data: OrdemCompraInput) -> OrdemCompraInput:
    if data.fornecedor_id:
        f = await fornecedores_repo.get(data.fornecedor_id)
        if f:
            data.fornecedor_nome = f.get("nome") or data.fornecedor_nome
    return data


@router.get("/ordens-compra")
async def list_ordens_compra(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    tipo_despesa: str = Query(""),
    tipo_compra: str = Query(""),
    estado: str = Query(""),
    fornecedor_id: str = Query(""),
    sort: str = Query("data", description="Campo: data | codigo | total | fornecedor_nome"),
    order: str = Query("desc", description="asc | desc"),
    _u: dict = Depends(require_perm("ordens_compra", "view")),
):
    query: dict = {}
    ts = text_search(
        ["codigo", "codigo_origem", "assunto", "fornecedor_nome", "tipo_compra", "responsavel"],
        q,
    )
    if ts:
        query.update(ts)
    if tipo_despesa in ("compra", "despesa_normal", "despesa_diversa"):
        query["tipo_despesa"] = tipo_despesa
    if tipo_compra:
        query["tipo_compra"] = tipo_compra
    if estado in ("criada", "recebida", "cancelada"):
        query["estado"] = estado
    if fornecedor_id:
        query["fornecedor_id"] = fornecedor_id

    sort_field = sort if sort in ("data", "codigo", "total", "fornecedor_nome", "created_at") else "data"
    sort_dir = 1 if (order or "").lower() == "asc" else -1
    sort_spec = (sort_field, sort_dir)

    if page is None:
        items = await ordens_compra_repo.find(query, sort=sort_spec, limit=5000)
        return items

    import asyncio
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        ordens_compra_repo.count(query),
        ordens_compra_repo.find(query, sort=sort_spec, limit=ps, skip=skip),
    )
    return page_payload(items, total, p, ps)


@router.get("/ordens-compra/meta")
async def ordens_compra_meta(_u: dict = Depends(require_perm("ordens_compra", "view"))):
    return {
        "tipos_despesa": [
            {"key": k, "label": v, "descricao": TIPO_DESPESA_DESC.get(k, "")}
            for k, v in TIPO_DESPESA_PT.items()
        ],
        "estados": [{"key": k, "label": v} for k, v in OC_ESTADO_PT.items()],
        "tipos_compra": ["Consumiveis", "Produtos", "Outros", "Manutenção", "Portes"],
    }





@router.get("/ordens-compra/{oid}")
async def get_ordem_compra(oid: str, _u: dict = Depends(require_perm("ordens_compra", "view"))):
    oc = await ordens_compra_repo.get(oid)
    if not oc:
        raise HTTPException(404, "Ordem de compra não encontrada")
    return oc


@router.post("/ordens-compra")
async def create_ordem_compra(data: OrdemCompraInput, user: dict = Depends(require_perm("ordens_compra", "create"))):
    data = await _resolve_fornecedor(data)
    sugerido = classificar_tipo_despesa(
        tipo_compra=data.tipo_compra,
        assunto=data.assunto,
        fornecedor_nome=data.fornecedor_nome,
        itens=[l.nome for l in (data.linhas or [])],
        tipologia=data.tipologia,
    )
    if data.tipo_despesa == "despesa_diversa" and sugerido != "despesa_diversa":
        data.tipo_despesa = sugerido
    oc = OrdemCompra(**data.model_dump())
    oc.codigo = await next_codigo("ordem_compra")
    await ordens_compra_repo.insert(oc.model_dump())
    await audit.registar(
        "ordem_compra", oc.id, "criado", user,
        f"Ordem de compra «{oc.codigo}» criada", oc.codigo or oc.assunto,
    )
    return oc.model_dump()


@router.put("/ordens-compra/{oid}")
async def update_ordem_compra(
    oid: str, data: OrdemCompraInput, user: dict = Depends(require_perm("ordens_compra", "edit")),
):
    existing = await ordens_compra_repo.get(oid)
    if not existing:
        raise HTTPException(404, "Ordem de compra não encontrada")
    data = await _resolve_fornecedor(data)
    novo = data.model_dump()
    novo.pop("anexos", None)
    alteracoes = audit.diff_campos(existing, novo, _OC_CAMPOS)
    await ordens_compra_repo.update(oid, novo)
    if alteracoes:
        await audit.registar(
            "ordem_compra", oid, "editado", user,
            f"Ordem de compra «{existing.get('codigo')}» editada",
            existing.get("codigo"), alteracoes,
        )
    return {**existing, **novo}


@router.delete("/ordens-compra/{oid}")
async def delete_ordem_compra(oid: str, user: dict = Depends(require_perm("ordens_compra", "delete"))):
    existing = await ordens_compra_repo.get(oid)
    if not existing:
        raise HTTPException(404, "Ordem de compra não encontrada")
    await ordens_compra_repo.delete({"id": oid})
    await audit.registar(
        "ordem_compra", oid, "eliminado", user,
        f"Ordem de compra «{existing.get('codigo')}» eliminada", existing.get("codigo"),
    )
    return {"ok": True}
