"""Ecrã Pagamentos: todos os pagamentos das encomendas, edição e emissão de fatura.

Os pagamentos vivem dentro de cada encomenda (`encomenda.pagamentos`). Um pagamento
fica bloqueado quando já tem documento fiscal assinado (ou foi criado por um recibo).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import round2
from app.core.pagination import parse_page, page_payload
from app.core.security import require_perm
from app.repositories import documentos_financeiros_repo, encomendas_repo
from app.services import audit
from app.services.costing import compute_encomenda, soma_valor_pago
from app.services.financeiro import (
    PAG_METODO_PT, criar_documento_de_pagamento, estado_pagamento_fiscal,
)

router = APIRouter()

METODOS = tuple(PAG_METODO_PT.keys())


def _fold(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "").lower()) if unicodedata.category(c) != "Mn")


async def _docs_por_id(ids) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    docs = await documentos_financeiros_repo.find({"id": {"$in": ids}}, limit=len(ids) + 10)
    return {d["id"]: d for d in docs}


def _linha_pagamento(enc: dict, p: dict, docs: dict) -> dict:
    doc = docs.get(p.get("documento_id") or "")
    est = estado_pagamento_fiscal(p, docs)
    return {
        "id": p.get("id"),
        "encomenda_id": enc.get("id"),
        "encomenda_numero": enc.get("numero") or "",
        "encomenda_estado": enc.get("estado") or "",
        "cliente": enc.get("cliente") or "",
        "cliente_id": enc.get("cliente_id"),
        "data": (p.get("data") or (p.get("created_at") or "")[:10]) or None,
        "valor": round2(p.get("valor") or 0),
        "metodo": p.get("metodo") or "transferencia",
        "metodo_label": PAG_METODO_PT.get(p.get("metodo"), p.get("metodo") or ""),
        "nota": p.get("nota") or "",
        "tipo": p.get("tipo") or "pagamento",
        "origem": p.get("origem") or "encomenda",
        "recibo_numero": p.get("recibo_numero") or "",
        "documento_id": doc.get("id") if doc and doc.get("estado") != "anulada" else None,
        "documento_numero": (doc.get("numero") or "") if doc and doc.get("estado") != "anulada" else "",
        "documento_tipo": (doc.get("tipo") or "") if doc and doc.get("estado") != "anulada" else "",
        "documento_estado": (doc.get("estado") or "") if doc else "",
        "faturado": est["faturado"],
        "bloqueado": est["bloqueado"],
        "motivo_bloqueio": est["motivo"],
        "created_at": p.get("created_at") or "",
    }


@router.get("/pagamentos")
async def list_pagamentos(
    q: str = Query(""),
    metodo: str = Query(""),
    tipo: str = Query("", description="pagamento | devolucao"),
    faturado: str = Query("", description="sim | nao | rascunho"),
    de: str = Query("", description="AAAA-MM-DD"),
    ate: str = Query("", description="AAAA-MM-DD"),
    sort: str = Query("data"),
    order: str = Query("desc"),
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    _u: dict = Depends(require_perm("encomendas", "view")),
):
    encs = await encomendas_repo.find(
        {"pagamentos.0": {"$exists": True}}, sort=("created_at", -1), limit=5000,
    )
    docs = await _docs_por_id(p.get("documento_id") for e in encs for p in (e.get("pagamentos") or []))
    linhas = [_linha_pagamento(e, p, docs) for e in encs for p in (e.get("pagamentos") or [])]

    termo = _fold(q.strip())
    if termo:
        linhas = [
            l for l in linhas
            if any(_fold(l.get(k)).startswith(termo) or termo in _fold(l.get(k)).split()
                   for k in ("cliente", "encomenda_numero", "recibo_numero", "documento_numero", "nota"))
        ]
    if metodo:
        linhas = [l for l in linhas if l["metodo"] == metodo]
    if tipo:
        linhas = [l for l in linhas if l["tipo"] == tipo]
    if faturado:
        linhas = [l for l in linhas if l["faturado"] == faturado]
    if de:
        linhas = [l for l in linhas if (l["data"] or "") >= de]
    if ate:
        linhas = [l for l in linhas if (l["data"] or "") <= ate]

    resumo = {
        "recebido": round2(sum(l["valor"] for l in linhas if l["tipo"] != "devolucao")),
        "devolvido": round2(sum(l["valor"] for l in linhas if l["tipo"] == "devolucao")),
        "por_faturar": round2(sum(l["valor"] for l in linhas if l["tipo"] != "devolucao" and l["faturado"] == "nao")),
        "n_por_faturar": sum(1 for l in linhas if l["tipo"] != "devolucao" and l["faturado"] == "nao"),
    }
    resumo["liquido"] = round2(resumo["recebido"] - resumo["devolvido"])

    campo = sort if sort in ("data", "valor", "cliente", "encomenda_numero", "recibo_numero") else "data"
    linhas.sort(key=lambda l: (l.get(campo) is None, l.get(campo) or "", l.get("created_at") or ""),
                reverse=order != "asc")
    if page is None:
        return {"items": linhas, "resumo": resumo, "total": len(linhas)}
    p, ps, skip = parse_page(page, page_size)
    out = page_payload(linhas[skip:skip + ps], len(linhas), p, ps)
    out["resumo"] = resumo
    return out


class EditarPagamentoBody(BaseModel):
    data: Optional[str] = None
    valor: Optional[float] = None
    metodo: Optional[str] = None
    nota: Optional[str] = None


@router.put("/encomendas/{eid}/pagamentos/{pid}")
async def editar_pagamento(
    eid: str, pid: str, body: EditarPagamentoBody,
    user: dict = Depends(require_perm("encomendas", "edit")),
):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    pagamentos = [dict(p) for p in (enc.get("pagamentos") or [])]
    pag = next((p for p in pagamentos if p.get("id") == pid), None)
    if not pag:
        raise HTTPException(404, "Pagamento não encontrado")
    docs = await _docs_por_id([pag.get("documento_id")])
    est = estado_pagamento_fiscal(pag, docs)
    if est["bloqueado"]:
        raise HTTPException(409, f"Pagamento bloqueado: {est['motivo']}. Para corrigir, anule o documento fiscal.")

    antes = dict(pag)
    if body.data is not None:
        pag["data"] = (body.data or "").strip()[:10] or pag.get("data")
    if body.metodo is not None:
        if body.metodo not in METODOS:
            raise HTTPException(400, f"Método inválido. Use: {', '.join(METODOS)}")
        pag["metodo"] = body.metodo
    if body.nota is not None:
        pag["nota"] = body.nota.strip()
    if body.valor is not None:
        v = round2(body.valor)
        if v <= 0:
            raise HTTPException(400, "O valor deve ser positivo")
        pag["valor"] = v
    total = soma_valor_pago(pagamentos)
    if total < -0.009:
        raise HTTPException(400, "As devoluções não podem ultrapassar o valor pago")
    await encomendas_repo.update(eid, {"pagamentos": pagamentos, "valor_pago": total})

    alteracoes = audit.diff_campos(antes, pag, ["data", "valor", "metodo", "nota"])
    if alteracoes:
        await audit.registar(
            "encomenda", eid, "pagamento", user,
            f"Pagamento {pag.get('recibo_numero') or ''} editado na encomenda {enc.get('numero')}".replace("  ", " "),
            enc.get("numero"), alteracoes,
        )
    enc["pagamentos"] = pagamentos
    enc["valor_pago"] = total
    c = await compute_encomenda(enc)
    return _linha_pagamento(c, pag, docs)


class FaturarPagamentoBody(BaseModel):
    tipo: str = "fatura_recibo"
    notas: str = ""
    assinar: bool = False


@router.post("/encomendas/{eid}/pagamentos/{pid}/documento")
async def faturar_pagamento(
    eid: str, pid: str, body: FaturarPagamentoBody,
    user: dict = Depends(require_perm("financeiro", "create")),
):
    """Cria a fatura(-recibo) deste pagamento — em rascunho, ou já assinada (assinar=true)."""
    return await criar_documento_de_pagamento(
        eid, pid, user, tipo=body.tipo, notas=body.notas, assinar=body.assinar,
    )
