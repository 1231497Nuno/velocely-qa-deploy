"""Produção: fecho da OF (quantidade produzida/refugo, materiais consumidos, custo fechado) e carga vs capacidade das máquinas."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.core.database import now_iso, round2
from app.repositories import artigos_repo, maquinas_repo, ordens_repo
from app.services import audit
from app.services import stock as stock_svc
from app.services.costing import op_custo_real, recompute_of_status


def _custo_ops(it: dict) -> Dict[str, float]:
    ops = it.get("operacoes") or []
    return {"estimado": round2(sum(float(o.get("custo_estimado") or 0) for o in ops)),
            "real": round2(sum(op_custo_real(o) for o in ops))}


def previsao_fecho(of: dict) -> dict:
    """Valores propostos para o fecho: quantidades e consumos previstos; custos estimados vs reais."""
    itens = []
    for it in of.get("itens") or []:
        q = float(it.get("quantidade") or 0)
        ops = _custo_ops(it)
        mats = [{"id": m.get("id"), "material_id": m.get("material_id"), "nome": m.get("nome") or "", "unidade": m.get("unidade") or "un",
                 "qtd_prevista": round(float(m.get("quantidade") or 0), 4), "custo_unitario": float(m.get("custo_unitario") or 0)}
                for m in it.get("materiais") or []]
        custo_mat_prev = round2(sum(m["qtd_prevista"] * m["custo_unitario"] for m in mats))
        compra = round2(float(it.get("custo_compra_unit") or 0) * q) if not (it.get("operacoes") or mats) else 0.0
        itens.append({"item_id": it.get("id"), "artigo_id": it.get("artigo_id"), "artigo_nome": it.get("artigo_nome") or "",
                      "unidade": it.get("unidade") or "un", "quantidade": q, "materiais": mats,
                      "custo_operacoes_estimado": ops["estimado"], "custo_operacoes_real": ops["real"],
                      "custo_materiais_previsto": custo_mat_prev, "custo_compra": compra,
                      "custo_estimado": round2(ops["estimado"] + custo_mat_prev + compra)})
    return {"of": {"id": of.get("id"), "numero": of.get("numero"), "cliente": of.get("cliente"), "status": of.get("status")},
            "itens": itens, "fecho": of.get("fecho")}


async def fechar_of(ofid: str, dados: dict, user: dict) -> dict:
    of = await ordens_repo.get(ofid)
    if not of:
        raise HTTPException(404, "OF não encontrada")
    if (of.get("fecho") or {}).get("fechada"):
        raise HTTPException(409, "A OF já está fechada — anule o fecho para corrigir")
    for it in of.get("itens") or []:
        for op in it.get("operacoes") or []:
            if op.get("timer_inicio"):
                raise HTTPException(400, f"Pare o cronómetro de «{op.get('nome')}» antes de fechar a OF")
    pv = {i["item_id"]: i for i in previsao_fecho(of)["itens"]}
    por_item = {d.get("item_id"): d for d in dados.get("itens") or []}
    abater = dados.get("abater_stock", True)
    entrada = dados.get("entrada_stock", True)
    origem = {"tipo": "of", "id": ofid, "numero": of.get("numero")}
    linhas, movs = [], []
    for it in of.get("itens") or []:
        p = pv[it.get("id")]
        d = por_item.get(it.get("id")) or {}
        produzida = round2(float(d["qtd_produzida"]) if d.get("qtd_produzida") not in (None, "") else p["quantidade"])
        refugo = round2(float(d.get("qtd_refugo") or 0))
        if produzida < 0 or refugo < 0:
            raise HTTPException(400, "As quantidades não podem ser negativas")
        cons = {c.get("id"): c.get("qtd_consumida") for c in d.get("materiais") or []}
        mats = []
        for m in p["materiais"]:
            q = cons.get(m["id"])
            q = m["qtd_prevista"] if q in (None, "") else float(q)
            if q < 0:
                raise HTTPException(400, f"«{m['nome']}»: consumo negativo")
            mats.append({**m, "qtd_consumida": round(q, 4), "custo": round2(q * m["custo_unitario"]),
                         "desvio": round(q - m["qtd_prevista"], 4)})
            if abater and m.get("material_id") and q > 0:
                mv = await stock_svc.movimentar(m["material_id"], -q, "consumo", origem=origem, user=user, nota=it.get("artigo_nome") or "")
                if mv:
                    movs.append(mv["id"])
        custo_mat = round2(sum(m["custo"] for m in mats))
        custo_total = round2(p["custo_operacoes_real"] + custo_mat + p["custo_compra"])
        boas = produzida
        unit = round(custo_total / boas, 4) if boas > 0 else 0.0
        if entrada and it.get("artigo_id") and boas > 0:
            a = await artigos_repo.get(it["artigo_id"]) or {}
            if a.get("gere_stock") and not it.get("enc_artigo_id"):
                # Só produção para stock (OF sem encomenda) entra em armazém; o resto segue para o cliente
                mv = await stock_svc.movimentar(it["artigo_id"], boas, "producao", origem=origem, custo_unit=unit, user=user)
                if mv:
                    movs.append(mv["id"])
        linhas.append({"item_id": it.get("id"), "artigo_nome": p["artigo_nome"], "unidade": p["unidade"],
                       "qtd_prevista": p["quantidade"], "qtd_produzida": produzida, "qtd_refugo": refugo,
                       "motivo_refugo": (d.get("motivo_refugo") or "").strip(), "materiais": mats,
                       "custo_operacoes": p["custo_operacoes_real"], "custo_materiais": custo_mat, "custo_compra": p["custo_compra"],
                       "custo_estimado": p["custo_estimado"], "custo_total": custo_total, "custo_unitario": unit,
                       "desvio": round2(custo_total - p["custo_estimado"])})
        for m in it.get("materiais") or []:
            m["consumido"] = True
    for it in of.get("itens") or []:
        for op in it.get("operacoes") or []:
            op["concluida"] = True
    total = round2(sum(l["custo_total"] for l in linhas))
    estimado = round2(sum(l["custo_estimado"] for l in linhas))
    fecho = {"fechada": True, "at": now_iso(), "por": (user or {}).get("name") or (user or {}).get("nome") or "",
             "notas": (dados.get("notas") or "").strip(), "linhas": linhas, "custo_total": total, "custo_estimado": estimado,
             "desvio": round2(total - estimado), "refugo_total": round2(sum(l["qtd_refugo"] for l in linhas)), "movimentos": movs}
    await ordens_repo.update(ofid, {"itens": of["itens"], "fecho": fecho, "status": "concluido"})
    await audit.registar("ordem_fabrico", ofid, "concluido", user,
                         f"OF {of.get('numero')} fechada · custo real {total:.2f}€ (estimado {estimado:.2f}€)"
                         + (f" · refugo {fecho['refugo_total']:g}" if fecho["refugo_total"] else ""), of.get("numero"))
    return recompute_of_status({**of, "fecho": fecho, "status": "concluido"})


async def anular_fecho(ofid: str, user: dict) -> dict:
    from app.repositories import movimentos_stock_repo
    of = await ordens_repo.get(ofid)
    if not of or not (of.get("fecho") or {}).get("fechada"):
        raise HTTPException(404, "A OF não está fechada")
    for mid in of["fecho"].get("movimentos") or []:
        m = await movimentos_stock_repo.get(mid)
        if m:
            await stock_svc.movimentar(m["artigo_id"], -float(m["quantidade"]), "ajuste", origem=m.get("origem"), user=user,
                                       nota="Anulação do fecho da OF")
    for it in of.get("itens") or []:
        for mat in it.get("materiais") or []:
            mat["consumido"] = False
    fecho = {**of["fecho"], "fechada": False, "anulado_at": now_iso()}
    await ordens_repo.update(ofid, {"itens": of["itens"], "fecho": fecho})
    await audit.registar("ordem_fabrico", ofid, "editado", user, f"Fecho da OF {of.get('numero')} anulado (stock reposto)", of.get("numero"))
    return recompute_of_status({**of, "fecho": fecho})


# ---------------------------------------------------------------------------
# Carga vs capacidade
# ---------------------------------------------------------------------------
def _segunda(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _data(v) -> Optional[date]:
    try:
        return datetime.fromisoformat(str(v)[:10]).date() if v else None
    except ValueError:
        return None


async def carga(semanas: int = 6, hoje: Optional[date] = None) -> dict:
    """Minutos de máquina por fazer (operações não concluídas das OF abertas), por máquina e semana do prazo."""
    from app.repositories import encomendas_repo
    hoje = hoje or date.today()
    s0 = _segunda(hoje)
    cols = [s0 + timedelta(weeks=i) for i in range(semanas)]
    maqs = {m["id"]: m for m in await maquinas_repo.find({}, sort=("nome", 1), limit=500)}
    linhas: Dict[str, dict] = {mid: {"maquina_id": mid, "nome": m.get("nome") or "", "horas_semana": float(m.get("horas_semana") or 40),
                                     "semanas": [0.0] * semanas, "atraso": 0.0, "sem_prazo": 0.0, "ofs": {}} for mid, m in maqs.items()}
    ofs = await ordens_repo.find({"status": {"$nin": ["concluido", "cancelado"]}}, limit=5000)
    enc_ids = list({o.get("encomenda_id") for o in ofs if o.get("encomenda_id")})
    prazos = {e["id"]: e.get("prazo_entrega") for e in await encomendas_repo.find({"id": {"$in": enc_ids}}, limit=5000)} if enc_ids else {}
    for of in ofs:
        prazo = _data(prazos.get(of.get("encomenda_id")) or of.get("prazo_entrega"))
        for it in of.get("itens") or []:
            for op in it.get("operacoes") or []:
                mid = op.get("maquina_id")
                if not mid or op.get("concluida"):
                    continue
                if mid not in linhas:
                    linhas[mid] = {"maquina_id": mid, "nome": op.get("maquina_nome") or "Máquina removida", "horas_semana": 40.0,
                                   "semanas": [0.0] * semanas, "atraso": 0.0, "sem_prazo": 0.0, "ofs": {}}
                l = linhas[mid]
                feito = float(op["tempo_maquina_real"]) if op.get("tempo_maquina_real") is not None else 0.0
                h = max(0.0, float(op.get("tempo_maquina") or 0) - feito) / 60.0
                if h <= 0:
                    continue
                if not prazo:
                    l["sem_prazo"] += h
                elif prazo < s0:
                    l["atraso"] += h
                else:
                    i = (prazo - s0).days // 7
                    l["semanas"][min(i, semanas - 1)] += h
                l["ofs"][of.get("id")] = of.get("numero")
    out = []
    for l in linhas.values():
        cap = l["horas_semana"]
        l["semanas"] = [{"inicio": c.isoformat(), "horas": round2(h), "pct": round2(h / cap * 100) if cap else None}
                        for c, h in zip(cols, l["semanas"])]
        l["atraso"] = round2(l["atraso"])
        l["sem_prazo"] = round2(l["sem_prazo"])
        l["total"] = round2(l["atraso"] + l["sem_prazo"] + sum(s["horas"] for s in l["semanas"]))
        l["n_ofs"] = len(l.pop("ofs"))
        out.append(l)
    out.sort(key=lambda x: (-x["total"], x["nome"]))
    return {"semanas": [c.isoformat() for c in cols], "maquinas": out}


# ---------------------------------------------------------------------------
# Prazo de entrega sugerido (carga real das máquinas + compras + margem)
# ---------------------------------------------------------------------------
def _somar_dias_uteis(d: date, n: int) -> date:
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


async def prazo_sugerido(linhas: List[dict], margem_dias: int = 2, dias_compra: int = 5) -> dict:
    """Data de entrega possível para estas linhas ({artigo_id, quantidade, roteiro?}).
    Para cada máquina: horas em fila (operações por fazer nas OF abertas) + horas destas linhas,
    a dividir pela capacidade diária (horas por semana ÷ 5). O prazo é o da máquina mais carregada,
    mais o tempo de compra se faltar stock de artigos comprados, mais a margem."""
    import math
    from app.services.costing import op_minutos_maquina
    maqs = {m["id"]: m for m in await maquinas_repo.find({}, limit=500)}
    novas: Dict[str, float] = {}
    compra = []
    for l in linhas or []:
        q = float(l.get("quantidade") or 0)
        if q <= 0:
            continue
        a = await artigos_repo.get(l.get("artigo_id") or "") if l.get("artigo_id") else None
        roteiro = l.get("roteiro") or (a or {}).get("roteiro") or []
        for op in roteiro:
            mid = op.get("maquina_id")
            if mid:
                novas[mid] = novas.get(mid, 0.0) + op_minutos_maquina(op) * q / 60.0
        if a and not roteiro and stock_svc.gere_stock(a):
            disp = float(a.get("qtd_stock") or 0)
            if disp < q:
                compra.append({"artigo": a.get("nome"), "falta": round2(q - disp), "fornecedor": a.get("fornecedor_nome") or ""})
    fila: Dict[str, float] = {}
    for of in await ordens_repo.find({"status": {"$nin": ["concluido", "cancelado"]}}, limit=5000):
        for it in of.get("itens") or []:
            for op in it.get("operacoes") or []:
                mid = op.get("maquina_id")
                if not mid or op.get("concluida") or mid not in novas:
                    continue
                feito = float(op["tempo_maquina_real"]) if op.get("tempo_maquina_real") is not None else 0.0
                fila[mid] = fila.get(mid, 0.0) + max(0.0, float(op.get("tempo_maquina") or 0) - feito) / 60.0
    detalhe = []
    dias_prod = 0
    for mid, h in novas.items():
        m = maqs.get(mid) or {}
        cap_dia = max(0.5, float(m.get("horas_semana") or 40) / 5.0)
        dias = math.ceil((fila.get(mid, 0.0) + h) / cap_dia) if h > 0 else 0
        dias_prod = max(dias_prod, dias)
        detalhe.append({"maquina": m.get("nome") or "Máquina", "horas_fila": round2(fila.get(mid, 0.0)), "horas_novas": round2(h),
                        "capacidade_dia": round2(cap_dia), "dias": dias})
    detalhe.sort(key=lambda x: -x["dias"])
    dias_comp = dias_compra if compra else 0
    total = dias_comp + dias_prod + max(0, int(margem_dias))
    hoje = datetime.now().date()
    data = _somar_dias_uteis(hoje, max(total, 1))
    return {"data": data.isoformat(), "dias_uteis": max(total, 1), "dias_producao": dias_prod, "dias_compra": dias_comp,
            "margem_dias": int(margem_dias), "maquinas": detalhe, "compras": compra,
            "sem_roteiro": not novas}
