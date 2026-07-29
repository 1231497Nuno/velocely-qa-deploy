from collections import defaultdict
import re

from fastapi import APIRouter, Depends

from app.core.database import round2
from app.core.security import get_current_user, require_perm
from app.domain.models import STATUS_PT, PAY_PT, ENC_ESTADO_PT
from app.repositories import (
    ordens_repo, orcamentos_repo, artigos_repo, encomendas_repo,
    maquinas_repo, tipos_repo, consumiveis_repo, clientes_repo,
    documentos_financeiros_repo,
)
from app.services.costing import (
    recompute_of_status, op_custo_real, compute_orcamento_totais,
    artigo_custo_total, artigo_breakdown, compute_encomenda, _prazo_meta,
)

router = APIRouter()


@router.get("/producao/tempos")
async def producao_tempos(_u: dict = Depends(require_perm("analise_producao", "view"))):
    ofs = await ordens_repo.find(sort=("created_at", -1))
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
    return result


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
    for e in encs:
        prazo = e.get("prazo_entrega")
        if not prazo:
            continue
        ec = await compute_encomenda(e)
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        dias, est = _prazo_meta(prazo)
        items.append({
            "tipo": "encomenda", "id": e["id"], "numero": e.get("numero"),
            "cliente": e.get("cliente"), "prazo_entrega": prazo[:10],
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
async def rentabilidade_clientes(_u: dict = Depends(require_perm("rentabilidade", "view"))):
    encs = await encomendas_repo.find(limit=5000)
    grupos = {}
    for e in encs:
        ec = await compute_encomenda(e)
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
    return out


@router.get("/alertas")
async def alertas(_u: dict = Depends(require_perm("dashboard", "view"))):
    encs = await encomendas_repo.find(limit=5000)
    enc_map = {e["id"]: e for e in encs}
    pagamentos_pendentes = prazos_atrasados = prazos_proximos = encomendas_sem_of = 0
    for e in encs:
        ec = await compute_encomenda(e)
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        if (ec.get("valor_pendente") or 0) > 0:
            pagamentos_pendentes += 1
        if ec.get("tem_artigos_sem_of"):
            encomendas_sem_of += 1
        prazo = e.get("prazo_entrega")
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
    for e in encs:
        ec = await compute_encomenda(e)
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        eid = e["id"]
        num = e.get("numero")
        cli = e.get("cliente") or ""
        if not e.get("autorizada_producao"):
            items.append({"id": f"aut-{eid}", "tipo": "autorizar", "severidade": "info",
                          "titulo": f"Encomenda {num} por autorizar", "descricao": cli, "url": f"/encomendas/{eid}"})
        if (ec.get("valor_pendente") or 0) > 0:
            items.append({"id": f"pag-{eid}", "tipo": "pagamento", "severidade": "aviso",
                          "titulo": f"Pagamento pendente · {num}", "descricao": f"{cli} — falta {round2(ec['valor_pendente'])}€", "url": f"/encomendas/{eid}"})
        prazo = e.get("prazo_entrega")
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
    if len(ql) < 2:
        return {"resultados": []}
    rx = {"$regex": re.escape(ql), "$options": "i"}
    resultados = []
    for c in await clientes_repo.find({"$or": [{"nome": rx}, {"nif": rx}, {"cidade": rx}]}, limit=6):
        resultados.append({"tipo": "Cliente", "id": c["id"], "titulo": c.get("nome") or "—",
                           "subtitulo": c.get("cidade") or c.get("nif") or "", "url": f"/clientes/{c['id']}"})
    for o in await orcamentos_repo.find({"$or": [{"numero": rx}, {"cliente": rx}, {"descricao": rx}]}, limit=6):
        resultados.append({"tipo": "Orçamento", "id": o["id"], "titulo": o.get("numero") or "—",
                           "subtitulo": o.get("cliente") or "", "url": f"/orcamentos/{o['id']}"})
    for e in await encomendas_repo.find({"$or": [{"numero": rx}, {"cliente": rx}, {"descricao": rx}]}, limit=6):
        resultados.append({"tipo": "Encomenda", "id": e["id"], "titulo": e.get("numero") or "—",
                           "subtitulo": e.get("cliente") or "", "url": f"/encomendas/{e['id']}"})
    for o in await ordens_repo.find({"$or": [{"numero": rx}, {"cliente": rx}]}, limit=6):
        resultados.append({"tipo": "Ordem de Fabrico", "id": o["id"], "titulo": o.get("numero") or "—",
                           "subtitulo": o.get("cliente") or "", "url": f"/ordens-fabrico/{o['id']}"})
    for a in await artigos_repo.find({"$or": [{"nome": rx}, {"descricao": rx}]}, limit=6):
        resultados.append({"tipo": "Artigo", "id": a["id"], "titulo": a.get("nome") or "—",
                           "subtitulo": a.get("descricao") or "", "url": "/artigos"})
    for d in await documentos_financeiros_repo.find(
        {"$or": [{"numero": rx}, {"cliente": rx}, {"encomenda_numero": rx}]}, limit=6,
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


def _valor_mensal(orcs_t: list) -> list:
    mensal = defaultdict(float)
    for o in orcs_t:
        mes = (o.get("created_at") or "")[:7]
        if mes:
            mensal[mes] += o.get("total") or 0
    return [{"mes": k, "valor": round2(v)} for k, v in sorted(mensal.items())][-6:]


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
    top = sorted(encs_c, key=lambda e: e["valor_total"], reverse=True)[:8]
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
    artigos = await artigos_repo.find(limit=1000)
    custos = [await artigo_custo_total(a) for a in artigos]
    orcs_t = [compute_orcamento_totais(o) for o in await orcamentos_repo.find(limit=1000)]
    ofs_t = [recompute_of_status(o) for o in await ordens_repo.find(limit=1000)]
    encs_c = [await compute_encomenda(e) for e in await encomendas_repo.find(limit=2000)]

    arts_bd = []
    for a in artigos:
        bd = await artigo_breakdown(a)
        arts_bd.append({"nome": a.get("nome"), "custo": bd["custo_producao_total"], "preco": bd["preco_venda"]})
    arts_bd.sort(key=lambda x: x["preco"], reverse=True)

    valor_encomendas = round2(sum(e["valor_total"] for e in encs_c))
    custo_real_encomendas = round2(sum(e["custo_producao_real"] for e in encs_c))
    prazos_atrasadas, prazos_proximos_7 = _prazos_counts(encs_c)

    return {
        "total_artigos": len(artigos),
        "total_maquinas": await maquinas_repo.count(),
        "total_tipos": await tipos_repo.count(),
        "total_materiais": await consumiveis_repo.count(),
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
