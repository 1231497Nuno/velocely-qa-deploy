from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import now_iso, round2
from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload, text_search
from app.domain.models import (
    PedidoCotacao, PedidoCotacaoInput, PC_ESTADO_PT,
    OrdemCompra, OrdemCompraLinha,
)
from app.repositories import pedidos_cotacao_repo, fornecedores_repo, ordens_compra_repo
from app.services.numeracao import next_codigo
from app.services import audit

_PC_CAMPOS = [
    "assunto", "fornecedor_id", "fornecedor_nome", "estado", "data", "prazo_resposta",
    "valor_cotado", "moeda", "responsavel", "notas", "ordem_compra_id", "ordem_compra_codigo",
]

_PC_ESTADOS = set(PC_ESTADO_PT.keys())

router = APIRouter()


async def _resolve_fornecedor(data: PedidoCotacaoInput) -> PedidoCotacaoInput:
    if data.fornecedor_id:
        f = await fornecedores_repo.get(data.fornecedor_id)
        if f:
            data.fornecedor_nome = f.get("nome") or data.fornecedor_nome
    return data


def _recalc_valor_cotado(linhas) -> Optional[float]:
    total = 0.0
    tem = False
    for l in linhas or []:
        preco = l.get("preco_unit_cotado") if isinstance(l, dict) else l.preco_unit_cotado
        qtd = l.get("quantidade") if isinstance(l, dict) else l.quantidade
        if preco is not None and preco != "":
            tem = True
            total += (float(qtd) or 0) * float(preco)
    return round2(total) if tem else None


@router.get("/pedidos-cotacao")
async def list_pedidos_cotacao(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    estado: str = Query(""),
    fornecedor_id: str = Query(""),
    sort: str = Query("data", description="Campo: data | codigo | prazo_resposta | fornecedor_nome | created_at"),
    order: str = Query("desc", description="asc | desc"),
    _u: dict = Depends(require_perm("pedidos_cotacao", "view")),
):
    query: dict = {}
    ts = text_search(
        ["codigo", "assunto", "fornecedor_nome", "responsavel", "notas"],
        q,
    )
    if ts:
        query.update(ts)
    if estado in _PC_ESTADOS:
        query["estado"] = estado
    if fornecedor_id:
        query["fornecedor_id"] = fornecedor_id

    sort_field = sort if sort in ("data", "codigo", "prazo_resposta", "fornecedor_nome", "created_at", "valor_cotado") else "data"
    sort_dir = 1 if (order or "").lower() == "asc" else -1
    sort_spec = (sort_field, sort_dir)

    if page is None:
        return await pedidos_cotacao_repo.find(query, sort=sort_spec, limit=5000)

    import asyncio
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        pedidos_cotacao_repo.count(query),
        pedidos_cotacao_repo.find(query, sort=sort_spec, limit=ps, skip=skip),
    )
    return page_payload(items, total, p, ps)


@router.get("/pedidos-cotacao/meta")
async def pedidos_cotacao_meta(_u: dict = Depends(require_perm("pedidos_cotacao", "view"))):
    return {
        "estados": [{"key": k, "label": v} for k, v in PC_ESTADO_PT.items()],
    }


@router.get("/pedidos-cotacao/{pid}")
async def get_pedido_cotacao(pid: str, _u: dict = Depends(require_perm("pedidos_cotacao", "view"))):
    pc = await pedidos_cotacao_repo.get(pid)
    if not pc:
        raise HTTPException(404, "Pedido de cotação não encontrado")
    return pc


@router.post("/pedidos-cotacao")
async def create_pedido_cotacao(
    data: PedidoCotacaoInput,
    user: dict = Depends(require_perm("pedidos_cotacao", "create")),
):
    data = await _resolve_fornecedor(data)
    if not data.data:
        data.data = now_iso()[:10]
    pc = PedidoCotacao(**data.model_dump())
    pc.codigo = await next_codigo("pedido_cotacao")
    valor = _recalc_valor_cotado(pc.linhas)
    if valor is not None:
        pc.valor_cotado = valor
    await pedidos_cotacao_repo.insert(pc.model_dump())
    await audit.registar(
        "pedido_cotacao", pc.id, "criado", user,
        f"Pedido de cotação «{pc.codigo}» criado", pc.codigo or pc.assunto,
    )
    return pc.model_dump()


@router.put("/pedidos-cotacao/{pid}")
async def update_pedido_cotacao(
    pid: str,
    data: PedidoCotacaoInput,
    user: dict = Depends(require_perm("pedidos_cotacao", "edit")),
):
    existing = await pedidos_cotacao_repo.get(pid)
    if not existing:
        raise HTTPException(404, "Pedido de cotação não encontrado")
    if existing.get("estado") == "adjudicado":
        raise HTTPException(400, "Pedido adjudicado não pode ser editado")

    data = await _resolve_fornecedor(data)
    # preservar ligação OC se já existir
    if existing.get("ordem_compra_id"):
        data.ordem_compra_id = existing.get("ordem_compra_id")
        data.ordem_compra_codigo = existing.get("ordem_compra_codigo") or ""

    novo = data.model_dump()
    valor = _recalc_valor_cotado(novo.get("linhas") or [])
    if valor is not None:
        novo["valor_cotado"] = valor
    elif novo.get("valor_cotado") is None:
        novo["valor_cotado"] = existing.get("valor_cotado")

    alteracoes = audit.diff_campos(existing, novo, _PC_CAMPOS)
    if existing.get("estado") != novo.get("estado"):
        await audit.registar(
            "pedido_cotacao", pid, "estado_alterado", user,
            f"Pedido «{existing.get('codigo')}»: {existing.get('estado')} → {novo.get('estado')}",
            existing.get("codigo"),
        )
    await pedidos_cotacao_repo.update(pid, novo)
    if alteracoes:
        await audit.registar(
            "pedido_cotacao", pid, "editado", user,
            f"Pedido de cotação «{existing.get('codigo')}» editado",
            existing.get("codigo"), alteracoes,
        )
    return {**existing, **novo}


