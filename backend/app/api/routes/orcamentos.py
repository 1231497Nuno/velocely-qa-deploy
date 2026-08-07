from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.database import now_iso, new_id, next_sequence, round2
from app.core.security import get_current_user, require_perm
from app.core.pagination import parse_page, page_payload, text_search, apply_status_filter
from app.domain.models import OrcamentoInput, Orcamento, Encomenda, STATUS_PT
from app.repositories import orcamentos_repo, encomendas_repo
from app.services.costing import (
    compute_orcamento_totais, fill_linha_custos, fill_materiais, compute_encomenda,
)
from app.services.pdf import load_pdf_config, fetch_cliente, build_orcamento_pdf
from app.services import audit
from app.services import email as email_service

_ORC_CAMPOS = ["cliente", "descricao", "numero_encomenda", "validade", "margem", "notas", "desconto_total"]

router = APIRouter()


class EnviarEmailBody(BaseModel):
    to: Optional[str] = None
    template_id: Optional[str] = None
    mensagem: str = Field(default="", max_length=2000)


@router.get("/orcamentos")
async def list_orcamentos(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    status: Optional[str] = Query(None),
    _u: dict = Depends(require_perm("orcamentos", "view")),
):
    query = {}
    apply_status_filter(query, status)
    ts = text_search(["numero", "cliente", "descricao", "numero_encomenda"], q)
    if ts:
        query.update(ts)
    if page is None:
        orcs = await orcamentos_repo.find(query, sort=("created_at", -1), limit=5000)
        return [compute_orcamento_totais(o) for o in orcs]
    p, ps, skip = parse_page(page, page_size)
    total = await orcamentos_repo.count(query)
    orcs = await orcamentos_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip)
    return page_payload([compute_orcamento_totais(o) for o in orcs], total, p, ps)


@router.get("/orcamentos/{oid}")
async def get_orcamento(oid: str, _u: dict = Depends(require_perm("orcamentos", "view"))):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    return compute_orcamento_totais(o)


@router.get("/orcamentos/{oid}/pdf")
async def orcamento_pdf(oid: str, template_id: Optional[str] = None, _u: dict = Depends(require_perm("orcamentos", "view"))):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    o = compute_orcamento_totais(o)
    settings, fields, show_branding = await load_pdf_config(template_id)
    cliente = await fetch_cliente(o.get("cliente_id"))
    pdf = build_orcamento_pdf(o, settings, fields, show_branding, cliente)
    filename = f"{o.get('numero', 'orcamento')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/orcamentos/{oid}/enviar-email", summary="Enviar orçamento por email ao cliente")
async def enviar_orcamento_email(
    oid: str,
    body: EnviarEmailBody = EnviarEmailBody(),
    user: dict = Depends(require_perm("orcamentos", "edit")),
):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    o = compute_orcamento_totais(o)
    cliente = await fetch_cliente(o.get("cliente_id"))
    to = (body.to or (cliente or {}).get("email") or "").strip()
    if not to or "@" not in to:
        raise HTTPException(400, "O cliente não tem email válido. Indique um destinatário ou actualize o cliente.")

    settings, fields, show_branding = await load_pdf_config(body.template_id)
    pdf = build_orcamento_pdf(o, settings, fields, show_branding, cliente)
    numero = o.get("numero") or "orcamento"
    total = o.get("total_com_iva") or o.get("total")
    total_str = f"{float(total):.2f} €".replace(".", ",") if total is not None else None
    subject, text, html = await email_service.orcamento_email(
        (cliente or {}).get("nome") or o.get("cliente") or "",
        numero,
        total=total_str,
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

    if o.get("status") == "rascunho":
        await orcamentos_repo.update(oid, {"status": "enviado"})
        await audit.registar(
            "orcamento", oid, "estado_alterado", user,
            f"Estado do orçamento {numero} → Enviado (email)", numero,
        )
    await audit.registar(
        "orcamento", oid, "email_enviado", user,
        f"Orçamento {numero} enviado por email para {email_service.mask_email(to)}", numero,
    )
    return {
        "ok": True,
        "email_sent": True,
        "email_masked": email_service.mask_email(to),
        "message": f"Orçamento enviado para {email_service.mask_email(to)}",
        "status": "enviado" if o.get("status") == "rascunho" else o.get("status"),
    }


@router.post("/orcamentos")
async def create_orcamento(data: OrcamentoInput, user: dict = Depends(require_perm("orcamentos", "create"))):
    o = Orcamento(**data.model_dump())
    o.numero = await next_sequence("ORC")
    if not o.data:
        o.data = now_iso()[:10]
    doc = o.model_dump()
    doc["linhas"] = await fill_linha_custos(doc.get("linhas", []))
    doc["materiais"] = fill_materiais(doc.get("materiais", []))
    await orcamentos_repo.insert(doc)
    doc.pop("_id", None)
    await audit.registar("orcamento", o.id, "criado", user, f"Orçamento {o.numero} criado", o.numero)
    return compute_orcamento_totais(doc)


@router.put("/orcamentos/{oid}")
async def update_orcamento(oid: str, data: OrcamentoInput, user: dict = Depends(require_perm("orcamentos", "edit"))):
    existing = await orcamentos_repo.get(oid)
    if not existing:
        raise HTTPException(404, "Orçamento não encontrado")
    update = data.model_dump()
    update["linhas"] = await fill_linha_custos(update.get("linhas", []))
    update["materiais"] = fill_materiais(update.get("materiais", []))
    alteracoes = audit.diff_campos(existing, update, _ORC_CAMPOS)
    estado_mudou = existing.get("status") != update.get("status")
    await orcamentos_repo.update(oid, update)
    existing.update(update)
    numero = existing.get("numero")
    if estado_mudou:
        await audit.registar(
            "orcamento", oid, "estado_alterado", user,
            f"Estado do orçamento {numero} → {STATUS_PT.get(data.status, data.status)}", numero,
        )
    if alteracoes:
        await audit.registar("orcamento", oid, "editado", user, f"Orçamento {numero} editado", numero, alteracoes)
    return compute_orcamento_totais(existing)


@router.delete("/orcamentos/{oid}")
async def delete_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "delete"))):
    existing = await orcamentos_repo.get(oid)
    await orcamentos_repo.delete({"id": oid})
    if existing:
        await audit.registar("orcamento", oid, "eliminado", user,
                             f"Orçamento {existing.get('numero')} eliminado", existing.get("numero"))
    return {"ok": True}


