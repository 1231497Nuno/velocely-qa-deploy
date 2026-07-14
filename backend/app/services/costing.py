"""Serviço de custeio e regras de produção (Orçamentos, OFs, Encomendas)."""
from datetime import datetime, timezone
from typing import List, Optional

from app.core.database import round2, new_id
from app.domain.models import OFOperacao
from app.repositories import (
    artigos_repo, consumiveis_repo, maquinas_repo, mao_obra_repo, tipos_repo,
    orcamentos_repo, ordens_repo,
)


# ----------------------- Tempos / custos base -----------------------
def to_minutes(val, unidade) -> float:
    val = val or 0
    return val * 60.0 if unidade == "h" else val


def maquina_custo_hora(m: Optional[dict]) -> float:
    if not m:
        return 0.0
    if "custo_amortizacao_hora" in m or "custo_energia_hora" in m:
        return (m.get("custo_amortizacao_hora") or 0) + (m.get("custo_energia_hora") or 0)
    return m.get("custo_hora") or 0


def op_minutos_maquina(op: dict) -> float:
    if "tempo_maquina" in op:
        return to_minutes(op.get("tempo_maquina"), op.get("tempo_maquina_unidade", "min"))
    return op.get("min_maquina") or 0


def op_minutos_mao_obra(op: dict) -> float:
    if "tempo_mao_obra" in op:
        return to_minutes(op.get("tempo_mao_obra"), op.get("tempo_mao_obra_unidade", "min"))
    return op.get("min_mao_obra") or 0


async def artigo_breakdown(artigo: dict) -> dict:
    custo_materiais = 0.0
    cons_cache = {}
    for mat in artigo.get("materiais", []):
        cid = mat.get("material_id")
        custo_unit = mat.get("custo_unitario") or 0
        if cid:
            if cid not in cons_cache:
                c = await consumiveis_repo.get(cid)
                cons_cache[cid] = c.get("custo_unitario") if c else None
            if cons_cache[cid] is not None:
                custo_unit = cons_cache[cid]
        custo_materiais += (mat.get("quantidade") or 0) * custo_unit

    custo_maquinas = 0.0
    custo_mao_obra = 0.0
    maq_cache = {}
    mo_cache = {}
    for op in artigo.get("roteiro", []):
        mid = op.get("maquina_id")
        if mid:
            if mid not in maq_cache:
                m = await maquinas_repo.get(mid)
                maq_cache[mid] = maquina_custo_hora(m)
            custo_maquinas += (op_minutos_maquina(op) / 60.0) * maq_cache[mid]
        moid = op.get("mao_obra_id")
        if moid:
            if moid not in mo_cache:
                mo = await mao_obra_repo.get(moid)
                mo_cache[moid] = (mo or {}).get("custo_hora", 0.0)
            custo_mao_obra += (op_minutos_mao_obra(op) / 60.0) * mo_cache[moid]

    custo_materiais = round2(custo_materiais)
    custo_maquinas = round2(custo_maquinas)
    custo_mao_obra = round2(custo_mao_obra)
    custo_artigo = round2(artigo.get("custo_artigo") or 0)
    custo_total = round2(custo_artigo + custo_materiais + custo_maquinas + custo_mao_obra)
    margem = artigo.get("margem")
    if margem is None:
        margem = 30.0
    return {
        "custo_artigo": custo_artigo,
        "custo_materiais": custo_materiais,
        "custo_maquinas": custo_maquinas,
        "custo_mao_obra": custo_mao_obra,
        "custo_producao_total": custo_total,
        "preco_venda": round2(custo_total * (1 + margem / 100.0)),
    }


async def artigo_custo_total(artigo: dict) -> float:
    return (await artigo_breakdown(artigo))["custo_producao_total"]


def enrich_artigo(artigo: dict, breakdown: dict) -> dict:
    return {**artigo, **breakdown}


# ----------------------- Personalizações -----------------------
def pers_valor_unit(l: dict) -> float:
    ps = l.get("personalizacoes")
    if ps:
        return sum((p.get("valor") or 0) for p in ps)
    return l.get("valor_personalizacao") or 0


