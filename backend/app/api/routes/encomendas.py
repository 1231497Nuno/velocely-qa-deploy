from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.database import now_iso, next_sequence, new_id
from app.core.security import get_current_user
from app.domain.models import EncomendaInput, Encomenda, OrdemFabricoInput, OrdemFabrico
from app.repositories import encomendas_repo, ordens_repo
from app.services.costing import compute_encomenda, recompute_of_status, build_of_itens
from app.services.pdf import load_pdf_config, fetch_cliente, fetch_orcamento, build_encomenda_pdf

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
async def create_encomenda(data: EncomendaInput, _u: dict = Depends(get_current_user)):
    enc = Encomenda(**data.model_dump())
    enc.numero = await next_sequence("ENC")
    if not enc.data:
        enc.data = now_iso()[:10]
    await encomendas_repo.insert(enc.model_dump())
    return await compute_encomenda(enc.model_dump())


@router.put("/encomendas/{eid}")
async def update_encomenda(eid: str, data: EncomendaInput, _u: dict = Depends(get_current_user)):
    existing = await encomendas_repo.get(eid)
    if not existing:
        raise HTTPException(404, "Encomenda não encontrada")
    await encomendas_repo.update(eid, data.model_dump())
    merged = {**existing, **data.model_dump()}
    return await compute_encomenda(merged)


@router.delete("/encomendas/{eid}")
async def delete_encomenda(eid: str, _u: dict = Depends(get_current_user)):
    await ordens_repo.update_many(
        {"encomenda_id": eid}, {"encomenda_id": None, "encomenda_numero": None}
    )
    await encomendas_repo.delete({"id": eid})
    return {"ok": True}


@router.post("/encomendas/{eid}/duplicar")
async def duplicar_encomenda(eid: str, _u: dict = Depends(get_current_user)):
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
    return await compute_encomenda(novo)


@router.post("/encomendas/{eid}/ordens-fabrico")
async def create_of_for_encomenda(eid: str, data: OrdemFabricoInput, _u: dict = Depends(get_current_user)):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    payload = data.model_dump()
    payload["encomenda_id"] = eid
    payload["cliente"] = enc.get("cliente") or payload.get("cliente") or ""
    payload["cliente_id"] = enc.get("cliente_id")
    of = OrdemFabrico(**payload)
    of.numero = await next_sequence("OF")
    of.encomenda_numero = enc.get("numero")
    if not of.data:
        of.data = now_iso()[:10]
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(doc.get("itens", []))
    doc = recompute_of_status(doc)
    await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})
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
