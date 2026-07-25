from io import BytesIO
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core import config
from app.core.database import now_iso, next_sequence, new_id, round2
from app.core.security import get_current_user, require_perm
from app.domain.models import EncomendaInput, Encomenda, OrdemFabricoInput, OrdemFabrico, ENC_ESTADO_PT, Pagamento
from app.repositories import encomendas_repo, ordens_repo
from app.services.costing import compute_encomenda, recompute_of_status, build_of_itens
from app.services.pdf import load_pdf_config, fetch_cliente, fetch_orcamento, build_encomenda_pdf, build_recibo_pdf
from app.services import audit
from app.services import email as email_service

_ENC_CAMPOS = ["cliente", "descricao", "prazo_entrega", "notas", "valor_total", "desconto_total"]

PAG_METODO_PT = {
    "transferencia": "Transferência bancária", "numerario": "Numerário", "mbway": "MB WAY",
    "cheque": "Cheque", "cartao": "Cartão", "outro": "Outro",
}


class PagamentoBody(BaseModel):
    valor: float
    metodo: str = "transferencia"
    nota: str = ""
    data: Optional[str] = None


class EnviarEmailBody(BaseModel):
    to: Optional[str] = None
    template_id: Optional[str] = None
    mensagem: str = ""


router = APIRouter()


def _recompute_pago(enc: dict) -> float:
    return round2(sum((p.get("valor") or 0) for p in (enc.get("pagamentos") or [])))


