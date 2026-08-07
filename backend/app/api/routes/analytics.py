from collections import defaultdict
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.database import round2
from app.core.security import get_current_user, require_perm
from app.core.pagination import filter_by_q, paginate_or_all
from app.domain.models import STATUS_PT, PAY_PT, ENC_ESTADO_PT
from app.repositories import (
    ordens_repo, orcamentos_repo, artigos_repo, encomendas_repo,
    maquinas_repo, tipos_repo, consumiveis_repo, clientes_repo,
    documentos_financeiros_repo, ordens_compra_repo,
)
from app.services.costing import (
    recompute_of_status, op_custo_real, compute_orcamento_totais,
    artigo_breakdown, artigo_breakdown_with_caches, compute_encomenda,
    compute_encomendas_many, _prazo_meta,
)

router = APIRouter()


@router.get("/producao/tempos")
async def producao_tempos(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("analise_producao", "view")),
):
    ofs = await ordens_repo.find(sort=("created_at", -1), limit=5000)
    result = []
    for o in ofs:
        o = recompute_of_status(o)
        est_maq = est_mo = est_tot = real_seg = 0.0
        custo_est_total = custo_real_total = 0.0
        ops = []
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                tmaq = op.get("tempo_maquina") or 0
                tmo = op.get("tempo_mao_obra") or 0
                ttot = op.get("tempo_min") or (tmaq + tmo)
                rseg = op.get("tempo_real_seg") or 0
                rmin = rseg / 60.0
                est_c = op.get("custo_estimado") or 0
                real_c = op_custo_real(op)
                est_maq += tmaq
                est_mo += tmo
                est_tot += ttot
                real_seg += rseg
                custo_est_total += est_c
                custo_real_total += real_c
                ops.append({
                    "artigo": it.get("artigo_nome"),
                    "nome": op.get("nome"),
                    "maquina_nome": op.get("maquina_nome"),
                    "mao_obra_nome": op.get("mao_obra_nome"),
                    "tempo_maquina": tmaq,
                    "tempo_mao_obra": tmo,
                    "tempo_estimado": round2(ttot),
                    "tempo_mao_obra_real_min": round2(rmin),
                    "tempo_real_min": round2(rmin),
                    "desvio_min": round2(rmin - tmo),
                    "custo_estimado": round2(est_c),
                    "custo_real": real_c,
                    "desvio_custo": round2(real_c - est_c),
                    "em_curso": bool(op.get("timer_inicio")),
                    "concluida": bool(op.get("concluida")),
                })
        mao_obra_real_min = round2(real_seg / 60.0)
        tempo_real_total = round2(est_maq + mao_obra_real_min)
        custo_est_total = round2(custo_est_total)
        custo_real_total = round2(custo_real_total)
        result.append({
            "id": o["id"],
            "numero": o.get("numero"),
            "cliente": o.get("cliente"),
            "status": o.get("status"),
            "progresso": o.get("progresso"),
            "tempo_estimado_maquina": round2(est_maq),
            "tempo_estimado_mao_obra": round2(est_mo),
            "tempo_estimado_total": round2(est_tot),
            "tempo_maquina_total": round2(est_maq),
            "tempo_mao_obra_real_min": mao_obra_real_min,
            "tempo_real_min": tempo_real_total,
            "desvio_min": round2(tempo_real_total - est_tot),
            "custo_estimado": custo_est_total,
            "custo_real": custo_real_total,
            "desvio_custo": round2(custo_real_total - custo_est_total),
            "operacoes": ops,
        })
    result = filter_by_q(result, q, ["numero", "cliente"])
    return paginate_or_all(result, page, page_size)