@router.post("/orcamentos/{oid}/duplicar")
async def duplicar_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "create"))):
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    novo = {**orc}
    novo.update({
        "id": new_id(),
        "numero": await next_sequence("ORC"),
        "status": "rascunho",
        "of_id": None,
        "of_numero": None,
        "numero_encomenda": "",
        "created_at": now_iso(),
        "data": now_iso()[:10],
    })
    await orcamentos_repo.insert(novo)
    await audit.registar("orcamento", novo["id"], "duplicado", user,
                         f"Orçamento {novo['numero']} criado a partir de {orc.get('numero')}", novo["numero"])
    return compute_orcamento_totais(novo)


@router.post("/orcamentos/{oid}/converter")
async def converter_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "edit"))):
    """Converte o orçamento numa ENCOMENDA (as OFs são criadas depois a partir da encomenda)."""
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if orc.get("encomenda_id"):
        existing = await encomendas_repo.get(orc["encomenda_id"])
        if existing:
            return await compute_encomenda(existing)
    # Compatibilidade: orçamentos convertidos no fluxo antigo já têm encomenda associada
    ja = await encomendas_repo.find_one({"orcamento_id": oid})
    if ja:
        await orcamentos_repo.update(oid, {"encomenda_id": ja["id"], "encomenda_numero": ja.get("numero")})
        return await compute_encomenda(ja)

    orc_t = compute_orcamento_totais(orc)
    enc_artigos = [
        {
            "id": new_id(),
            "artigo_id": l.get("artigo_id"),
            "artigo_nome": l.get("artigo_nome", ""),
            "imagem": l.get("imagem") or "",
            "quantidade": l.get("quantidade", 1),
            "preco_unit": l.get("preco_unit") or 0,
            "personalizacoes": l.get("personalizacoes") or [],
        }
        for l in orc.get("linhas", [])
    ]
    enc = Encomenda(
        cliente=orc.get("cliente", ""),
        cliente_id=orc.get("cliente_id"),
        descricao=orc.get("descricao", ""),
        data=now_iso()[:10],
        estado="aberta",
        notas=f"Gerada a partir do orçamento {orc.get('numero')}",
        artigos=enc_artigos,
        imagens=orc.get("imagens") or [],
        valor_total=orc_t.get("total"),
    )
    enc.numero = await next_sequence("ENC")
    enc.orcamento_id = orc["id"]
    enc.orcamento_numero = orc.get("numero")
    await encomendas_repo.insert(enc.model_dump())
    await orcamentos_repo.update(oid, {"encomenda_id": enc.id, "encomenda_numero": enc.numero})
    await audit.registar("orcamento", oid, "convertido", user,
                         f"Orçamento {orc.get('numero')} convertido → Encomenda {enc.numero}", orc.get("numero"))
    await audit.registar("encomenda", enc.id, "criado", user,
                         f"Encomenda {enc.numero} gerada do orçamento {orc.get('numero')}", enc.numero)
    return await compute_encomenda(enc.model_dump())
