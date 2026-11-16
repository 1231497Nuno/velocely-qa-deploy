"""Rotas do módulo opcional de faturas e recibos (fatura, proforma, fatura-recibo)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from io import BytesIO

from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload, text_search
from app.domain.models import DOC_TIPOS_PRINCIPAIS, DOC_TIPO_PT
from app.repositories import documentos_financeiros_repo, encomendas_repo
from app.services.financeiro import (
    emitir_from_encomenda, emitir_recibo_from_fatura, enrich_documento, enrich_documentos_many,
    resumo_faturacao_encomenda, LinhaParcialInput, reverter_efeitos_documento,
    editar_rascunho, assinar_documento, desligar_pagamento_do_documento,
)
from app.services.pdf import load_pdf_config, fetch_cliente, build_documento_financeiro_pdf
from app.services import audit
from app.services import faturacao as fat

router = APIRouter()


class EmitirLinhaBody(BaseModel):
    encomenda_artigo_id: str
    quantidade: float


class EmitirDocBody(BaseModel):
    tipo: str
    metodo_pagamento: str = "transferencia"
    notas: str = ""
    valor: Optional[float] = None
    linhas: Optional[List[EmitirLinhaBody]] = None
    # Fatura / fatura-recibo antes da encomenda concluída (produção pronta)
    adiantamento: bool = False


class EmitirReciboBody(BaseModel):
    valor: Optional[float] = None
    metodo_pagamento: str = "transferencia"
    notas: str = ""


@router.get("/financeiro/documentos")
async def list_documentos(
    tipo: Optional[str] = Query(None),
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("financeiro", "view")),
):
    query = {"tipo": {"$ne": "recibo"}}  # recibos vivem dentro da fatura
    if tipo:
        if tipo not in DOC_TIPOS_PRINCIPAIS:
            raise HTTPException(400, f"Tipo inválido. Use: {', '.join(DOC_TIPOS_PRINCIPAIS)}")
        query = {"tipo": tipo}
    ts = text_search(["numero", "cliente", "encomenda_numero"], q)
    if ts:
        query = {"$and": [query, ts]}
    if page is None:
        docs = await documentos_financeiros_repo.find(query, sort=("created_at", -1), limit=2000)
        return await enrich_documentos_many(docs)
    p, ps, skip = parse_page(page, page_size)
    import asyncio
    total, docs = await asyncio.gather(
        documentos_financeiros_repo.count(query),
        documentos_financeiros_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip),
    )
    return page_payload(await enrich_documentos_many(docs), total, p, ps)


@router.get("/financeiro/documentos/{did}")
async def get_documento(did: str, _u: dict = Depends(require_perm("financeiro", "view"))):
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    return await enrich_documento(doc)


@router.post("/financeiro/documentos/{did}/recibos")
async def emitir_recibo_fatura(
    did: str,
    body: EmitirReciboBody,
    user: dict = Depends(require_perm("financeiro", "create")),
):
    """Emite um recibo associado a uma fatura (pode haver vários)."""
    return await emitir_recibo_from_fatura(
        did,
        user,
        valor=body.valor,
        metodo_pagamento=body.metodo_pagamento or "transferencia",
        notas=body.notas or "",
    )


@router.get("/financeiro/documentos/{did}/pdf")
async def documento_pdf(
    did: str,
    _u: dict = Depends(require_perm("financeiro", "view")),
):
    """PDF do documento — exige Bearer + permissão financeiro.view (sem JWT na query)."""
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    if fat.certificado(doc):
        # PDF oficial do programa de faturação certificado
        pdf_cert = await fat.pdf_bytes(doc)
        filename = f"{(doc.get('numero') or 'documento').replace('/', '-').replace(' ', '_')}.pdf"
        return StreamingResponse(BytesIO(pdf_cert), media_type="application/pdf",
                                 headers={"Content-Disposition": f'inline; filename="{filename}"'})
    if doc.get("estado") == "rascunho":
        doc = {**doc, "numero": "RASCUNHO", "notas": ("Documento sem valor fiscal (rascunho). " + (doc.get("notas") or "")).strip()}
    settings, _, show_branding = await load_pdf_config(None)
    cliente = await fetch_cliente(doc.get("cliente_id"))
    pdf = build_documento_financeiro_pdf(doc, settings=settings, cliente=cliente, show_branding=show_branding)
    filename = f"{doc.get('numero') or 'documento'}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


class LinhaRascunhoBody(BaseModel):
    descricao: str = ""
    quantidade: float = 1
    preco_unit: float = 0
    indice: Optional[int] = None  # posição da linha original (mantém a ligação ao artigo)


class EditarRascunhoBody(BaseModel):
    data: Optional[str] = None
    notas: Optional[str] = None
    referencia_cliente: Optional[str] = None
    metodo_pagamento: Optional[str] = None
    linhas: Optional[List[LinhaRascunhoBody]] = None


@router.put("/financeiro/documentos/{did}")
async def editar_documento_rascunho(
    did: str, body: EditarRascunhoBody, user: dict = Depends(require_perm("financeiro", "edit")),
):
    """Só documentos em rascunho. Depois de assinado, o documento fica fixo."""
    dados = body.model_dump(exclude_unset=True)
    if body.linhas is not None:
        dados["linhas"] = [
            {"descricao": l.descricao, "quantidade": l.quantidade, "preco_unit": l.preco_unit, "_indice": l.indice}
            for l in body.linhas
        ]
    return await editar_rascunho(did, dados, user)


@router.post("/financeiro/documentos/{did}/assinar")
async def assinar_documento_route(did: str, user: dict = Depends(require_perm("financeiro", "create"))):
    return await assinar_documento(did, user)


class AnularBody(BaseModel):
    motivo: str = ""
    # Programas que não anulam por API (TOConline, Moloni): o utilizador confirma que já anulou lá
    ja_anulado_no_programa: bool = False


@router.post("/financeiro/documentos/{did}/anular")
async def anular_documento(
    did: str, body: Optional[AnularBody] = None, user: dict = Depends(require_perm("financeiro", "edit")),
):
    body = body or AnularBody()
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    if doc.get("estado") == "anulada":
        return await enrich_documento(doc)
    if doc.get("estado") == "rascunho":
        raise HTTPException(400, "Um rascunho não se anula — elimine-o")
    bloco = await fat.anular(doc, body.motivo or "Anulado no ERP", body.ja_anulado_no_programa)
    efeitos = await reverter_efeitos_documento(doc)
    await documentos_financeiros_repo.update(did, {"estado": "anulada", **({"faturacao": bloco} if bloco else {})})
    await desligar_pagamento_do_documento(doc)
    doc["estado"] = "anulada"
    if bloco:
        doc["faturacao"] = bloco
    label = DOC_TIPO_PT.get(doc.get("tipo"), doc.get("tipo"))
    extra = ""
    if efeitos.get("pagamentos_revertidos"):
        extra = f" · {efeitos['pagamentos_revertidos']} pagamento(s) revertido(s) na encomenda"
    await audit.registar(
        "documento_financeiro", did, "estado_alterado", user,
        f"{label} {doc.get('numero')} anulado{extra}",
        doc.get("numero"),
    )
    return await enrich_documento(doc)


@router.delete("/financeiro/documentos/{did}")
async def delete_documento(did: str, user: dict = Depends(require_perm("financeiro", "delete"))):
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    f = doc.get("faturacao") or {}
    if f.get("externo_id") and (doc.get("estado") != "rascunho" or f.get("fornecedor") != "fiz"):
        # TOConline/Moloni criam o documento já finalizado: mesmo um "rascunho" com id externo existe lá
        raise HTTPException(409, f"Documento já criado no {fat.nome_fornecedor(f.get('fornecedor'))} — "
                                 "não se elimina. Carregue em «Assinar» para concluir ou anule-o.")
    efeitos = await reverter_efeitos_documento(doc)
    # Ao apagar fatura, apaga também recibos associados (já anulados na reversão)
    if doc.get("tipo") in ("fatura", "fatura_recibo"):
        for r in await documentos_financeiros_repo.find({"fatura_id": did}, limit=500):
            await documentos_financeiros_repo.delete({"id": r["id"]})
    await documentos_financeiros_repo.delete({"id": did})
    await desligar_pagamento_do_documento(doc)
    label = DOC_TIPO_PT.get(doc.get("tipo"), doc.get("tipo"))
    extra = ""
    if efeitos.get("pagamentos_revertidos"):
        extra = f" · {efeitos['pagamentos_revertidos']} pagamento(s) revertido(s) na encomenda"
    await audit.registar(
        "documento_financeiro", did, "eliminado", user,
        f"{label} {doc.get('numero')} eliminado{extra}",
        doc.get("numero"),
    )
    return {"ok": True, **efeitos}


@router.post("/encomendas/{eid}/documentos")
async def emitir_documento_encomenda(
    eid: str,
    body: EmitirDocBody,
    user: dict = Depends(require_perm("financeiro", "create")),
):
    """Emite fatura / proforma / fatura-recibo (parcial ou total) a partir de uma encomenda."""
    linhas = None
    if body.linhas:
        linhas = [
            LinhaParcialInput(encomenda_artigo_id=l.encomenda_artigo_id, quantidade=l.quantidade)
            for l in body.linhas
        ]
    return await emitir_from_encomenda(
        eid,
        body.tipo,
        user,
        metodo_pagamento=body.metodo_pagamento or "transferencia",
        notas=body.notas or "",
        valor=body.valor,
        linhas=linhas,
        adiantamento=bool(body.adiantamento),
    )


@router.get("/encomendas/{eid}/faturacao")
async def faturacao_encomenda(eid: str, _u: dict = Depends(require_perm("financeiro", "view"))):
    """Resumo do que já foi faturado vs restante por artigo da encomenda."""
    return await resumo_faturacao_encomenda(eid)


@router.get("/encomendas/{eid}/documentos")
async def list_documentos_encomenda(eid: str, _u: dict = Depends(require_perm("financeiro", "view"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    docs = await documentos_financeiros_repo.find(
        {"encomenda_id": eid, "tipo": {"$ne": "recibo"}},
        sort=("created_at", -1),
        limit=200,
    )
    return [await enrich_documento(d) for d in docs]