@router.get("/producao/analise")
async def producao_analise(_u: dict = Depends(require_perm("analise_producao", "view"))):
    ofs = await ordens_repo.find(limit=2000)
    by_month = defaultdict(lambda: {"criadas": 0, "concluidas": 0, "tempo_est": 0.0, "tempo_maq": 0.0, "tempo_mo_real": 0.0, "custo_est": 0.0, "custo_real": 0.0})
    for o in ofs:
        o = recompute_of_status(o)
        mes = (o.get("created_at") or "")[:7]
        if not mes:
            continue
        m = by_month[mes]
        m["criadas"] += 1
        if o.get("status") == "concluido":
            m["concluidas"] += 1
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                t = op.get("tempo_min") or 0
                tmaq = op.get("tempo_maquina") or 0
                rmin = (op.get("tempo_real_seg") or 0) / 60.0
                ec = op.get("custo_estimado") or 0
                m["tempo_est"] += t
                m["tempo_maq"] += tmaq
                m["tempo_mo_real"] += rmin
                m["custo_est"] += ec
                m["custo_real"] += op_custo_real(op)
    result = []
    for mes in sorted(by_month.keys()):
        m = by_month[mes]
        criadas = m["criadas"] or 1
        tempo_real = m["tempo_maq"] + m["tempo_mo_real"]
        result.append({
            "mes": mes,
            "ofs_criadas": m["criadas"],
            "ofs_concluidas": m["concluidas"],
            "taxa_conclusao": round2(m["concluidas"] / criadas * 100),
            "tempo_estimado": round2(m["tempo_est"]),
            "tempo_real": round2(tempo_real),
            "desvio_tempo": round2(tempo_real - m["tempo_est"]),
            "custo_estimado": round2(m["custo_est"]),
            "custo_real": round2(m["custo_real"]),
            "desvio_custo": round2(m["custo_real"] - m["custo_est"]),
            "custo_estimado_medio": round2(m["custo_est"] / criadas),
            "custo_real_medio": round2(m["custo_real"] / criadas),
        })
    return result


@router.get("/prazos")
async def prazos(_u: dict = Depends(require_perm("calendario", "view"))):
    items = []
    encs = await encomendas_repo.find(limit=2000)
    enc_map = {e["id"]: e for e in encs}
    for ec in await compute_encomendas_many(encs):
        prazo = ec.get("prazo_entrega")
        if not prazo:
            continue
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        dias, est = _prazo_meta(prazo)
        items.append({
            "tipo": "encomenda", "id": ec["id"], "numero": ec.get("numero"),
            "cliente": ec.get("cliente"), "prazo_entrega": prazo[:10],
            "estado": ENC_ESTADO_PT.get(ec["estado"], ec["estado"]),
            "dias_restantes": dias, "estado_prazo": est, "prioritaria": False,
        })
    ofs = await ordens_repo.find(limit=2000)
    for o in ofs:
        oc = recompute_of_status(o)
        if oc.get("status") == "concluido":
            continue
        e = enc_map.get(o.get("encomenda_id")) or {}
        prazo = e.get("prazo_entrega")
        if not prazo:
            continue
        dias, est = _prazo_meta(prazo)
        items.append({
            "tipo": "of", "id": o["id"], "numero": o.get("numero"),
            "cliente": o.get("cliente"), "prazo_entrega": prazo[:10],
            "estado": STATUS_PT.get(oc.get("status"), oc.get("status")),
            "dias_restantes": dias, "estado_prazo": est,
            "prioritaria": bool(o.get("prioritaria")),
        })
    items.sort(key=lambda x: (x["prazo_entrega"], 0 if x["tipo"] == "encomenda" else 1))
    return items