def pers_nomes(l: dict) -> str:
    ps = l.get("personalizacoes")
    if ps:
        nomes = [p.get("nome", "") for p in ps if p.get("nome")]
        if nomes:
            return ", ".join(nomes)
    return l.get("tipo_personalizacao_nome") or ""


# ----------------------- Materiais -----------------------
MATERIAL_MARKUP = 1.5  # margem default de 50% (usada quando a linha não define margem)


def material_margem_factor(m: dict) -> float:
    margem = m.get("margem")
    if margem is None:
        return MATERIAL_MARKUP
    return 1.0 + (float(margem) / 100.0)


def material_custo(m: dict) -> float:
    unidade = (m.get("unidade") or "").lower()
    if unidade in ("m²", "m2"):
        c = (float(m.get("comprimento_mm") or 0) / 1000.0) * (float(m.get("largura_mm") or 0) / 1000.0)
        return round2(c * (float(m.get("custo_unitario") or 0)) * (float(m.get("quantidade") or 1)))
    return round2(float(m.get("quantidade") or 0) * float(m.get("custo_unitario") or 0))


def fill_materiais(materiais: List[dict]) -> List[dict]:
    out = []
    for m in materiais or []:
        m = {**m}
        if m.get("margem") is None:
            m["margem"] = 50.0
        custo = material_custo(m)
        m["custo"] = custo
        m["valor"] = round2(custo * material_margem_factor(m))
        out.append(m)
    return out


# ----------------------- Descontos / totais do orçamento -----------------------
def desconto_valor(base: float, desconto, tipo) -> float:
    d = desconto or 0
    if d <= 0:
        return 0.0
    if (tipo or "pct") == "eur":
        return round2(min(d, base))
    return round2(base * d / 100.0)


def linha_venda_bruto(l: dict) -> float:
    qtd = l.get("quantidade") or 0
    return round2(((l.get("preco_unit") or 0) + pers_valor_unit(l)) * qtd)


def compute_orcamento_totais(orc: dict) -> dict:
    subtotal_custo = 0.0
    subtotal_venda = 0.0
    total_pers = 0.0
    desconto_linhas = 0.0
    for l in orc.get("linhas", []):
        qtd = l.get("quantidade") or 0
        subtotal_custo += (l.get("custo_producao_unit") or 0) * qtd
        subtotal_venda += (l.get("preco_unit") or 0) * qtd
        total_pers += pers_valor_unit(l) * qtd
        desconto_linhas += desconto_valor(linha_venda_bruto(l), l.get("desconto"), l.get("desconto_tipo"))
    custo_materiais = 0.0
    venda_materiais = 0.0
    for m in orc.get("materiais", []):
        c = material_custo(m)
        custo_materiais += c
        venda_materiais += round2(c * material_margem_factor(m))
    subtotal_venda = round2(subtotal_venda)
    total_pers = round2(total_pers)
    custo_materiais = round2(custo_materiais)
    venda_materiais = round2(venda_materiais)
    desconto_linhas = round2(desconto_linhas)
    subtotal_custo = round2(subtotal_custo + custo_materiais)
    subtotal_liquido = round2(subtotal_venda + total_pers + venda_materiais - desconto_linhas)
    desc_total_val = desconto_valor(subtotal_liquido, orc.get("desconto_total"), orc.get("desconto_total_tipo"))
    total = round2(subtotal_liquido - desc_total_val)
    orc = {**orc}
    orc["subtotal_custo"] = subtotal_custo
    orc["subtotal_venda"] = subtotal_venda
    orc["total_personalizacao"] = total_pers
    orc["custo_materiais"] = custo_materiais
    orc["total_materiais"] = venda_materiais
    orc["desconto_linhas"] = desconto_linhas
    orc["subtotal_liquido"] = subtotal_liquido
    orc["desconto_total_valor"] = desc_total_val
    orc["total"] = total
    orc["lucro"] = round2(total - subtotal_custo)
    return orc


