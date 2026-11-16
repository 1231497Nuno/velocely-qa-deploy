"""Custo real por encomenda: o que se previu (orçamento) vs o que custou de facto.

Custo real por linha da encomenda:
- operações: tempos reais das OF × custo da máquina / mão de obra (`op_custo_real`);
- materiais: consumos do fecho da OF (ou o previsto, se a OF ainda não foi fechada);
- compra: artigos comprados para revenda (fecho da OF ou custo do artigo, se não houver OF);
mais o desperdício das não conformidades. Receita = valor da encomenda sem IVA.
"""
from __future__ import annotations

from typing import Dict, List

from fastapi import HTTPException

from app.core.database import round2
from app.repositories import artigos_repo, encomendas_repo, nao_conformidades_repo, orcamentos_repo, ordens_repo
from app.services.costing import (
    compute_encomenda, compute_orcamento_totais, desconto_linha_item, op_custo_real, pers_valor_unit,
)


def _receita_linha(l: dict) -> float:
    q = float(l.get("quantidade") or 0)
    return round2((float(l.get("preco_unit") or 0) + pers_valor_unit(l)) * q - float(desconto_linha_item(l) or 0))


def _custo_item_of(of: dict, it: dict) -> Dict[str, float]:
    """Custos reais de um item de OF (usa o fecho se a OF foi fechada)."""
    fecho = of.get("fecho") or {}
    ops = it.get("operacoes") or []
    oper_real = sum(op_custo_real(o) for o in ops)
    oper_prev = sum(float(o.get("custo_estimado") or 0) for o in ops)
    mats_prev = sum(float(m.get("quantidade") or 0) * float(m.get("custo_unitario") or 0) for m in it.get("materiais") or [])
    linha_fecho = next((x for x in fecho.get("linhas") or [] if x.get("item_id") == it.get("id")), None) if fecho.get("fechada") else None
    if linha_fecho:
        mats = float(linha_fecho.get("custo_materiais") or 0)
        compra = float(linha_fecho.get("custo_compra") or 0)
        refugo = float(linha_fecho.get("qtd_refugo") or 0)
    else:
        mats = mats_prev
        compra = float(it.get("custo_compra_unit") or 0) * float(it.get("quantidade") or 0) if not (ops or it.get("materiais")) else 0.0
        refugo = 0.0
    return {"operacoes": oper_real, "operacoes_prev": oper_prev, "materiais": mats, "materiais_prev": mats_prev,
            "compra": compra, "refugo": refugo, "fechada": bool(linha_fecho),
            "min_reais": sum(float(o.get("tempo_real_seg") or 0) for o in ops) / 60.0,
            "min_prev": sum(float(o.get("tempo_min") or 0) for o in ops)}