@router.get("/relatorios/rentabilidade-clientes")
async def rentabilidade_clientes(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("rentabilidade", "view")),
):
    encs = await encomendas_repo.find(limit=5000)
    grupos = {}
    for ec in await compute_encomendas_many(encs):
        if ec.get("estado") == "cancelada":
            continue
        key = ec.get("cliente_id") or ec.get("cliente") or "—"
        g = grupos.get(key)
        if not g:
            g = {
                "cliente": ec.get("cliente") or "—",
                "cliente_id": ec.get("cliente_id"),
                "num_encomendas": 0, "num_ofs": 0,
                "valor_faturado": 0.0, "valor_pago": 0.0, "valor_pendente": 0.0,
                "custo_estimado": 0.0, "custo_real": 0.0,
            }
            grupos[key] = g
        g["num_encomendas"] += 1
        g["num_ofs"] += ec.get("num_ofs") or 0
        g["valor_faturado"] += ec.get("valor_total") or 0
        g["valor_pago"] += ec.get("valor_pago") or 0
        g["valor_pendente"] += ec.get("valor_pendente") or 0
        g["custo_estimado"] += ec.get("custo_producao_estimado") or 0
        g["custo_real"] += ec.get("custo_producao_real") or 0
    out = []
    for g in grupos.values():
        faturado = round2(g["valor_faturado"])
        custo_real = round2(g["custo_real"])
        margem = round2(faturado - custo_real)
        out.append({
            **g,
            "valor_faturado": faturado,
            "valor_pago": round2(g["valor_pago"]),
            "valor_pendente": round2(g["valor_pendente"]),
            "custo_estimado": round2(g["custo_estimado"]),
            "custo_real": custo_real,
            "margem": margem,
            "margem_pct": round2(margem / faturado * 100) if faturado > 0 else 0.0,
        })
    out.sort(key=lambda x: x["valor_faturado"], reverse=True)
    out = filter_by_q(out, q, ["cliente"])
    tot_f = round2(sum(r["valor_faturado"] for r in out))
    tot_c = round2(sum(r["custo_real"] for r in out))
    tot_p = round2(sum(r["valor_pendente"] for r in out))
    tot_m = round2(tot_f - tot_c)
    extra = {
        "summary": {
            "num_clientes": len(out),
            "faturado": tot_f,
            "custo": tot_c,
            "pendente": tot_p,
            "margem": tot_m,
            "margem_pct": round2(tot_m / tot_f * 100) if tot_f > 0 else 0.0,
        },
        "chart": [
            {
                "label": ((r.get("cliente") or "—")[:13] + "…") if len(r.get("cliente") or "") > 14 else (r.get("cliente") or "—"),
                "faturado": r["valor_faturado"],
                "custo_real": r["custo_real"],
            }
            for r in out[:8]
        ],
    }
    return paginate_or_all(out, page, page_size, extra=extra if page is not None else None)


@router.get("/alertas")
async def alertas(_u: dict = Depends(require_perm("dashboard", "view"))):
    encs = await encomendas_repo.find(limit=5000)
    enc_map = {e["id"]: e for e in encs}
    pagamentos_pendentes = prazos_atrasados = prazos_proximos = encomendas_sem_of = 0
    for ec in await compute_encomendas_many(encs):
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        if (ec.get("valor_pendente") or 0) > 0:
            pagamentos_pendentes += 1
        if ec.get("tem_artigos_sem_of"):
            encomendas_sem_of += 1
        prazo = ec.get("prazo_entrega")
        if prazo:
            _d, est = _prazo_meta(prazo)
            if est == "atrasada":
                prazos_atrasados += 1
            elif est == "proxima":
                prazos_proximos += 1
    ofs_atrasadas = 0
    for o in await ordens_repo.find(limit=5000):
        oc = recompute_of_status(o)
        if oc.get("status") == "concluido":
            continue
        prazo = (enc_map.get(o.get("encomenda_id")) or {}).get("prazo_entrega")
        if prazo:
            _d, est = _prazo_meta(prazo)
            if est == "atrasada":
                ofs_atrasadas += 1
    return {
        "pagamentos_pendentes": pagamentos_pendentes,
        "prazos_atrasados": prazos_atrasados,
        "prazos_proximos": prazos_proximos,
        "ofs_atrasadas": ofs_atrasadas,
        "encomendas_sem_of": encomendas_sem_of,
    }


