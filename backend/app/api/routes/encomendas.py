from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.database import now_iso, next_sequence, new_id
from app.core.security import get_current_user
from app.domain.models import EncomendaInput, Encomenda, OrdemFabricoInput, OrdemFabrico, ENC_ESTADO_PT
from app.repositories import encomendas_repo, ordens_repo
from app.services.costing import compute_encomenda, recompute_of_status, build_of_itens
from app.services.pdf import load_pdf_config, fetch_cliente, fetch_orcamento, build_encomenda_pdf
from app.services import audit

_ENC_CAMPOS = ["cliente", "descricao", "prazo_entrega", "notas", "valor_total", "desconto_total"]

router = APIRouter()


@router.get("/encomendas")
async def list_encomendas(_u: dict = Depends(get_current_user)):
    encs = await encomendas_repo.find(sort=("created_at", -1), limit=5000)
    return [await compute_encomenda(e) for e in encs]


@router.get("/encomendas/{eid}")
async def get_encomenda(eid: str, _u: dict = Depends(get_current_user)):
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    ofs = await ordens_repo.find({"encomenda_id": eid}, sort=("created_at", -1))
    e["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    return e


@router.post("/encomendas")
async def create_encomenda(data: EncomendaInput, user: dict = Depends(get_current_user)):
    enc = Encomenda(**data.model_dump())
    enc.numero = await next_sequence("ENC")
    if not enc.data:
        enc.data = now_iso()[:10]
    await encomendas_repo.insert(enc.model_dump())
    await audit.registar("encomenda", enc.id, "criado", user, f"Encomenda {enc.numero} criada", enc.numero)
    return await compute_encomenda(enc.model_dump())


@router.put("/encomendas/{eid}")
async def update_encomenda(eid: str, data: EncomendaInput, user: dict = Depends(get_current_user)):
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
    return await compute_encomenda(merged)


@router.delete("/encomendas/{eid}")
async def delete_encomenda(eid: str, user: dict = Depends(get_current_user)):
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
async def duplicar_encomenda(eid: str, user: dict = Depends(get_current_user)):
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
async def create_of_for_encomenda(eid: str, data: OrdemFabricoInput, user: dict = Depends(get_current_user)):
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
async def encomenda_pdf(eid: str, template_id: Optional[str] = None):
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
