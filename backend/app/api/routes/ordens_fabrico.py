from io import BytesIO
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import campos as campos_svc
from app.core.database import now_iso, next_sequence
from app.core.security import get_current_user, require_perm
from app.core.pagination import parse_page, page_payload, text_search, apply_status_filter
from app.domain.models import OrdemFabricoInput, OrdemFabrico, STATUS_PT
from app.repositories import ordens_repo, encomendas_repo, artigos_repo
from app.services.costing import (
    recompute_of_status, build_of_itens, artigo_breakdown, compute_encomenda,
    op_custo_real, op_labor_rate, op_machine_cost_est, op_machine_cost_real,
)
from app.core.database import round2
from app.services.pdf import load_pdf_config, fetch_cliente, fetch_orcamento, build_of_pdf
from app.services import audit

router = APIRouter()


async def _enrich_ofs(ofs: list) -> list:
    ofs = [recompute_of_status(o) for o in ofs]
    enc_ids = list({o.get("encomenda_id") for o in ofs if o.get("encomenda_id")})
    enc_map = {}
    if enc_ids:
        encs = await encomendas_repo.find({"id": {"$in": enc_ids}}, limit=2000)
        enc_map = {e["id"]: e for e in encs}
    for o in ofs:
        e = enc_map.get(o.get("encomenda_id")) or {}
        o["prazo_entrega"] = e.get("prazo_entrega")
        o["encomenda_numero"] = e.get("numero") or o.get("encomenda_numero")
    ofs.sort(key=lambda o: (
        0 if o.get("prioritaria") else 1,
        o.get("prazo_entrega") or "9999-12-31",
        o.get("created_at") or "",
    ))
    return ofs


@router.get("/ordens-fabrico")
async def list_ofs(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    status: Optional[str] = Query(None),
    responsavel_id: Optional[str] = Query(None),
    _u: dict = Depends(require_perm("ordens_fabrico", "view")),
):
    query = {}
    apply_status_filter(query, status)
    if responsavel_id:
        query["responsavel_id"] = responsavel_id
    ts = text_search(["numero", "cliente", "encomenda_numero"], q)
    if ts:
        query.update(ts)
    if page is None:
        ofs = await ordens_repo.find(query, limit=5000)
        return await _enrich_ofs(ofs)
    p, ps, skip = parse_page(page, page_size)
    total = await ordens_repo.count(query)
    # Ordenação estável por created_at; prioridade/prazo aplicados após enrich na página
    ofs = await ordens_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip)
    items = await _enrich_ofs(ofs)
    return page_payload(items, total, p, ps)


@router.get("/ordens-fabrico/{ofid}")
async def get_of(ofid: str, _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    o = await ordens_repo.get(ofid)
    if not o:
        raise HTTPException(404, "OF não encontrada")
    o = recompute_of_status(o)
    # Backfill runtime: OFs antigas sem preco_unit/unidade por item
    for it in o.get("itens", []):
        if it.get("artigo_id") and (not it.get("preco_unit") or not it.get("unidade")):
            a = await artigos_repo.get(it["artigo_id"])
            if a:
                if not it.get("preco_unit"):
                    it["preco_unit"] = (await artigo_breakdown(a)).get("preco_venda") or 0
                if not it.get("unidade"):
                    it["unidade"] = a.get("unidade") or "un"
    if o.get("encomenda_id"):
        e = await encomendas_repo.get(o["encomenda_id"])
        o["prazo_entrega"] = (e or {}).get("prazo_entrega")
    return o


class PrioridadeBody(BaseModel):
    prioritaria: bool


@router.post("/ordens-fabrico/{ofid}/prioridade")
async def set_of_prioridade(ofid: str, body: PrioridadeBody, user: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    existing = await ordens_repo.get(ofid)
    if not existing:
        raise HTTPException(404, "OF não encontrada")
    await ordens_repo.update(ofid, {"prioritaria": body.prioritaria})
    o = await ordens_repo.get(ofid)
    txt = "marcada como prioritária" if body.prioritaria else "sem prioridade"
    await audit.registar("ordem_fabrico", ofid, "prioridade", user,
                         f"OF {existing.get('numero')} {txt}", existing.get("numero"))
    return recompute_of_status(o)


@router.get("/ordens-fabrico/{ofid}/pdf")
async def of_pdf(ofid: str, template_id: Optional[str] = None, _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    o = await ordens_repo.get(ofid)
    if not o:
        raise HTTPException(404, "OF não encontrada")
    o = recompute_of_status(o)
    settings, fields, show_branding = await load_pdf_config(template_id)
    cliente = await fetch_cliente(o.get("cliente_id"))
    orcamento = await fetch_orcamento(o.get("orcamento_id"))
    pdf = build_of_pdf(o, settings, fields, show_branding, cliente, orcamento)
    filename = f"{o.get('numero', 'ordem-fabrico')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/ordens-fabrico")
async def create_of(data: OrdemFabricoInput, user: dict = Depends(require_perm("ordens_fabrico", "create"))):
    of = OrdemFabrico(**await campos_svc.aplicar("ordens_fabrico", data.model_dump(), "criar"))
    of.numero = await next_sequence("OF")
    if of.encomenda_id:
        enc = await encomendas_repo.get(of.encomenda_id)
        if enc:
            of.encomenda_numero = enc.get("numero")
    if not of.data:
        of.data = now_iso()[:10]
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(doc.get("itens", []))
    doc = recompute_of_status(doc)
    await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})
    await audit.registar("ordem_fabrico", of.id, "criado", user, f"OF {of.numero} criada", of.numero)
    return doc


