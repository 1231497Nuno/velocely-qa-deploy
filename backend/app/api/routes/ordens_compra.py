from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.services import listas as listas_svc
from app.services import campos as campos_svc
from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload, text_search
from app.domain.models import OrdemCompra, OrdemCompraInput, TIPO_DESPESA_PT, TIPO_DESPESA_DESC, OC_ESTADO_PT
from app.repositories import ordens_compra_repo, fornecedores_repo
from app.services.numeracao import next_codigo
from app.services.oc_classificacao import classificar_tipo_despesa
from app.services import audit
from app.core.database import now_iso

_OC_CAMPOS = [
    "assunto", "fornecedor_id", "fornecedor_nome", "tipo_compra", "tipo_despesa", "estado",
    "data", "vencimento", "data_pagamento", "subtotal", "total", "valor_pago",
    "desconto_percentual", "valor_desconto", "valor_taxa", "moeda", "responsavel",
    "tipologia", "transportadora", "centro_custo", "notas",
]

router = APIRouter()

def _exigir_artigos_nas_linhas(linhas: list, existentes: list) -> None:
    """Linhas novas têm de ser artigos do catálogo (linhas livres antigas mantêm-se)."""
    antigas = {l.get("id") for l in existentes or [] if not l.get("artigo_id")}
    for l in linhas or []:
        if not (l.get("artigo_id") or "").strip() and l.get("id") not in antigas:
            raise HTTPException(400, "Cada linha tem de ter um artigo do catálogo. Escolha o artigo ou use um artigo «Diversos».")



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
        "tipos_compra": (await listas_svc.todas()).get("tipos_compra") or ["Consumiveis", "Produtos", "Outros", "Manutenção", "Portes"],
    }





@router.get("/ordens-compra/{oid}")
async def get_ordem_compra(oid: str, _u: dict = Depends(require_perm("ordens_compra", "view"))):
    oc = await ordens_compra_repo.get(oid)
    if not oc:
        raise HTTPException(404, "Ordem de compra não encontrada")
    return oc


@router.post("/ordens-compra/importar-pdf")
async def importar_pdf_oc(file: UploadFile = File(...), _u: dict = Depends(require_perm("ordens_compra", "create"))):
    """Lê o PDF do fornecedor e propõe a ordem de compra (fornecedor, artigos associados, avisos)."""
    from app.services import oc_pdf
    dados = await file.read()
    if len(dados) > 15 * 1024 * 1024:
        raise HTTPException(400, "PDF demasiado grande (máx. 15 MB)")
    return await oc_pdf.analisar(file.filename or "", dados)


@router.post("/ordens-compra/importar-pdf/criar")
async def criar_oc_de_pdf(dados: dict, user: dict = Depends(require_perm("ordens_compra", "create"))):
    """Cria a OC com as linhas revistas e aprende as associações referência → artigo."""
    from app.services import oc_pdf
    from app.domain.models import OrdemCompraLinha
    linhas = [l for l in dados.get("linhas") or [] if l.get("incluir", True)]
    if not linhas:
        raise HTTPException(400, "Não há linhas para criar a ordem de compra")
    falta = [l.get("descricao") or l.get("ref") or "?" for l in linhas if not l.get("artigo_id")]
    if falta:
        raise HTTPException(400, "Associe um artigo a todas as linhas incluídas: " + ", ".join(falta[:5]))
    if not dados.get("fornecedor_id"):
        raise HTTPException(400, "Escolha o fornecedor")
    oc_linhas = [OrdemCompraLinha(artigo_id=l["artigo_id"], artigo_nome=l.get("artigo_nome") or "", nome=l.get("artigo_nome") or l.get("descricao") or "",
                                  quantidade=float(l.get("quantidade") or 0), preco_unit=float(l.get("preco_unit") or 0),
                                  desconto=float(l.get("desconto") or 0), comentario=(f"Ref. fornecedor {l['ref']}" if l.get("ref") else ""))
                 for l in linhas]
    subtotal = round(sum(x.quantidade * x.preco_unit * (1 - x.desconto / 100) for x in oc_linhas), 2)
    num = (dados.get("numero_documento") or "").strip()
    data = OrdemCompraInput(fornecedor_id=dados["fornecedor_id"], tipo_compra="Produtos", tipo_despesa="compra", estado="criada",
                            assunto=(f"Doc. fornecedor {num}" if num else "Importada de PDF do fornecedor"),
                            data=now_iso()[:10], linhas=oc_linhas, subtotal=subtotal, total=subtotal)
    oc = await create_ordem_compra(data, user)
    if dados.get("aprender", True):
        await oc_pdf.aprender(dados["fornecedor_id"], linhas)
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
    _exigir_artigos_nas_linhas([l.model_dump() for l in (data.linhas or [])], [])
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
    novo = await campos_svc.aplicar("ordens_compra", data.model_dump(), "guardar", existing)
    if novo.get("estado") == "recebida" and existing.get("estado") != "recebida":
        from app.services import workflow
        await workflow.exigir_aprovacao_oc({**existing, **novo, "id": oid}, user, "dar a ordem de compra como recebida")
    _exigir_artigos_nas_linhas(novo.get("linhas") or [], existing.get("linhas") or [])
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


# ---------------------------------------------------------------------------
# Receções (parciais) e fatura do fornecedor
# ---------------------------------------------------------------------------
@router.post("/ordens-compra/rececoes-lote")
async def receber_varias_oc(dados: dict, user: dict = Depends(require_perm("ordens_compra", "edit"))):
    """Receção conjunta de várias OC do mesmo fornecedor (ex.: uma entrega com várias encomendas)."""
    from app.services import stock as stock_svc
    return await stock_svc.receber_lote(dados, user)


@router.post("/ordens-compra/{oid}/rececoes")
async def receber_ordem_compra(oid: str, dados: dict, user: dict = Depends(require_perm("ordens_compra", "edit"))):
    from app.services import stock as stock_svc
    return await stock_svc.receber(oid, dados, user)


@router.post("/ordens-compra/{oid}/fatura-fornecedor")
async def fatura_fornecedor_oc(oid: str, dados: dict, user: dict = Depends(require_perm("ordens_compra", "edit"))):
    from app.services import stock as stock_svc
    return await stock_svc.fatura_fornecedor(oid, dados, user)