@router.delete("/pedidos-cotacao/{pid}")
async def delete_pedido_cotacao(pid: str, user: dict = Depends(require_perm("pedidos_cotacao", "delete"))):
    existing = await pedidos_cotacao_repo.get(pid)
    if not existing:
        raise HTTPException(404, "Pedido de cotação não encontrado")
    if existing.get("estado") == "adjudicado":
        raise HTTPException(400, "Não é possível eliminar um pedido adjudicado")
    await pedidos_cotacao_repo.delete({"id": pid})
    await audit.registar(
        "pedido_cotacao", pid, "eliminado", user,
        f"Pedido de cotação «{existing.get('codigo')}» eliminado", existing.get("codigo"),
    )
    return {"ok": True}


@router.post("/pedidos-cotacao/{pid}/adjudicar")
async def adjudicar_pedido_cotacao(
    pid: str,
    user: dict = Depends(require_perm("pedidos_cotacao", "edit")),
):
    """Cria Ordem de Compra a partir das linhas cotadas e marca o pedido como adjudicado."""
    pc = await pedidos_cotacao_repo.get(pid)
    if not pc:
        raise HTTPException(404, "Pedido de cotação não encontrado")
    if pc.get("estado") == "adjudicado" and pc.get("ordem_compra_id"):
        raise HTTPException(400, "Pedido já adjudicado")
    if pc.get("estado") == "cancelado":
        raise HTTPException(400, "Pedido cancelado não pode ser adjudicado")
    if pc.get("estado") != "respondido":
        raise HTTPException(400, "Só podes adjudicar um pedido no estado Respondido")

    linhas = pc.get("linhas") or []
    if not linhas:
        raise HTTPException(400, "O pedido não tem linhas para adjudicar")

    sem_preco = [
        (l.get("nome") or "item")
        for l in linhas
        if l.get("preco_unit_cotado") is None or l.get("preco_unit_cotado") == ""
    ]
    if sem_preco:
        raise HTTPException(
            400,
            "Regista o preço cotado em todas as linhas antes de adjudicar "
            f"({', '.join(sem_preco[:3])}{'…' if len(sem_preco) > 3 else ''})",
        )

    oc_linhas = [
        OrdemCompraLinha(
            nome=l.get("nome") or l.get("artigo_nome") or "Item",
            quantidade=float(l.get("quantidade") or 0) or 1,
            preco_unit=float(l.get("preco_unit_cotado") or 0),
            desconto=0,
            comentario=l.get("notas") or "",
            artigo_id=l.get("artigo_id"),
            artigo_nome=l.get("artigo_nome") or "",
        )
        for l in linhas
    ]
    subtotal = round2(sum(
        (l.quantidade * l.preco_unit) - (l.desconto or 0) for l in oc_linhas
    ))
    valor_cotado = _recalc_valor_cotado(linhas) or subtotal

    oc = OrdemCompra(
        assunto=pc.get("assunto") or f"Cotação {pc.get('codigo')}",
        fornecedor_id=pc.get("fornecedor_id"),
        fornecedor_nome=pc.get("fornecedor_nome") or "",
        tipo_despesa="compra",
        estado="criada",
        data=now_iso()[:10],
        subtotal=subtotal,
        total=subtotal,
        moeda=pc.get("moeda") or "EUR",
        responsavel=pc.get("responsavel") or "",
        notas=f"Adjudicado a partir de {pc.get('codigo')}"
              + (f"\n{pc.get('notas')}" if pc.get("notas") else ""),
        linhas=oc_linhas,
    )
    oc.codigo = await next_codigo("ordem_compra")
    await ordens_compra_repo.insert(oc.model_dump())
    await audit.registar(
        "ordem_compra", oc.id, "criado", user,
        f"Ordem de compra «{oc.codigo}» criada a partir de {pc.get('codigo')}",
        oc.codigo,
    )

    patch = {
        "estado": "adjudicado",
        "valor_cotado": valor_cotado,
        "ordem_compra_id": oc.id,
        "ordem_compra_codigo": oc.codigo,
    }
    await pedidos_cotacao_repo.update(pid, patch)
    await audit.registar(
        "pedido_cotacao", pid, "convertido", user,
        f"Pedido «{pc.get('codigo')}» adjudicado → OC {oc.codigo}",
        pc.get("codigo"),
    )
    return {**pc, **patch, "ordem_compra": oc.model_dump()}