@router.get("/notificacoes")
async def notificacoes(_u: dict = Depends(require_perm("dashboard", "view"))):
    """Lista de notificações acionáveis (derivadas, não persistidas)."""
    items = []
    encs = await encomendas_repo.find(limit=5000)
    enc_map = {e["id"]: e for e in encs}
    for ec in await compute_encomendas_many(encs):
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        eid = ec["id"]
        num = ec.get("numero")
        cli = ec.get("cliente") or ""
        if not ec.get("autorizada_producao"):
            items.append({"id": f"aut-{eid}", "tipo": "autorizar", "severidade": "info",
                          "titulo": f"Encomenda {num} por autorizar", "descricao": cli, "url": f"/encomendas/{eid}"})
        if (ec.get("valor_pendente") or 0) > 0:
            items.append({"id": f"pag-{eid}", "tipo": "pagamento", "severidade": "aviso",
                          "titulo": f"Pagamento pendente · {num}", "descricao": f"{cli} — falta {round2(ec['valor_pendente'])}€", "url": f"/encomendas/{eid}"})
        prazo = ec.get("prazo_entrega")
        if prazo:
            _d, est = _prazo_meta(prazo)
            if est == "atrasada":
                items.append({"id": f"praz-{eid}", "tipo": "prazo", "severidade": "critico",
                              "titulo": f"Encomenda {num} atrasada", "descricao": f"{cli} — entrega {prazo}", "url": f"/encomendas/{eid}"})
            elif est == "proxima":
                items.append({"id": f"prazp-{eid}", "tipo": "prazo", "severidade": "aviso",
                              "titulo": f"Encomenda {num} entrega em breve", "descricao": f"{cli} — {prazo}", "url": f"/encomendas/{eid}"})
    for o in await ordens_repo.find(limit=5000):
        oc = recompute_of_status(o)
        if oc.get("status") == "concluido":
            continue
        prazo = (enc_map.get(o.get("encomenda_id")) or {}).get("prazo_entrega")
        if prazo:
            _d, est = _prazo_meta(prazo)
            if est == "atrasada":
                items.append({"id": f"of-{o['id']}", "tipo": "of", "severidade": "critico",
                              "titulo": f"OF {o.get('numero')} atrasada", "descricao": o.get("cliente") or "", "url": f"/ordens-fabrico/{o['id']}"})
    ordem = {"critico": 0, "aviso": 1, "info": 2}
    items.sort(key=lambda x: ordem.get(x["severidade"], 3))
    return {"total": len(items), "notificacoes": items[:40]}


@router.get("/search")
async def search(q: str = "", _u: dict = Depends(get_current_user)):
    ql = (q or "").strip()
    if not ql:
        return {"resultados": []}
    from app.core.pagination import text_search_cliente
    rx = {"$regex": re.escape(ql), "$options": "i"}
    nome_cli = {"$regex": rf"^{re.escape(ql)}", "$options": "i"}
    resultados = []
    cli_q = text_search_cliente(ql) or {}
    for c in await clientes_repo.find(cli_q, limit=6):
        resultados.append({"tipo": "Cliente", "id": c["id"], "titulo": c.get("nome") or "—",
                           "subtitulo": c.get("codigo") or c.get("cidade") or c.get("nif") or "", "url": f"/clientes/{c['id']}"})
    for o in await orcamentos_repo.find({"$or": [{"numero": rx}, {"cliente": nome_cli}, {"descricao": rx}]}, limit=6):
        resultados.append({"tipo": "Orçamento", "id": o["id"], "titulo": o.get("numero") or "—",
                           "subtitulo": o.get("cliente") or "", "url": f"/orcamentos/{o['id']}"})
    for e in await encomendas_repo.find({"$or": [{"numero": rx}, {"cliente": nome_cli}, {"descricao": rx}]}, limit=6):
        resultados.append({"tipo": "Encomenda", "id": e["id"], "titulo": e.get("numero") or "—",
                           "subtitulo": e.get("cliente") or "", "url": f"/encomendas/{e['id']}"})
    for o in await ordens_repo.find({"$or": [{"numero": rx}, {"cliente": nome_cli}]}, limit=6):
        resultados.append({"tipo": "Ordem de Fabrico", "id": o["id"], "titulo": o.get("numero") or "—",
                           "subtitulo": o.get("cliente") or "", "url": f"/ordens-fabrico/{o['id']}"})
    for a in await artigos_repo.find({"$or": [{"nome": nome_cli}, {"descricao": rx}]}, limit=6):
        resultados.append({"tipo": "Artigo", "id": a["id"], "titulo": a.get("nome") or "—",
                           "subtitulo": a.get("descricao") or "", "url": "/artigos"})
    for d in await documentos_financeiros_repo.find(
        {"$or": [{"numero": rx}, {"cliente": nome_cli}, {"encomenda_numero": rx}]}, limit=6,
    ):
        from app.domain.models import DOC_TIPO_PT
        resultados.append({
            "tipo": DOC_TIPO_PT.get(d.get("tipo"), "Documento"),
            "id": d["id"],
            "titulo": d.get("numero") or "—",
            "subtitulo": d.get("cliente") or "",
            "url": f"/financeiro/{d['id']}",
        })
    return {"resultados": resultados}


