from io import BytesIO
import re
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
    settings, fields, show_branding = await load_pdf_config(template_id, "of")
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


# ---------------------------------------------------------------------------
# Fecho da OF (produzido/refugo, consumos, custo fechado) e carga das máquinas
# ---------------------------------------------------------------------------
@router.get("/ordens-fabrico/{ofid}/fecho")
async def previsao_fecho_of(ofid: str, _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    from app.services import producao
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    return {**producao.previsao_fecho(of), "qualidade": await producao.config_qualidade()}


@router.get("/producao/qualidade")
async def get_qualidade(_u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    from app.services import producao
    return await producao.config_qualidade()


@router.put("/producao/qualidade")
async def put_qualidade(dados: dict, _u: dict = Depends(require_perm("definicoes", "edit"))):
    from app.repositories import empresa_repo
    from app.services import producao
    itens = [str(x).strip() for x in dados.get("itens") or [] if str(x).strip()][:30]
    await empresa_repo.update_where({"id": "empresa"}, {"qualidade_of": {"itens": itens, "obrigatorio": bool(dados.get("obrigatorio")),
                                                                         "foto_obrigatoria": bool(dados.get("foto_obrigatoria"))}}, upsert=True)
    return await producao.config_qualidade()


@router.post("/ordens-fabrico/{ofid}/fechar")
async def fechar_of(ofid: str, dados: dict, user: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    from app.services import producao
    return await producao.fechar_of(ofid, dados, user)


@router.post("/ordens-fabrico/{ofid}/fecho/anular")
async def anular_fecho_of(ofid: str, user: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    from app.services import producao
    return await producao.anular_fecho(ofid, user)


@router.get("/producao/carga")
async def carga_maquinas(semanas: int = Query(6, ge=1, le=26), _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    from app.services import producao
    return await producao.carga(semanas)


# ---------------------------------------------------------------------------
# Planeamento por máquina e oficina
# ---------------------------------------------------------------------------
@router.get("/producao/planeamento")
async def planeamento(inicio: str = Query(""), dias: int = Query(6, ge=1, le=14), _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    from datetime import date as _date, timedelta as _td
    from app.repositories import maquinas_repo
    try:
        d0 = _date.fromisoformat(inicio[:10]) if inicio else _date.today() - _td(days=_date.today().weekday())
    except ValueError:
        raise HTTPException(400, "Data inválida")
    datas = [(d0 + _td(days=i)).isoformat() for i in range(dias)]
    maqs = await maquinas_repo.find({}, sort=("nome", 1), limit=500)
    ofs = await _enrich_ofs(await ordens_repo.find({"status": {"$nin": ["concluido", "cancelado"]}}, limit=3000))
    ops = []
    for of in ofs:
        for it in of.get("itens") or []:
            for op in it.get("operacoes") or []:
                if op.get("concluida"):
                    continue
                ops.append({"of_id": of["id"], "of_numero": of.get("numero"), "cliente": of.get("cliente"),
                            "prazo": of.get("prazo_entrega"), "prioritaria": bool(of.get("prioritaria")),
                            "item_id": it.get("id"), "artigo_nome": it.get("artigo_nome"), "quantidade": it.get("quantidade"),
                            "operacao_id": op.get("id"), "nome": op.get("nome"), "maquina_id": op.get("maquina_id"),
                            "horas": round2(float(op.get("tempo_maquina") or op.get("tempo_mao_obra") or 0) / 60),
                            "data": op.get("planeado_data"), "em_curso": bool(op.get("timer_inicio"))})
    return {"datas": datas, "maquinas": [{"id": m["id"], "nome": m.get("nome"), "horas_dia": round2(float(m.get("horas_semana") or 40) / 5)}
                                         for m in maqs], "operacoes": ops}


class PlanearBody(BaseModel):
    item_id: str
    operacao_id: str
    data: Optional[str] = None


@router.post("/ordens-fabrico/{ofid}/operacao/planear")
async def planear_operacao(ofid: str, body: PlanearBody, _u: dict = Depends(require_perm("ordens_fabrico", "edit"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    op = _find_op(of, body.item_id, body.operacao_id)
    if not op:
        raise HTTPException(404, "Operação não encontrada")
    op["planeado_data"] = (body.data or "")[:10] or None
    await ordens_repo.update(ofid, {"itens": of["itens"]})
    return {"ok": True}


@router.get("/oficina/of/{ref}")
async def oficina_of(ref: str, _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    """OF pelo id (QR) ou pelo número escrito."""
    ref = ref.strip()
    if ref.upper().startswith("VELOCELY-OF:"):
        ref = ref.split(":", 1)[1]
    of = await ordens_repo.get(ref) or await ordens_repo.find_one({"numero": ref}) or \
        await ordens_repo.find_one({"numero": {"$regex": f"{re.escape(ref)}$", "$options": "i"}})
    if not of:
        raise HTTPException(404, "OF não encontrada")
    of = recompute_of_status(of)
    if of.get("encomenda_id"):
        e = await encomendas_repo.get(of["encomenda_id"]) or {}
        of["prazo_entrega"] = e.get("prazo_entrega")
        of["encomenda_numero"] = e.get("numero") or of.get("encomenda_numero")
    return of


def _ficheiro(path: str, nome: str = "", content_type: str = "") -> dict:
    from app.services import ficheiros as fic
    return {"path": path, "nome": nome or path.rsplit("/", 1)[-1], "kind": "imagem" if fic.is_image(path, content_type, nome) else "ficheiro"}


@router.post("/producao/prazo-sugerido", summary="Data de entrega possível pela carga real das máquinas")
async def prazo_sugerido(dados: dict, _u: dict = Depends(require_perm("orcamentos", "view"))):
    from app.services import producao
    linhas = dados.get("linhas") or []
    if dados.get("encomenda_id"):
        e = await encomendas_repo.get(dados["encomenda_id"]) or {}
        linhas = [{"artigo_id": a.get("artigo_id"), "quantidade": a.get("quantidade"), "roteiro": a.get("roteiro_orcamento")}
                  for a in e.get("artigos") or []]
    return await producao.prazo_sugerido(linhas, int(dados.get("margem_dias", 2) or 0), int(dados.get("dias_compra", 5) or 0))


@router.get("/oficina/of/{ofid}/documentos")
async def oficina_documentos(ofid: str, _u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    """Tudo o que o operador precisa de ver: ficheiros da OF, artes/maquetas das linhas, anexos da encomenda
    e fotos/ficheiros técnicos dos artigos."""
    from app.services import ficheiros as fic
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    grupos, vistos = [], set()

    def juntar(titulo: str, itens: list):
        out = []
        for i in itens:
            if i.get("path") and i["path"] not in vistos:
                vistos.add(i["path"])
                out.append(i)
        if out:
            grupos.append({"titulo": titulo, "itens": out})

    artes = [_ficheiro(it["arte_path"], it.get("arte_nome") or f"Arte — {it.get('artigo_nome') or ''}", it.get("arte_content_type") or "")
             for it in of.get("itens") or [] if it.get("arte_path")]
    juntar("Artes / maquetas", artes)
    juntar("Desta OF", [_ficheiro(i["path"], i.get("nome") or "", i.get("content_type") or "")
                        for i in fic.itens_do_registo(of, can_delete=False, include_capa=False)])
    if of.get("encomenda_id"):
        e = await encomendas_repo.get(of["encomenda_id"])
        if e:
            itens = [_ficheiro(l["arte_path"], l.get("arte_nome") or f"Arte — {l.get('artigo_nome') or ''}", l.get("arte_content_type") or "")
                     for l in e.get("artigos") or [] if l.get("arte_path")]
            itens += [_ficheiro(i["path"], i.get("nome") or "", i.get("content_type") or "")
                      for i in fic.itens_do_registo(e, can_delete=False, include_capa=False)]
            juntar(f"Da encomenda {e.get('numero') or ''}".strip(), itens)
    for it in of.get("itens") or []:
        a = await artigos_repo.get(it.get("artigo_id") or "") if it.get("artigo_id") else None
        if a:
            juntar(f"Artigo · {a.get('nome') or it.get('artigo_nome') or ''}",
                   [_ficheiro(i["path"], i.get("nome") or "", i.get("content_type") or "")
                    for i in fic.itens_do_registo(a, can_delete=False, include_capa=True)])
    return {"grupos": grupos}


class NotaOficinaBody(BaseModel):
    texto: str
    item_id: Optional[str] = None
    operacao_id: Optional[str] = None


@router.post("/oficina/of/{ofid}/notas")
async def oficina_nota(ofid: str, body: NotaOficinaBody, user: dict = Depends(require_perm("ordens_fabrico", "view"))):
    """Nota do operador na OF (opcionalmente ligada a um artigo/operação). Fica no histórico da OF."""
    from app.core.database import new_id
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(400, "Escreva a nota")
    ref = ""
    for it in of.get("itens") or []:
        if it.get("id") == body.item_id:
            ref = it.get("artigo_nome") or ""
            for op in it.get("operacoes") or []:
                if op.get("id") == body.operacao_id:
                    ref = f"{ref} · {op.get('nome') or ''}".strip(" ·")
    nota = {"id": new_id(), "texto": texto[:2000], "item_id": body.item_id, "operacao_id": body.operacao_id, "referencia": ref,
            "por_id": user.get("id"), "por": user.get("name") or user.get("email") or "", "data": now_iso()}
    notas = list(of.get("notas_oficina") or []) + [nota]
    await ordens_repo.update(ofid, {"notas_oficina": notas})
    await audit.registar("ordem_fabrico", ofid, "editado", user, f"Nota da oficina na OF {of.get('numero')}: {texto[:120]}", of.get("numero"))
    return notas


@router.delete("/oficina/of/{ofid}/notas/{nid}")
async def oficina_nota_apagar(ofid: str, nid: str, user: dict = Depends(require_perm("ordens_fabrico", "view"))):
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    notas = list(of.get("notas_oficina") or [])
    n = next((x for x in notas if x.get("id") == nid), None)
    if not n:
        raise HTTPException(404, "Nota não encontrada")
    admin = bool((user.get("perfil") or {}).get("admin")) or user.get("role") == "admin"
    if n.get("por_id") != user.get("id") and not admin:
        raise HTTPException(403, "Só quem escreveu a nota a pode apagar")
    notas = [x for x in notas if x.get("id") != nid]
    await ordens_repo.update(ofid, {"notas_oficina": notas})
    return notas


# ---------------------------------------------------------------------------
# Manutenção das máquinas
# ---------------------------------------------------------------------------
@router.get("/manutencao")
async def manutencao_listar(_u: dict = Depends(require_perm("maquinas", "view"))):
    from app.services import manutencao
    return await manutencao.listar()


@router.post("/manutencao/planos")
async def manutencao_criar(dados: dict, _u: dict = Depends(require_perm("maquinas", "edit"))):
    from app.services import manutencao
    return await manutencao.guardar(dados)


@router.put("/manutencao/planos/{pid}")
async def manutencao_editar(pid: str, dados: dict, _u: dict = Depends(require_perm("maquinas", "edit"))):
    from app.services import manutencao
    return await manutencao.guardar(dados, pid)


@router.delete("/manutencao/planos/{pid}")
async def manutencao_apagar(pid: str, _u: dict = Depends(require_perm("maquinas", "edit"))):
    from app.repositories import manutencoes_repo
    await manutencoes_repo.delete({"id": pid})
    return {"ok": True}


@router.post("/manutencao/planos/{pid}/feita")
async def manutencao_feita(pid: str, dados: dict, user: dict = Depends(require_perm("maquinas", "edit"))):
    from app.services import manutencao
    return await manutencao.registar(pid, dados, user)
