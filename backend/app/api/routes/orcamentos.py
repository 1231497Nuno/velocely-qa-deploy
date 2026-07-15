from io import BytesIO
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.database import now_iso, new_id, next_sequence, round2
from app.domain.models import OrcamentoInput, Orcamento, OrdemFabrico, Encomenda, OFOperacao
from app.repositories import orcamentos_repo, ordens_repo, encomendas_repo
from app.services.costing import (
    compute_orcamento_totais, fill_linha_custos, fill_materiais, build_of_itens,
    recompute_of_status, pers_nomes, op_minutos_maquina, op_minutos_mao_obra, maquina_custo_hora,
)
from app.services.pdf import load_pdf_config, fetch_cliente, build_orcamento_pdf
from app.repositories import maquinas_repo, mao_obra_repo

router = APIRouter()


@router.get("/orcamentos")
async def list_orcamentos():
    orcs = await orcamentos_repo.find(sort=("created_at", -1))
    return [compute_orcamento_totais(o) for o in orcs]


@router.get("/orcamentos/{oid}")
async def get_orcamento(oid: str):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    return compute_orcamento_totais(o)


@router.get("/orcamentos/{oid}/pdf")
async def orcamento_pdf(oid: str, template_id: Optional[str] = None):
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


@router.post("/orcamentos")
async def create_orcamento(data: OrcamentoInput):
    o = Orcamento(**data.model_dump())
    o.numero = await next_sequence("ORC")
    if not o.data:
        o.data = now_iso()[:10]
    doc = o.model_dump()
    doc["linhas"] = await fill_linha_custos(doc.get("linhas", []))
    doc["materiais"] = fill_materiais(doc.get("materiais", []))
    await orcamentos_repo.insert(doc)
    doc.pop("_id", None)
    return compute_orcamento_totais(doc)


@router.put("/orcamentos/{oid}")
async def update_orcamento(oid: str, data: OrcamentoInput):
    existing = await orcamentos_repo.get(oid)
    if not existing:
        raise HTTPException(404, "Orçamento não encontrado")
    update = data.model_dump()
    update["linhas"] = await fill_linha_custos(update.get("linhas", []))
    update["materiais"] = fill_materiais(update.get("materiais", []))
    await orcamentos_repo.update(oid, update)
    existing.update(update)
    return compute_orcamento_totais(existing)


@router.delete("/orcamentos/{oid}")
async def delete_orcamento(oid: str):
    await orcamentos_repo.delete({"id": oid})
    return {"ok": True}


@router.post("/orcamentos/{oid}/duplicar")
async def duplicar_orcamento(oid: str):
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
    return compute_orcamento_totais(novo)


@router.post("/orcamentos/{oid}/converter")
async def converter_orcamento(oid: str):
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if orc.get("of_id"):
        existing = await ordens_repo.get(orc["of_id"])
        if existing:
            return recompute_of_status(existing)

    itens = []
    for l in orc.get("linhas", []):
        operacoes = []
        for op in l.get("roteiro", []):
            t_maq = op_minutos_maquina(op)
            t_mo = op_minutos_mao_obra(op)
            maq = await maquinas_repo.get(op.get("maquina_id")) if op.get("maquina_id") else None
            mo = await mao_obra_repo.get(op.get("mao_obra_id")) if op.get("mao_obra_id") else None
            mo_hora = (mo or {}).get("custo_hora") or 0
            maq_hora = maquina_custo_hora(maq)
            custo_maq = round2((t_maq / 60.0) * maq_hora)
            custo_mo = round2((t_mo / 60.0) * mo_hora)
            operacoes.append(
                OFOperacao(
                    nome=op.get("nome", ""),
                    maquina_id=op.get("maquina_id"),
                    maquina_nome=op.get("maquina_nome") or ((maq or {}).get("nome")),
                    mao_obra_id=op.get("mao_obra_id"),
                    mao_obra_nome=op.get("mao_obra_nome") or ((mo or {}).get("nome")),
                    tempo_maquina=t_maq,
                    tempo_maquina_base=t_maq,
                    tempo_mao_obra=t_mo,
                    tempo_mao_obra_base=t_mo,
                    tempo_min=t_maq + t_mo,
                    custo_estimado=round2(custo_maq + custo_mo),
                    custo_maquina_estimado=custo_maq,
                    custo_mao_obra_estimado=custo_mo,
                    maquina_custo_hora=maq_hora,
                    mao_obra_custo_hora=mo_hora,
                ).model_dump()
            )
        itens.append(
            {
                "artigo_id": l.get("artigo_id"),
                "artigo_nome": l.get("artigo_nome"),
                "quantidade": l.get("quantidade", 1),
                "preco_unit": l.get("preco_unit") or 0,
                "tipo_personalizacao_id": l.get("tipo_personalizacao_id"),
                "tipo_personalizacao_nome": pers_nomes(l) or l.get("tipo_personalizacao_nome"),
                "personalizacoes": l.get("personalizacoes") or [],
                "operacoes": operacoes,
            }
        )
    of = OrdemFabrico(
        cliente=orc.get("cliente", ""),
        cliente_id=orc.get("cliente_id"),
        descricao=orc.get("descricao", ""),
        numero_encomenda=orc.get("numero_encomenda", ""),
        data=now_iso()[:10],
        status="pendente",
        notas=f"Gerada a partir do orçamento {orc.get('numero')}",
    )
    of.numero = await next_sequence("OF")
    of.orcamento_id = orc["id"]
    of.orcamento_numero = orc.get("numero")
    orc_t = compute_orcamento_totais(orc)
    enc_artigos = [
        {
            "id": new_id(),
            "artigo_id": l.get("artigo_id"),
            "artigo_nome": l.get("artigo_nome", ""),
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
        valor_total=orc_t.get("total"),
    )
    enc.numero = await next_sequence("ENC")
    enc.orcamento_id = orc["id"]
    enc.orcamento_numero = orc.get("numero")
    await encomendas_repo.insert(enc.model_dump())
    of.encomenda_id = enc.id
    of.encomenda_numero = enc.numero
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(itens)
    doc = recompute_of_status(doc)
    await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})
    await orcamentos_repo.update(oid, {"of_id": of.id, "of_numero": of.numero})
    return doc