def _orcamentos_por_estado(orcs_t: list) -> list:
    return [
        {
            "estado": e,
            "label": STATUS_PT.get(e, e),
            "count": sum(1 for o in orcs_t if o.get("status") == e),
            "valor": round2(sum(o["total"] for o in orcs_t if o.get("status") == e)),
        }
        for e in ["rascunho", "enviado", "aceite", "rejeitado"]
    ]


def _ofs_por_estado(ofs_t: list) -> list:
    return [
        {
            "estado": e,
            "label": STATUS_PT.get(e, e),
            "count": sum(1 for o in ofs_t if o.get("status") == e),
        }
        for e in ["pendente", "em_producao", "concluido"]
    ]


_MES_LABEL = {
    "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun",
    "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
}


def _mes_key(doc: dict) -> str:
    return ((doc.get("data") or "")[:7] or (doc.get("created_at") or "")[:7])


def _fluxo_mensal(encs_c: list, ocs: list, meses: int = 12) -> dict:
    """Vendas vs compras/despesas e resultado — acumulados desde Janeiro do ano corrente."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    y, m_end = now.year, now.month
    keys = [f"{y:04d}-{m:02d}" for m in range(1, m_end + 1)]
    _ = meses
    start = f"{y:04d}-01"
    keyset = set(keys)

    vendas_mes = defaultdict(float)
    gastos_mes = defaultdict(float)

    for e in encs_c:
        if e.get("estado") == "cancelada":
            continue
        k = _mes_key(e)
        if not k or k < start or k not in keyset:
            continue
        vendas_mes[k] += float(e.get("valor_total") or e.get("total_com_iva") or 0)

    for o in ocs:
        if o.get("estado") == "cancelada":
            continue
        k = _mes_key(o)
        if not k or k < start or k not in keyset:
            continue
        gastos_mes[k] += float(o.get("total") or o.get("subtotal") or 0)

    serie = []
    acum_v = 0.0
    acum_g = 0.0
    for k in keys:
        mes_v = round2(float(vendas_mes.get(k, 0)))
        mes_g = round2(float(gastos_mes.get(k, 0)))
        acum_v = round2(acum_v + mes_v)
        acum_g = round2(acum_g + mes_g)
        serie.append({
            "mes": k,
            "label": _MES_LABEL.get(k[5:7], k[5:7]),
            "vendas": acum_v,
            "gastos": round2(-acum_g),
            "gastos_abs": acum_g,
            "resultado": round2(acum_v - acum_g),
            "vendas_mes": mes_v,
            "gastos_mes": mes_g,
        })

    last = serie[-1] if serie else {"vendas": 0, "gastos_abs": 0, "resultado": 0}
    return {
        "serie": serie,
        "modo": "acumulado",
        "ano": y,
        "inicio_contagem": start,
        "totais": {
            "vendas": last.get("vendas") or 0,
            "gastos": last.get("gastos_abs") or 0,
            "resultado": last.get("resultado") or 0,
        },
        "meses": len(keys),
    }


def _valor_mensal(orcs_t: list) -> list:
    """Orçamentos por mês — desde Janeiro do ano corrente."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    y, m_end = now.year, now.month
    keys = [f"{y:04d}-{m:02d}" for m in range(1, m_end + 1)]
    keyset = set(keys)
    mensal = defaultdict(float)
    for o in orcs_t:
        mes = (o.get("data") or o.get("created_at") or "")[:7]
        if mes in keyset:
            mensal[mes] += o.get("total") or 0
    return [
        {"mes": k, "label": _MES_LABEL.get(k[5:7], k[5:7]), "valor": round2(mensal.get(k, 0))}
        for k in keys
    ]