_MSG_OF_FINALIZADA = "A OF está finalizada e já não pode ser editada."


def _of_finalizada(of: dict) -> bool:
    return recompute_of_status(of).get("status") == "concluido"


@router.put("/ordens-fabrico/{ofid}")
async def update_of(ofid: str, data: OrdemFabricoInput, user: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    existing = await ordens_repo.get(ofid)
    if not existing:
        raise HTTPException(404, "OF não encontrada")
    if _of_finalizada(existing):
        raise HTTPException(409, _MSG_OF_FINALIZADA)
    update = await campos_svc.aplicar("ordens_fabrico", data.model_dump(), "guardar", existing)
    update.pop("anexos", None)
    update["itens"] = await build_of_itens(update.get("itens", []))
    merged = {**existing, **update}
    merged = recompute_of_status(merged)
    to_save = {k: v for k, v in merged.items() if k != "progresso"}
    await ordens_repo.update(ofid, to_save)
    numero = existing.get("numero")
    if existing.get("status") != update.get("status"):
        await audit.registar("ordem_fabrico", ofid, "estado_alterado", user,
                             f"Estado da OF {numero} → {STATUS_PT.get(update.get('status'), update.get('status'))}", numero)
    else:
        await audit.registar("ordem_fabrico", ofid, "editado", user, f"OF {numero} editada", numero)
    return merged


class ToggleOp(BaseModel):
    item_id: str
    operacao_id: str
    concluida: bool


def _find_op(of: dict, item_id: str, operacao_id: str):
    for it in of.get("itens", []):
        if it.get("id") == item_id:
            for op in it.get("operacoes", []):
                if op.get("id") == operacao_id:
                    return op
    return None


async def _save_of(ofid: str, of: dict):
    of = recompute_of_status(of)
    to_save = {k: v for k, v in of.items() if k != "progresso"}
    await ordens_repo.update(ofid, to_save)
    return of


class TimerBody(BaseModel):
    item_id: str
    operacao_id: str


@router.post("/ordens-fabrico/{ofid}/operacao/iniciar")
async def iniciar_operacao(ofid: str, body: TimerBody, _u: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    if _of_finalizada(of):
        raise HTTPException(409, _MSG_OF_FINALIZADA)
    if of.get("encomenda_id"):
        enc = await encomendas_repo.get(of["encomenda_id"])
        if enc:
            from app.services import workflow
            workflow.assert_nao_bloqueada(enc, "iniciar a produção")
            enc_c = await compute_encomenda(enc)
            if not enc_c["pode_produzir"]:
                raise HTTPException(
                    403,
                    "Produção não autorizada: pagamento pendente. Registe o pagamento total ou autorize a produção manualmente na encomenda.",
                )
    op = _find_op(of, body.item_id, body.operacao_id)
    if not op:
        raise HTTPException(404, "Operação não encontrada")
    if not op.get("timer_inicio"):
        op["timer_inicio"] = now_iso()
    return await _save_of(ofid, of)


def _stop_op(op: dict):
    if op.get("timer_inicio"):
        inicio = datetime.fromisoformat(op["timer_inicio"])
        elapsed = (datetime.now(timezone.utc) - inicio).total_seconds()
        op["tempo_real_seg"] = (op.get("tempo_real_seg") or 0) + max(0, elapsed)
        op["timer_inicio"] = None


@router.post("/ordens-fabrico/{ofid}/operacao/parar")
async def parar_operacao(ofid: str, body: TimerBody, _u: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    op = _find_op(of, body.item_id, body.operacao_id)
    if not op:
        raise HTTPException(404, "Operação não encontrada")
    _stop_op(op)
    return await _save_of(ofid, of)


@router.post("/ordens-fabrico/{ofid}/finalizar")
async def finalizar_of(ofid: str, user: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    await campos_svc.aplicar("ordens_fabrico", {}, "finalizar", of)
    for it in of.get("itens", []):
        for op in it.get("operacoes", []):
            _stop_op(op)
            op["concluida"] = True
    # Sem operações o estado não se deduz do roteiro: marcar explicitamente
    of["status"] = "concluido"
    saved = await _save_of(ofid, of)
    await audit.registar("ordem_fabrico", ofid, "concluido", user,
                         f"OF {of.get('numero')} finalizada (todas as operações concluídas)", of.get("numero"))
    return saved


@router.post("/ordens-fabrico/{ofid}/toggle-operacao")
async def toggle_operacao(ofid: str, body: ToggleOp, _u: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    if body.concluida and _of_finalizada(of):
        # Numa OF finalizada só se permite desmarcar uma operação (reabre a OF)
        raise HTTPException(409, _MSG_OF_FINALIZADA)
    op = _find_op(of, body.item_id, body.operacao_id)
    if op:
        op["concluida"] = body.concluida
        if body.concluida:
            _stop_op(op)
    return await _save_of(ofid, of)


class NotaBody(BaseModel):
    item_id: str
    operacao_id: str
    nota: str = ""


@router.post("/ordens-fabrico/{ofid}/operacao/nota")
async def nota_operacao(ofid: str, body: NotaBody, _u: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    if _of_finalizada(of):
        raise HTTPException(409, _MSG_OF_FINALIZADA)
    op = _find_op(of, body.item_id, body.operacao_id)
    if not op:
        raise HTTPException(404, "Operação não encontrada")
    op["nota"] = body.nota or ""
    return await _save_of(ofid, of)


@router.delete("/ordens-fabrico/{ofid}")
async def delete_of(ofid: str, user: dict = Depends(require_perm("ordens_fabrico", "delete"))):
    existing = await ordens_repo.get(ofid)
    await ordens_repo.delete({"id": ofid})
    if existing:
        await audit.registar("ordem_fabrico", ofid, "eliminado", user,
                             f"OF {existing.get('numero')} eliminada", existing.get("numero"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Acerto de tempos (ecrã próprio): corrigir os tempos reais para acertar custos.
# Funciona também em OFs finalizadas — fica tudo registado no histórico.
# ---------------------------------------------------------------------------
def _linhas_tempos(of: dict) -> list:
    out = []
    for it in of.get("itens") or []:
        for op in it.get("operacoes") or []:
            t_maq_est = float(op.get("tempo_maquina") or 0)
            t_mo_est = float(op.get("tempo_mao_obra") or 0)
            maq_est = op_machine_cost_est(op)
            taxa_maq = float(op.get("maquina_custo_hora") or 0) or ((maq_est / (t_maq_est / 60.0)) if t_maq_est > 0 else 0.0)
            out.append({
                "item_id": it.get("id"),
                "artigo_nome": it.get("artigo_nome") or "",
                "quantidade": it.get("quantidade") or 0,
                "unidade": it.get("unidade") or "un",
                "operacao_id": op.get("id"),
                "operacao": op.get("nome") or "",
                "maquina_nome": op.get("maquina_nome") or "",
                "mao_obra_nome": op.get("mao_obra_nome") or "",
                "concluida": bool(op.get("concluida")),
                "em_curso": bool(op.get("timer_inicio")),
                "tempo_maquina_est": round2(t_maq_est),
                "tempo_mao_obra_est": round2(t_mo_est),
                "tempo_maquina_real": None if op.get("tempo_maquina_real") is None else round2(op["tempo_maquina_real"]),
                "tempo_mao_obra_real": round2((op.get("tempo_real_seg") or 0) / 60.0),
                "taxa_maquina_hora": round2(taxa_maq),
                "taxa_mao_obra_hora": round2(op_labor_rate(op)),
                "custo_estimado": round2(op.get("custo_estimado") or 0),
                "custo_maquina_est": round2(maq_est),
                "custo_maquina_real": op_machine_cost_real(op),
                "custo_real": op_custo_real(op),
            })
    return out


def _resumo_tempos(of: dict) -> dict:
    linhas = _linhas_tempos(of)
    return {
        "of": {
            "id": of.get("id"), "numero": of.get("numero"), "cliente": of.get("cliente"),
            "status": of.get("status"), "encomenda_id": of.get("encomenda_id"),
            "encomenda_numero": of.get("encomenda_numero") or of.get("numero_encomenda"),
        },
        "linhas": linhas,
        "totais": {
            "tempo_estimado": round2(sum(l["tempo_maquina_est"] + l["tempo_mao_obra_est"] for l in linhas)),
            "tempo_real": round2(sum((l["tempo_maquina_real"] if l["tempo_maquina_real"] is not None else l["tempo_maquina_est"])
                                     + l["tempo_mao_obra_real"] for l in linhas)),
            "custo_estimado": round2(sum(l["custo_estimado"] for l in linhas)),
            "custo_real": round2(sum(l["custo_real"] for l in linhas)),
        },
        "acertos": list(reversed(of.get("acertos_tempos") or []))[:50],
    }


@router.get("/ordens-fabrico/{ofid}/tempos")
async def get_tempos_of(ofid: str, _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    return _resumo_tempos(recompute_of_status(of))


class AcertoOperacao(BaseModel):
    item_id: str
    operacao_id: str
    tempo_mao_obra_real: Optional[float] = None   # minutos
    tempo_maquina_real: Optional[float] = None     # minutos (vazio = usar estimado)
    limpar_maquina: bool = False


class AcertoTemposBody(BaseModel):
    motivo: str = ""
    operacoes: list[AcertoOperacao]


@router.put("/ordens-fabrico/{ofid}/tempos")
async def acertar_tempos_of(ofid: str, body: AcertoTemposBody, user: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    motivo = (body.motivo or "").strip()
    if not motivo:
        raise HTTPException(400, "Indique o motivo do acerto (fica no histórico)")
    custo_antes = round2(sum(op_custo_real(op) for it in of.get("itens") or [] for op in it.get("operacoes") or []))
    registos = []
    for a in body.operacoes:
        op = _find_op(of, a.item_id, a.operacao_id)
        if not op:
            raise HTTPException(404, "Operação não encontrada")
        nome = op.get("nome") or "operação"
        if op.get("timer_inicio"):
            raise HTTPException(400, f"Pare o cronómetro de «{nome}» antes de acertar o tempo")
        if a.tempo_mao_obra_real is not None:
            if a.tempo_mao_obra_real < 0:
                raise HTTPException(400, f"«{nome}»: o tempo não pode ser negativo")
            antes = round2((op.get("tempo_real_seg") or 0) / 60.0)
            depois = round2(a.tempo_mao_obra_real)
            if abs(antes - depois) > 0.004:
                op["tempo_real_seg"] = round(depois * 60.0, 1)
                registos.append({"operacao": nome, "campo": "Mão de obra (min)", "de": antes, "para": depois})
        if a.limpar_maquina or a.tempo_maquina_real is not None:
            if a.tempo_maquina_real is not None and a.tempo_maquina_real < 0:
                raise HTTPException(400, f"«{nome}»: o tempo não pode ser negativo")
            antes = op.get("tempo_maquina_real")
            depois = None if a.limpar_maquina else round2(a.tempo_maquina_real)
            if antes != depois:
                op["tempo_maquina_real"] = depois
                registos.append({"operacao": nome, "campo": "Máquina (min)",
                                 "de": "estimado" if antes is None else antes,
                                 "para": "estimado" if depois is None else depois})
    if not registos:
        return _resumo_tempos(recompute_of_status(of))
    custo_depois = round2(sum(op_custo_real(op) for it in of.get("itens") or [] for op in it.get("operacoes") or []))
    acerto = {
        "at": now_iso(),
        "por": (user or {}).get("nome") or (user or {}).get("email") or "",
        "motivo": motivo,
        "alteracoes": registos,
        "custo_antes": custo_antes,
        "custo_depois": custo_depois,
    }
    of["acertos_tempos"] = (of.get("acertos_tempos") or []) + [acerto]
    status_antes = of.get("status")
    saved = await _save_of(ofid, {**of, "status": status_antes} if status_antes == "concluido" else of)
    await audit.registar(
        "ordem_fabrico", ofid, "editado", user,
        f"Tempos da OF {of.get('numero')} acertados ({len(registos)} alteração(ões)) · custo real "
        f"{custo_antes:.2f}€ → {custo_depois:.2f}€ · {motivo}",
        of.get("numero"),
        [{"campo": "tempos", "label": f"{r['operacao']} · {r['campo']}", "de": str(r["de"]), "para": str(r["para"])} for r in registos],
    )
    return _resumo_tempos(saved)