async def _attach_ofs(enc: dict) -> dict:
    ofs = await ordens_repo.find({"encomenda_id": enc["id"]}, sort=("created_at", -1))
    enc["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    return enc


@router.post("/encomendas/{eid}/pagamentos")
async def add_pagamento(eid: str, body: PagamentoBody, user: dict = Depends(require_perm("encomendas", "edit"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    if (body.valor or 0) <= 0:
        raise HTTPException(400, "O valor do pagamento deve ser positivo")
    pag = Pagamento(valor=round2(body.valor), metodo=body.metodo, nota=body.nota or "", data=body.data or now_iso()[:10])
    pag.recibo_numero = await next_sequence("REC")
    pagamentos = (enc.get("pagamentos") or []) + [pag.model_dump()]
    total = round2(sum((p.get("valor") or 0) for p in pagamentos))
    await encomendas_repo.update(eid, {"pagamentos": pagamentos, "valor_pago": total})
    enc["pagamentos"] = pagamentos
    enc["valor_pago"] = total
    await audit.registar("encomenda", eid, "pagamento", user,
                         f"Pagamento de {pag.valor:.2f}€ ({PAG_METODO_PT.get(pag.metodo, pag.metodo)}) na encomenda {enc.get('numero')} · recibo {pag.recibo_numero}", enc.get("numero"))
    return await _attach_ofs(await compute_encomenda(enc))


@router.delete("/encomendas/{eid}/pagamentos/{pid}")
async def delete_pagamento(eid: str, pid: str, user: dict = Depends(require_perm("encomendas", "edit"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    pagamentos = [p for p in (enc.get("pagamentos") or []) if p.get("id") != pid]
    total = round2(sum((p.get("valor") or 0) for p in pagamentos))
    await encomendas_repo.update(eid, {"pagamentos": pagamentos, "valor_pago": total})
    enc["pagamentos"] = pagamentos
    enc["valor_pago"] = total
    await audit.registar("encomenda", eid, "pagamento", user, f"Pagamento removido da encomenda {enc.get('numero')}", enc.get("numero"))
    return await _attach_ofs(await compute_encomenda(enc))


def _valid_token(authorization: Optional[str], auth: Optional[str]) -> bool:
    header = authorization or (f"Bearer {auth}" if auth else None)
    if not header or not header.startswith("Bearer "):
        return False
    try:
        jwt.decode(header[7:], config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        return True
    except jwt.InvalidTokenError:
        return False


@router.get("/encomendas/{eid}/pagamentos/{pid}/recibo")
async def recibo_pdf(eid: str, pid: str, authorization: str = Header(None), auth: str = Query(None)):
    if not _valid_token(authorization, auth):
        raise HTTPException(401, "Não autenticado")
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    pag = next((p for p in (enc.get("pagamentos") or []) if p.get("id") == pid), None)
    if not pag:
        raise HTTPException(404, "Pagamento não encontrado")
    settings, _fields, _sb = await load_pdf_config(None)
    cliente = await fetch_cliente(enc.get("cliente_id"))
    pdf = build_recibo_pdf(enc, pag, settings, cliente, PAG_METODO_PT.get(pag.get("metodo"), pag.get("metodo")))
    filename = f"recibo_{pag.get('recibo_numero') or pid}.pdf"
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{filename}"'})


@router.get("/encomendas")
async def list_encomendas(_u: dict = Depends(require_perm("encomendas", "view"))):
    encs = await encomendas_repo.find(sort=("created_at", -1), limit=5000)
    return [await compute_encomenda(e) for e in encs]


@router.get("/encomendas/{eid}")
async def get_encomenda(eid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    return await _attach_ofs(e)


@router.post("/encomendas")
async def create_encomenda(data: EncomendaInput, user: dict = Depends(require_perm("encomendas", "create"))):
    enc = Encomenda(**data.model_dump())
    enc.numero = await next_sequence("ENC")
    if not enc.data:
        enc.data = now_iso()[:10]
    await encomendas_repo.insert(enc.model_dump())
    await audit.registar("encomenda", enc.id, "criado", user, f"Encomenda {enc.numero} criada", enc.numero)
    return await _attach_ofs(await compute_encomenda(enc.model_dump()))


@router.put("/encomendas/{eid}")
async def update_encomenda(eid: str, data: EncomendaInput, user: dict = Depends(require_perm("encomendas", "edit"))):
    existing = await encomendas_repo.get(eid)
    if not existing:
        raise HTTPException(404, "Encomenda não encontrada")
    novo = data.model_dump()
    numero = existing.get("numero")
    await encomendas_repo.update(eid, novo)
    # pagamento
    old_pago = existing.get("valor_pago") or 0
    new_pago = novo.get("valor_pago") or 0
    if round(old_pago, 2) != round(new_pago, 2):
        await audit.registar("encomenda", eid, "pagamento", user,
                             f"Pagamento da encomenda {numero}: {old_pago:.2f} → {new_pago:.2f}", numero)
    # autorização de produção
    if bool(existing.get("autorizada_producao")) != bool(novo.get("autorizada_producao")):
        estado = "autorizada" if novo.get("autorizada_producao") else "revogada"
        await audit.registar("encomenda", eid, "producao_autorizada", user,
                             f"Produção {estado} na encomenda {numero}", numero)
    # estado
    if existing.get("estado") != novo.get("estado"):
        await audit.registar("encomenda", eid, "estado_alterado", user,
                             f"Estado da encomenda {numero} → {ENC_ESTADO_PT.get(novo.get('estado'), novo.get('estado'))}", numero)
    # outros campos
    alteracoes = audit.diff_campos(existing, novo, _ENC_CAMPOS)
    if alteracoes:
        await audit.registar("encomenda", eid, "editado", user, f"Encomenda {numero} editada", numero, alteracoes)
    merged = {**existing, **novo}
    return await _attach_ofs(await compute_encomenda(merged))


@router.delete("/encomendas/{eid}")
async def delete_encomenda(eid: str, user: dict = Depends(require_perm("encomendas", "delete"))):
    existing = await encomendas_repo.get(eid)
    await ordens_repo.update_many(
        {"encomenda_id": eid}, {"encomenda_id": None, "encomenda_numero": None}
    )
    await encomendas_repo.delete({"id": eid})
    if existing:
        await audit.registar("encomenda", eid, "eliminado", user,
                             f"Encomenda {existing.get('numero')} eliminada", existing.get("numero"))
    return {"ok": True}


@router.post("/encomendas/{eid}/duplicar")
async def duplicar_encomenda(eid: str, user: dict = Depends(require_perm("encomendas", "create"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    novo = {**enc}
    novo.update({
        "id": new_id(),
        "numero": await next_sequence("ENC"),
        "estado": "aberta",
        "valor_pago": 0.0,
        "autorizada_producao": False,
        "orcamento_id": None,
        "orcamento_numero": None,
        "created_at": now_iso(),
        "data": now_iso()[:10],
    })
    await encomendas_repo.insert(novo)
    await audit.registar("encomenda", novo["id"], "duplicado", user,
                         f"Encomenda {novo['numero']} criada a partir de {enc.get('numero')}", novo["numero"])
    return await compute_encomenda(novo)


@router.post("/encomendas/{eid}/ordens-fabrico")
async def create_of_for_encomenda(eid: str, data: OrdemFabricoInput, user: dict = Depends(require_perm("ordens_fabrico", "create"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    payload = data.model_dump()
    payload["encomenda_id"] = eid
    payload["cliente"] = enc.get("cliente") or payload.get("cliente") or ""
    payload["cliente_id"] = enc.get("cliente_id")
    if not payload.get("imagens"):
        payload["imagens"] = enc.get("imagens") or []
    of = OrdemFabrico(**payload)
    of.numero = await next_sequence("OF")
    of.encomenda_numero = enc.get("numero")
    if not of.data:
        of.data = now_iso()[:10]
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(doc.get("itens", []))
    doc = recompute_of_status(doc)
    await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})
    await audit.registar("ordem_fabrico", of.id, "criado", user,
                         f"OF {of.numero} criada na encomenda {enc.get('numero')}", of.numero)
    await audit.registar("encomenda", eid, "editado", user,
                         f"OF {of.numero} associada à encomenda {enc.get('numero')}", enc.get("numero"))
    return doc


@router.get("/encomendas/{eid}/pdf")
async def encomenda_pdf(eid: str, template_id: Optional[str] = None, _u: dict = Depends(require_perm("encomendas", "view"))):
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    ofs = await ordens_repo.find({"encomenda_id": eid}, sort=("created_at", -1))
    e["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    settings, fields, show_branding = await load_pdf_config(template_id)
    cliente = await fetch_cliente(e.get("cliente_id"))
    orcamento = await fetch_orcamento(e.get("orcamento_id"))
    pdf = build_encomenda_pdf(e, settings, fields, show_branding, cliente, orcamento)
    filename = f"{e.get('numero', 'encomenda')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/encomendas/{eid}/enviar-email-pronta", summary="Notificar cliente: encomenda pronta")
async def enviar_encomenda_pronta_email(
    eid: str,
    body: EnviarEmailBody = EnviarEmailBody(),
    user: dict = Depends(require_perm("encomendas", "edit")),
):
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    if e.get("estado") == "cancelada":
        raise HTTPException(400, "Não é possível notificar uma encomenda cancelada")

    cliente = await fetch_cliente(e.get("cliente_id"))
    to = (body.to or (cliente or {}).get("email") or "").strip()
    if not to or "@" not in to:
        raise HTTPException(400, "O cliente não tem email válido. Indique um destinatário ou actualize o cliente.")

    ofs = await ordens_repo.find({"encomenda_id": eid}, sort=("created_at", -1))
    e["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    settings, fields, show_branding = await load_pdf_config(body.template_id)
    orcamento = await fetch_orcamento(e.get("orcamento_id"))
    pdf = build_encomenda_pdf(e, settings, fields, show_branding, cliente, orcamento)
    numero = e.get("numero") or "encomenda"
    subject, text, html = await email_service.encomenda_pronta_email(
        (cliente or {}).get("nome") or e.get("cliente") or "",
        numero,
        mensagem=body.mensagem or "",
    )
    ok, reason = email_service.send_email(
        to,
        subject,
        text,
        html=html,
        attach_logo=True,
        attachments=[(f"{numero}.pdf", pdf, "application/pdf")],
    )
    if not ok and reason == "no_smtp":
        raise HTTPException(503, "Envio de email não está configurado. Contacte o administrador.")
    if not ok:
        raise HTTPException(500, f"Não foi possível enviar o email: {reason}")

    await audit.registar(
        "encomenda", eid, "email_enviado", user,
        f"Notificação de encomenda {numero} pronta enviada para {email_service.mask_email(to)}", numero,
    )
    return {
        "ok": True,
        "email_sent": True,
        "email_masked": email_service.mask_email(to),
        "message": f"Notificação enviada para {email_service.mask_email(to)}",
    }