def _ytd_totais(encs_c: list, ocs: list) -> dict:
    """Totais do ano corrente (Jan → hoje) para KPIs/gráficos do dashboard."""
    from datetime import datetime, timezone
    y = datetime.now(timezone.utc).year
    start = f"{y:04d}-01"
    vendas = pago = pendente = custo_real = custo_est = 0.0
    n_enc = 0
    for e in encs_c:
        if e.get("estado") == "cancelada":
            continue
        k = _mes_key(e)
        if not k or k < start:
            continue
        n_enc += 1
        vendas += float(e.get("valor_total") or 0)
        pago += float(e.get("valor_pago") or 0)
        pendente += float(e.get("valor_pendente") or 0)
        custo_real += float(e.get("custo_producao_real") or 0)
        custo_est += float(e.get("custo_producao_estimado") or 0)
    gastos = 0.0
    for o in ocs:
        if o.get("estado") == "cancelada":
            continue
        k = _mes_key(o)
        if not k or k < start:
            continue
        gastos += float(o.get("total") or o.get("subtotal") or 0)
    vendas = round2(vendas)
    return {
        "ano": y,
        "encomendas": n_enc,
        "vendas": vendas,
        "gastos": round2(gastos),
        "resultado": round2(vendas - gastos),
        "valor_pago": round2(pago),
        "valor_pendente": round2(pendente),
        "custo_real": round2(custo_real),
        "custo_estimado": round2(custo_est),
        "margem": round2(vendas - custo_real),
    }


def _tempo_por_of(ofs_t: list) -> list:
    out = []
    for o in ofs_t:
        est = maq = labor_real = 0.0
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                est += op.get("tempo_min") or 0
                maq += op.get("tempo_maquina") or 0
                labor_real += (op.get("tempo_real_seg") or 0) / 60.0
        real = maq + labor_real
        if est > 0 or real > 0:
            out.append({"numero": o.get("numero"), "estimado": round2(est), "real": round2(real)})
    return out[-8:]


def _encomendas_por_pagamento(encs_c: list) -> list:
    return [
        {
            "estado": s,
            "label": PAY_PT[s],
            "count": sum(1 for e in encs_c if e["status_pagamento"] == s),
            "valor": round2(sum(e["valor_total"] for e in encs_c if e["status_pagamento"] == s)),
        }
        for s in ["pendente", "parcial", "pago"]
    ]


def _encomendas_por_estado(encs_c: list) -> list:
    return [
        {
            "estado": s,
            "label": ENC_ESTADO_PT[s],
            "count": sum(1 for e in encs_c if e["estado"] == s),
            "valor": round2(sum(e["valor_total"] for e in encs_c if e["estado"] == s)),
        }
        for s in ["aberta", "em_producao", "concluida", "cancelada"]
    ]


def _enc_valor_vs_custo(encs_c: list) -> list:
    from datetime import datetime, timezone
    y = datetime.now(timezone.utc).year
    start = f"{y:04d}-01"
    ytd = [
        e for e in encs_c
        if e.get("estado") != "cancelada" and (_mes_key(e) or "") >= start
    ]
    top = sorted(ytd, key=lambda e: e["valor_total"], reverse=True)[:8]
    return [
        {
            "numero": e.get("numero"),
            "valor": e["valor_total"],
            "custo_estimado": e["custo_producao_estimado"],
            "custo_real": e["custo_producao_real"],
            "margem": e["margem_producao"],
        }
        for e in top
    ]


def _prazos_counts(encs_c: list) -> tuple:
    atrasadas = proximos_7 = 0
    for e in encs_c:
        prazo = e.get("prazo_entrega")
        if not prazo or e["estado"] in ("concluida", "cancelada"):
            continue
        _dias, est = _prazo_meta(prazo)
        if est == "atrasada":
            atrasadas += 1
        elif est == "proxima":
            proximos_7 += 1
    return atrasadas, proximos_7


