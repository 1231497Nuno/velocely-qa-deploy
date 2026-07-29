"""Rotas do módulo Financeiro — faturas, proformas e faturas-recibo (recibos na fatura)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from io import BytesIO

from app.core.security import require_perm
from app.domain.models import DOC_TIPOS_PRINCIPAIS, DOC_TIPO_PT
from app.repositories import documentos_financeiros_repo, encomendas_repo
from app.services.financeiro import (
    emitir_from_encomenda, emitir_recibo_from_fatura, enrich_documento,
    resumo_faturacao_encomenda, LinhaParcialInput,
)
from app.services.pdf import load_pdf_config, fetch_cliente, build_documento_financeiro_pdf
from app.services import audit

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


class EmitirReciboBody(BaseModel):
    valor: Optional[float] = None
    metodo_pagamento: str = "transferencia"
    notas: str = ""


@router.get("/financeiro/documentos")
async def list_documentos(
    tipo: Optional[str] = Query(None),
    _u: dict = Depends(require_perm("financeiro", "view")),
):
    query = {"tipo": {"$ne": "recibo"}}  # recibos vivem dentro da fatura
    if tipo:
        if tipo not in DOC_TIPOS_PRINCIPAIS:
            raise HTTPException(400, f"Tipo inválido. Use: {', '.join(DOC_TIPOS_PRINCIPAIS)}")
        query = {"tipo": tipo}
    docs = await documentos_financeiros_repo.find(query, sort=("created_at", -1), limit=2000)
    return [await enrich_documento(d) for d in docs]


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
    authorization: str = Header(None),
    auth: str = Query(None),
):
    """Aceita Bearer header ou ?auth= (abertura em nova tab)."""
    import jwt
    from app.core import config

    header = authorization or (f"Bearer {auth}" if auth else None)
    if not header or not header.startswith("Bearer "):
        raise HTTPException(401, "Não autenticado")
    try:
        jwt.decode(header[7:], config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Não autenticado")

    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    settings, _, show_branding = await load_pdf_config(None)
    cliente = await fetch_cliente(doc.get("cliente_id"))
    pdf = build_documento_financeiro_pdf(doc, settings=settings, cliente=cliente, show_branding=show_branding)
    filename = f"{doc.get('numero') or 'documento'}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/financeiro/documentos/{did}/anular")
async def anular_documento(did: str, user: dict = Depends(require_perm("financeiro", "edit"))):
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    if doc.get("estado") == "anulada":
        return await enrich_documento(doc)
    await documentos_financeiros_repo.update(did, {"estado": "anulada"})
    doc["estado"] = "anulada"
    label = DOC_TIPO_PT.get(doc.get("tipo"), doc.get("tipo"))
    await audit.registar(
        "documento_financeiro", did, "estado_alterado", user,
        f"{label} {doc.get('numero')} anulado",
        doc.get("numero"),
    )
    return await enrich_documento(doc)


@router.delete("/financeiro/documentos/{did}")
async def delete_documento(did: str, user: dict = Depends(require_perm("financeiro", "delete"))):
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    # Ao apagar fatura, apaga também recibos associados
    if doc.get("tipo") in ("fatura", "fatura_recibo"):
        for r in await documentos_financeiros_repo.find({"fatura_id": did}, limit=500):
            await documentos_financeiros_repo.delete({"id": r["id"]})
    await documentos_financeiros_repo.delete({"id": did})
    label = DOC_TIPO_PT.get(doc.get("tipo"), doc.get("tipo"))
    await audit.registar(
        "documento_financeiro", did, "eliminado", user,
        f"{label} {doc.get('numero')} eliminado",
        doc.get("numero"),
    )
    return {"ok": True}


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