async def encomenda(eid: str) -> dict:
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    c = await compute_encomenda(dict(e))
    ofs = await ordens_repo.find({"encomenda_id": eid}, limit=500)
    ncs = await nao_conformidades_repo.find({"encomenda_id": eid}, limit=500)
    orc = await orcamentos_repo.get(e["orcamento_id"]) if e.get("orcamento_id") else None
    orc_linhas = {l.get("id"): l for l in (orc or {}).get("linhas") or []}

    # Itens de OF por linha da encomenda (enc_artigo_id; senão pelo artigo)
    por_linha: Dict[str, List[tuple]] = {}
    sem_linha: List[tuple] = []
    linhas_enc = e.get("artigos") or []
    for of in ofs:
        if of.get("status") == "cancelado":
            continue
        for it in of.get("itens") or []:
            alvo = it.get("enc_artigo_id")
            if not alvo:
                cand = [l for l in linhas_enc if l.get("artigo_id") and l.get("artigo_id") == it.get("artigo_id")]
                alvo = cand[0]["id"] if len(cand) == 1 else None
            (por_linha.setdefault(alvo, []) if alvo else sem_linha).append((of, it))

    linhas = []
    for l in linhas_enc:
        q = float(l.get("quantidade") or 0)
        rec = _receita_linha(l)
        ol = orc_linhas.get(l.get("orcamento_linha_id")) or {}
        prev = float(ol.get("custo_producao_unit") or 0) * q if ol else None
        itens = por_linha.get(l.get("id"), [])
        if itens:
            cs = [_custo_item_of(of, it) for of, it in itens]
            oper = sum(x["operacoes"] for x in cs)
            mats = sum(x["materiais"] for x in cs)
            compra = sum(x["compra"] for x in cs)
            prev_ofs = sum(x["operacoes_prev"] + x["materiais_prev"] for x in cs)
            fechadas = all(x["fechada"] for x in cs)
            min_r, min_p = sum(x["min_reais"] for x in cs), sum(x["min_prev"] for x in cs)
            ofs_txt = sorted({of.get("numero") for of, _ in itens if of.get("numero")})
        else:
            a = await artigos_repo.get(l.get("artigo_id") or "") if l.get("artigo_id") else None
            compra = float((a or {}).get("custo_artigo") or 0) * q
            oper = mats = 0.0
            prev_ofs = compra
            fechadas = False
            min_r = min_p = 0.0
            ofs_txt = []
        real = round2(oper + mats + compra)
        if prev is None:
            prev = prev_ofs
        linhas.append({"id": l.get("id"), "artigo_nome": l.get("artigo_nome") or "", "quantidade": q, "receita": rec,
                       "custo_previsto": round2(prev), "custo_operacoes": round2(oper), "custo_materiais": round2(mats),
                       "custo_compra": round2(compra), "custo_real": real, "desvio": round2(real - prev),
                       "margem": round2(rec - real), "margem_pct": round2((rec - real) / rec * 100) if rec > 0 else None,
                       "min_reais": round(min_r), "min_previstos": round(min_p), "ofs": ofs_txt, "fechado": fechadas,
                       "sem_of": not itens})
    extra = [_custo_item_of(of, it) for of, it in sem_linha]
    custo_extra = round2(sum(x["operacoes"] + x["materiais"] + x["compra"] for x in extra))
    nc = round2(sum(float(n.get("custo_desperdicio") or 0) for n in ncs))

    receita = round2(float(c.get("valor_total") or 0))
    custo_real_total = round2(sum(x["custo_real"] for x in linhas) + custo_extra + nc)
    if orc:
        ot = compute_orcamento_totais(orc)
        custo_prev_total = round2(float(ot.get("subtotal_custo") or 0))
        margem_prev = round2(float(ot.get("lucro") or 0))
        margem_prev_pct = ot.get("margem_pct")
    else:
        custo_prev_total = round2(sum(x["custo_previsto"] for x in linhas))
        margem_prev = round2(receita - custo_prev_total)
        margem_prev_pct = round2(margem_prev / receita * 100) if receita > 0 else None
    margem = round2(receita - custo_real_total)
    return {
        "encomenda": {"id": eid, "numero": e.get("numero"), "cliente": e.get("cliente"), "estado": e.get("estado")},
        "orcamento_numero": (orc or {}).get("numero"),
        "receita": receita,
        "custo_previsto": custo_prev_total, "margem_prevista": margem_prev, "margem_prevista_pct": margem_prev_pct,
        "custo_real": custo_real_total, "margem_real": margem, "margem_real_pct": round2(margem / receita * 100) if receita > 0 else None,
        "desvio": round2(custo_real_total - custo_prev_total),
        "composicao": {"operacoes": round2(sum(x["custo_operacoes"] for x in linhas) + sum(x["operacoes"] for x in extra)),
                       "materiais": round2(sum(x["custo_materiais"] for x in linhas) + sum(x["materiais"] for x in extra)),
                       "compra": round2(sum(x["custo_compra"] for x in linhas) + sum(x["compra"] for x in extra)),
                       "nao_conformidades": nc},
        "linhas": linhas,
        "completo": bool(linhas) and all(x["fechado"] or (x["sem_of"] and x["custo_compra"] > 0) for x in linhas),
        "n_ofs": len([o for o in ofs if o.get("status") != "cancelado"]),
    }