async def fill_linha_custos(linhas: List[dict]) -> List[dict]:
    out = []
    for l in linhas:
        a = await artigos_repo.get(l.get("artigo_id"))
        if a:
            l["artigo_nome"] = a.get("nome", l.get("artigo_nome", ""))
            if l.get("custo_base_unit") is None:
                bd_a = await artigo_breakdown(a)
                l["custo_base_unit"] = round2(bd_a["custo_artigo"] + bd_a["custo_materiais"])
                if l.get("margem") is None:
                    l["margem"] = a.get("margem", 30)
                if not l.get("roteiro"):
                    l["roteiro"] = a.get("roteiro", [])
            pseudo = {
                "custo_artigo": l.get("custo_base_unit") or 0,
                "materiais": [],
                "roteiro": l.get("roteiro", []),
                "margem": l.get("margem") if l.get("margem") is not None else 30,
            }
            bd = await artigo_breakdown(pseudo)
            l["custo_producao_unit"] = bd["custo_producao_total"]
            if l.get("preco_unit_manual") and l.get("preco_unit") is not None:
                l["preco_unit"] = round2(float(l.get("preco_unit") or 0))
            else:
                l["preco_unit"] = bd["preco_venda"]
        out.append(l)
    return out


# ----------------------- Custos reais das OFs -----------------------
def op_machine_cost_est(op: dict) -> float:
    cm = op.get("custo_maquina_estimado")
    if cm is not None:
        return cm
    t_maq = op.get("tempo_maquina") or 0
    t_mo = op.get("tempo_mao_obra") or 0
    ttot = t_maq + t_mo
    ce = op.get("custo_estimado") or 0
    return round2(ce * (t_maq / ttot)) if ttot > 0 else 0.0


def op_labor_rate(op: dict) -> float:
    r = op.get("mao_obra_custo_hora")
    if r is not None:
        return r
    t_mo = op.get("tempo_mao_obra") or 0
    if t_mo <= 0:
        return 0.0
    cmo_est = (op.get("custo_estimado") or 0) - op_machine_cost_est(op)
    return round2(cmo_est / (t_mo / 60.0))


def op_custo_real(op: dict) -> float:
    horas_real = (op.get("tempo_real_seg") or 0) / 3600.0
    return round2(op_machine_cost_est(op) + horas_real * op_labor_rate(op))


def recompute_of_status(of: dict) -> dict:
    all_ops = [op for it in of.get("itens", []) for op in it.get("operacoes", [])]
    of = {**of}
    running = any(op.get("timer_inicio") for op in all_ops)
    has_progress = any((op.get("tempo_real_seg") or 0) > 0 or op.get("concluida") for op in all_ops)
    if all_ops:
        done = sum(1 for op in all_ops if op.get("concluida"))
        if done == len(all_ops):
            of["status"] = "concluido"
        elif done > 0 or running or has_progress:
            of["status"] = "em_producao"
        else:
            of["status"] = "pendente"
        of["progresso"] = round2(done / len(all_ops) * 100)
    else:
        of["progresso"] = 0
    if of.get("status") == "concluido":
        of["timer_estado"] = "concluido"
    elif running:
        of["timer_estado"] = "em_curso"
    elif has_progress:
        of["timer_estado"] = "em_pausa"
    else:
        of["timer_estado"] = "por_iniciar"
    return of


async def build_of_itens(itens: List[dict]) -> List[dict]:
    """Auto-load roteiro de operações from artigo for each item."""
    out = []
    for it in itens:
        if not it.get("id"):
            it["id"] = new_id()
        a = await artigos_repo.get(it.get("artigo_id"))
        operacoes = it.get("operacoes")
        if a:
            it["artigo_nome"] = a.get("nome", it.get("artigo_nome", ""))
            it["unidade"] = a.get("unidade") or it.get("unidade") or "un"
            if not it.get("preco_unit"):
                it["preco_unit"] = (await artigo_breakdown(a)).get("preco_venda") or 0
            if not operacoes:
                operacoes = []
                for op in a.get("roteiro", []):
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
                            mao_obra_nome=op.get("mao_obra_nome"),
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
        it["operacoes"] = operacoes or []
        out.append(it)
    await _apply_pers_tempo(out)
    return out


