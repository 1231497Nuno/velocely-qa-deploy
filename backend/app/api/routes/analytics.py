from collections import defaultdict

from fastapi import APIRouter, Depends

from app.core.database import round2
from app.core.security import get_current_user
from app.domain.models import STATUS_PT, PAY_PT, ENC_ESTADO_PT
from app.repositories import (
    ordens_repo, orcamentos_repo, artigos_repo, encomendas_repo,
    maquinas_repo, tipos_repo, consumiveis_repo,
)
from app.services.costing import (
    recompute_of_status, op_custo_real, compute_orcamento_totais,
    artigo_custo_total, artigo_breakdown, compute_encomenda, _prazo_meta,
)

router = APIRouter()


@router.get("/producao/tempos")
async def producao_tempos():
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
async def producao_analise():
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
async def prazos(_u: dict = Depends(get_current_user)):
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
async def rentabilidade_clientes(_u: dict = Depends(get_current_user)):
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
async def alertas(_u: dict = Depends(get_current_user)):
    encs = await encomendas_repo.find(limit=5000)
    enc_map = {e["id"]: e for e in encs}
    pagamentos_pendentes = prazos_atrasados = prazos_proximos = 0
    for e in encs:
        ec = await compute_encomenda(e)
        if ec["estado"] in ("concluida", "cancelada"):
            continue
        if (ec.get("valor_pendente") or 0) > 0:
            pagamentos_pendentes += 1
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
    }


@router.get("/dashboard")
async def dashboard():
    artigos = await artigos_repo.find(limit=1000)
    custos = [await artigo_custo_total(a) for a in artigos]
    orcs = await orcamentos_repo.find(limit=1000)
    orcs_t = [compute_orcamento_totais(o) for o in orcs]
    ofs = await ordens_repo.find(limit=1000)
    ofs_t = [recompute_of_status(o) for o in ofs]

    orc_estados = ["rascunho", "enviado", "aceite", "rejeitado"]
    orcamentos_por_estado = [
        {
            "estado": e,
            "label": STATUS_PT.get(e, e),
            "count": sum(1 for o in orcs_t if o.get("status") == e),
            "valor": round2(sum(o["total"] for o in orcs_t if o.get("status") == e)),
        }
        for e in orc_estados
    ]
    of_estados = ["pendente", "em_producao", "concluido"]
    ofs_por_estado = [
        {
            "estado": e,
            "label": STATUS_PT.get(e, e),
            "count": sum(1 for o in ofs_t if o.get("status") == e),
        }
        for e in of_estados
    ]

    mensal = defaultdict(float)
    for o in orcs_t:
        mes = (o.get("created_at") or "")[:7]
        if mes:
            mensal[mes] += o.get("total") or 0
    valor_mensal = [{"mes": k, "valor": round2(v)} for k, v in sorted(mensal.items())][-6:]

    tempo_por_of = []
    for o in ofs_t:
        est = maq = labor_real = 0.0
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                est += op.get("tempo_min") or 0
                maq += op.get("tempo_maquina") or 0
                labor_real += (op.get("tempo_real_seg") or 0) / 60.0
        real = maq + labor_real
        if est > 0 or real > 0:
            tempo_por_of.append({"numero": o.get("numero"), "estimado": round2(est), "real": round2(real)})
    tempo_por_of = tempo_por_of[-8:]

    arts_bd = []
    for a in artigos:
        bd = await artigo_breakdown(a)
        arts_bd.append({"nome": a.get("nome"), "custo": bd["custo_producao_total"], "preco": bd["preco_venda"]})
    arts_bd.sort(key=lambda x: x["preco"], reverse=True)
    top_artigos = arts_bd[:6]

    encs = await encomendas_repo.find(limit=2000)
    encs_c = [await compute_encomenda(e) for e in encs]
    valor_encomendas = round2(sum(e["valor_total"] for e in encs_c))
    valor_pago_total = round2(sum((e.get("valor_pago") or 0) for e in encs_c))
    valor_pendente_total = round2(sum(e["valor_pendente"] for e in encs_c))
    custo_real_encomendas = round2(sum(e["custo_producao_real"] for e in encs_c))
    custo_estimado_encomendas = round2(sum(e["custo_producao_estimado"] for e in encs_c))

    pay_states = ["pendente", "parcial", "pago"]
    encomendas_por_pagamento = [
        {
            "estado": s,
            "label": PAY_PT[s],
            "count": sum(1 for e in encs_c if e["status_pagamento"] == s),
            "valor": round2(sum(e["valor_total"] for e in encs_c if e["status_pagamento"] == s)),
        }
        for s in pay_states
    ]
    enc_estados = ["aberta", "em_producao", "concluida", "cancelada"]
    encomendas_por_estado = [
        {
            "estado": s,
            "label": ENC_ESTADO_PT[s],
            "count": sum(1 for e in encs_c if e["estado"] == s),
            "valor": round2(sum(e["valor_total"] for e in encs_c if e["estado"] == s)),
        }
        for s in enc_estados
    ]
    enc_valor_vs_custo = sorted(encs_c, key=lambda e: e["valor_total"], reverse=True)[:8]
    enc_valor_vs_custo = [
        {
            "numero": e.get("numero"),
            "valor": e["valor_total"],
            "custo_estimado": e["custo_producao_estimado"],
            "custo_real": e["custo_producao_real"],
            "margem": e["margem_producao"],
        }
        for e in enc_valor_vs_custo
    ]
    encomendas_por_autorizar = sum(
        1 for e in encs_c if e["estado"] not in ("concluida", "cancelada") and not e["pode_produzir"]
    )

    prazos_atrasadas = prazos_proximos_7 = 0
    for e in encs_c:
        prazo = e.get("prazo_entrega")
        if not prazo or e["estado"] in ("concluida", "cancelada"):
            continue
        dias, est = _prazo_meta(prazo)
        if est == "atrasada":
            prazos_atrasadas += 1
        elif est == "proxima":
            prazos_proximos_7 += 1

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
        "orcamentos_por_estado": orcamentos_por_estado,
        "ofs_por_estado": ofs_por_estado,
        "valor_mensal": valor_mensal,
        "tempo_por_of": tempo_por_of,
        "top_artigos": top_artigos,
        "total_encomendas": len(encs_c),
        "valor_encomendas": valor_encomendas,
        "valor_pago_total": valor_pago_total,
        "valor_pendente_total": valor_pendente_total,
        "custo_real_encomendas": custo_real_encomendas,
        "custo_estimado_encomendas": custo_estimado_encomendas,
        "margem_encomendas": round2(valor_encomendas - custo_real_encomendas),
        "encomendas_por_pagamento": encomendas_por_pagamento,
        "encomendas_por_estado": encomendas_por_estado,
        "enc_valor_vs_custo": enc_valor_vs_custo,
        "encomendas_por_autorizar": encomendas_por_autorizar,
        "prazos_atrasadas": prazos_atrasadas,
        "prazos_proximos_7": prazos_proximos_7,
    }