@router.get("/dashboard")
async def dashboard(_u: dict = Depends(require_perm("dashboard", "view"))):
    import asyncio
    artigos, orcs, ofs, encs, ocs, n_maq, n_tipos, n_mat = await asyncio.gather(
        artigos_repo.find(limit=1000),
        orcamentos_repo.find(limit=1000),
        ordens_repo.find(limit=1000),
        encomendas_repo.find(limit=2000),
        ordens_compra_repo.find(limit=5000),
        maquinas_repo.count(),
        tipos_repo.count(),
        consumiveis_repo.count(),
    )
    orcs_t = [compute_orcamento_totais(o) for o in orcs]
    ofs_t = [recompute_of_status(o) for o in ofs]
    encs_c = await compute_encomendas_many(encs)

    arts_bd = []
    custos = []
    for a in artigos:
        bd = artigo_breakdown_with_caches(a)
        custos.append(bd["custo_producao_total"])
        arts_bd.append({"nome": a.get("nome"), "custo": bd["custo_producao_total"], "preco": bd["preco_venda"]})
    arts_bd.sort(key=lambda x: x["preco"], reverse=True)

    valor_encomendas = round2(sum(e["valor_total"] for e in encs_c))
    custo_real_encomendas = round2(sum(e["custo_producao_real"] for e in encs_c))
    prazos_atrasadas, prazos_proximos_7 = _prazos_counts(encs_c)
    fluxo = _fluxo_mensal(encs_c, ocs, meses=12)
    ytd = _ytd_totais(encs_c, ocs)

    return {
        "total_artigos": len(artigos),
        "total_maquinas": n_maq,
        "total_tipos": n_tipos,
        "total_materiais": n_mat,
        "custo_medio": round2(sum(custos) / len(custos)) if custos else 0,
        "total_orcamentos": len(orcs_t),
        "valor_orcamentos": round2(sum(o["total"] for o in orcs_t)),
        "valor_aceites": round2(sum(o["total"] for o in orcs_t if o.get("status") == "aceite")),
        "orcamentos_aceites": sum(1 for o in orcs_t if o.get("status") == "aceite"),
        "total_ofs": len(ofs_t),
        "ofs_pendentes": sum(1 for o in ofs_t if o.get("status") == "pendente"),
        "ofs_em_producao": sum(1 for o in ofs_t if o.get("status") == "em_producao"),
        "ofs_concluidas": sum(1 for o in ofs_t if o.get("status") == "concluido"),
        "orcamentos_por_estado": _orcamentos_por_estado(orcs_t),
        "ofs_por_estado": _ofs_por_estado(ofs_t),
        "valor_mensal": _valor_mensal(orcs_t),
        "fluxo_mensal": fluxo,
        "ytd": ytd,
        "tempo_por_of": _tempo_por_of(ofs_t),
        "top_artigos": arts_bd[:6],
        "total_encomendas": len(encs_c),
        "valor_encomendas": valor_encomendas,
        "valor_pago_total": round2(sum((e.get("valor_pago") or 0) for e in encs_c)),
        "valor_pendente_total": round2(sum(e["valor_pendente"] for e in encs_c)),
        "custo_real_encomendas": custo_real_encomendas,
        "custo_estimado_encomendas": round2(sum(e["custo_producao_estimado"] for e in encs_c)),
        "margem_encomendas": round2(valor_encomendas - custo_real_encomendas),
        "encomendas_por_pagamento": _encomendas_por_pagamento(encs_c),
        "encomendas_por_estado": _encomendas_por_estado(encs_c),
        "enc_valor_vs_custo": _enc_valor_vs_custo(encs_c),
        "encomendas_por_autorizar": sum(
            1 for e in encs_c if e["estado"] not in ("concluida", "cancelada") and not e["pode_produzir"]
        ),
        "prazos_atrasadas": prazos_atrasadas,
        "prazos_proximos_7": prazos_proximos_7,
    }