async def _apply_pers_tempo(itens: List[dict]) -> None:
    """Calcula os tempos/custos estimados das operações da OF:
    tempo = tempo_base (por unidade) × quantidade; a mão de obra da operação
    responsável pelas personalizações soma ainda (tempo personalização × qtd).
    Idempotente: recalcula sempre a partir das bases por unidade."""
    resp_mo = await mao_obra_repo.find_one({"responsavel_personalizacoes": True})
    resp_id = resp_mo.get("id") if resp_mo else None
    resp_rate = (resp_mo or {}).get("custo_hora") or 0
    tipos = await tipos_repo.find(limit=1000)
    tempo_map = {t["id"]: (t.get("tempo") or 0) for t in tipos}

    for it in itens:
        ops = it.get("operacoes") or []
        if not ops:
            continue
        qtd = it.get("quantidade") or 1
        pers_min_unit = 0.0
        for p in (it.get("personalizacoes") or []):
            t = p.get("tempo")
            if not t:
                t = tempo_map.get(p.get("id"), 0)
            pers_min_unit += (t or 0)
        pers_min = round2(pers_min_unit * qtd)

        for op in ops:
            if op.get("tempo_mao_obra_base") is None:
                op["tempo_mao_obra_base"] = op.get("tempo_mao_obra") or 0
            if op.get("tempo_maquina_base") is None:
                op["tempo_maquina_base"] = op.get("tempo_maquina") or 0
            if not op.get("maquina_custo_hora"):
                if op.get("maquina_id"):
                    m = await maquinas_repo.get(op["maquina_id"])
                    if m:
                        op["maquina_custo_hora"] = maquina_custo_hora(m)
                        if not op.get("maquina_nome"):
                            op["maquina_nome"] = m.get("nome")
                if not op.get("maquina_custo_hora"):
                    mb = op.get("tempo_maquina_base") or 0
                    oldc = op.get("custo_maquina_estimado") or 0
                    op["maquina_custo_hora"] = round2(oldc / (mb / 60.0)) if mb > 0 else 0
            if not op.get("mao_obra_custo_hora"):
                if op.get("mao_obra_id"):
                    mo = await mao_obra_repo.get(op["mao_obra_id"])
                    if mo:
                        op["mao_obra_custo_hora"] = mo.get("custo_hora") or 0
                        if not op.get("mao_obra_nome"):
                            op["mao_obra_nome"] = mo.get("nome")
                if not op.get("mao_obra_custo_hora"):
                    ob = op.get("tempo_mao_obra_base") or 0
                    oldc = op.get("custo_mao_obra_estimado") or 0
                    op["mao_obra_custo_hora"] = round2(oldc / (ob / 60.0)) if ob > 0 else 0

        target = None
        if resp_id:
            target = next((op for op in ops if op.get("mao_obra_id") == resp_id), None)
        if target is None and pers_min > 0:
            target = ops[0]

        for op in ops:
            maq_total = round2((op.get("tempo_maquina_base") or 0) * qtd)
            mo_total = round2((op.get("tempo_mao_obra_base") or 0) * qtd)
            if op is target and pers_min > 0:
                if not op.get("mao_obra_custo_hora") and (resp_id is None or op.get("mao_obra_id") == resp_id):
                    op["mao_obra_custo_hora"] = resp_rate
                    if not op.get("mao_obra_nome") and resp_mo:
                        op["mao_obra_nome"] = resp_mo.get("nome")
                        op["mao_obra_id"] = resp_id
                mo_total = round2(mo_total + pers_min)
            maq_rate = op.get("maquina_custo_hora") or 0
            mo_rate = op.get("mao_obra_custo_hora") or 0
            op["tempo_maquina"] = maq_total
            op["tempo_mao_obra"] = mo_total
            op["custo_maquina_estimado"] = round2((maq_total / 60.0) * maq_rate)
            op["custo_mao_obra_estimado"] = round2((mo_total / 60.0) * mo_rate)
            op["tempo_min"] = round2(maq_total + mo_total)
            op["custo_estimado"] = round2(op["custo_maquina_estimado"] + op["custo_mao_obra_estimado"])


# ----------------------- Encomendas -----------------------
def encomenda_artigos_breakdown(enc: dict) -> dict:
    bruto = 0.0
    desc_linhas = 0.0
    for a in enc.get("artigos", []):
        qtd = a.get("quantidade") or 0
        linha_bruto = round2(((a.get("preco_unit") or 0) + pers_valor_unit(a)) * qtd)
        bruto += linha_bruto
        desc_linhas += desconto_valor(linha_bruto, a.get("desconto"), a.get("desconto_tipo"))
    bruto = round2(bruto)
    desc_linhas = round2(desc_linhas)
    subtotal_liquido = round2(bruto - desc_linhas)
    desc_total = desconto_valor(subtotal_liquido, enc.get("desconto_total"), enc.get("desconto_total_tipo"))
    return {
        "bruto": bruto,
        "desconto_linhas": desc_linhas,
        "subtotal_liquido": subtotal_liquido,
        "desconto_total_valor": desc_total,
        "total": round2(subtotal_liquido - desc_total),
    }


def encomenda_artigos_total(enc: dict) -> float:
    return encomenda_artigos_breakdown(enc)["total"]


async def compute_encomenda(enc: dict) -> dict:
    enc = {**enc}
    ofs = await ordens_repo.find({"encomenda_id": enc["id"]})
    ofs = [recompute_of_status(o) for o in ofs]
    enc["num_ofs"] = len(ofs)

    custo_est = custo_real = 0.0
    for o in ofs:
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                custo_est += op.get("custo_estimado") or 0
                custo_real += op_custo_real(op)
    enc["custo_producao_estimado"] = round2(custo_est)
    enc["custo_producao_real"] = round2(custo_real)

    if enc.get("valor_total_manual") and enc.get("valor_total") is not None:
        valor = enc.get("valor_total") or 0
    elif enc.get("orcamento_id"):
        orc = await orcamentos_repo.get(enc["orcamento_id"])
        valor = compute_orcamento_totais(orc)["total"] if orc else encomenda_artigos_total(enc)
    else:
        valor = encomenda_artigos_total(enc)
    enc["valor_total"] = round2(valor)
    bd = encomenda_artigos_breakdown(enc)
    enc["valor_artigos_bruto"] = bd["bruto"]
    enc["desconto_linhas"] = bd["desconto_linhas"]
    enc["desconto_total_valor"] = bd["desconto_total_valor"]

    pago = enc.get("valor_pago") or 0
    if pago <= 0:
        enc["status_pagamento"] = "pendente"
    elif pago < enc["valor_total"]:
        enc["status_pagamento"] = "parcial"
    else:
        enc["status_pagamento"] = "pago"
    enc["valor_pendente"] = round2(max(0.0, enc["valor_total"] - pago))
    enc["pode_produzir"] = bool(enc.get("autorizada_producao") or enc["status_pagamento"] == "pago")

    if enc.get("estado") != "cancelada":
        if ofs and all(o.get("status") == "concluido" for o in ofs):
            enc["estado"] = "concluida"
        elif any(o.get("status") in ("em_producao", "concluido") for o in ofs):
            enc["estado"] = "em_producao"
        else:
            enc["estado"] = "aberta"
    enc["margem_producao"] = round2(enc["valor_total"] - enc["custo_producao_real"])
    enc["ordens_resumo"] = [
        {"id": o["id"], "numero": o.get("numero"), "status": o.get("status"), "progresso": o.get("progresso")}
        for o in ofs
    ]
    return enc


def _prazo_meta(prazo: str):
    """Devolve (dias_restantes, estado_prazo) para um prazo ISO YYYY-MM-DD."""
    try:
        d = (datetime.fromisoformat(prazo[:10]).date() - datetime.now(timezone.utc).date()).days
    except Exception:
        return None, "futura"
    if d < 0:
        return d, "atrasada"
    if d <= 7:
        return d, "proxima"
    return d, "futura"
