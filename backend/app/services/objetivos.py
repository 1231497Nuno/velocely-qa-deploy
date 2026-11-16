"""Objetivos anuais (vendas e despesas por mês) comparados com o real."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from app.core.database import now_iso, round2
from app.repositories import encomendas_repo, objetivos_repo, ordens_compra_repo

MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def _doze(v) -> List[float]:
    v = list(v or [])[:12]
    return [round2(float(x or 0)) for x in v] + [0.0] * (12 - len(v))


async def obter(ano: int) -> dict:
    from app.services.costing import compute_encomendas_many
    obj = await objetivos_repo.get(str(ano)) or {}
    vendas: Dict[int, float] = defaultdict(float)
    despesas: Dict[int, float] = defaultdict(float)
    for e in await compute_encomendas_many(await encomendas_repo.find({"estado": {"$ne": "cancelada"}}, limit=20000),
                                           include_orcamento=False):
        d = str(e.get("data") or e.get("created_at") or "")
        if d[:4] == str(ano):
            vendas[int(d[5:7]) - 1] += float(e.get("valor_total") or 0)
    for o in await ordens_compra_repo.find({"estado": {"$ne": "cancelada"}}, limit=20000):
        d = str(o.get("data") or o.get("created_at") or "")
        if d[:4] == str(ano):
            despesas[int(d[5:7]) - 1] += float(o.get("total") or 0)
    ov, od = _doze(obj.get("vendas")), _doze(obj.get("despesas"))
    linhas, ac_ov, ac_rv = [], 0.0, 0.0
    for i in range(12):
        rv, rd = round2(vendas[i]), round2(despesas[i])
        ac_ov += ov[i]
        ac_rv += rv
        linhas.append({"mes": MESES[i], "obj_vendas": ov[i], "vendas": rv, "desvio_vendas": round2(rv - ov[i]),
                       "pct_vendas": round2(rv / ov[i] * 100) if ov[i] else None, "obj_despesas": od[i], "despesas": rd,
                       "desvio_despesas": round2(rd - od[i]), "acum_obj": round2(ac_ov), "acum_real": round2(ac_rv)})
    return {"ano": ano, "linhas": linhas, "total_obj_vendas": round2(sum(ov)), "total_vendas": round2(sum(vendas.values())),
            "total_obj_despesas": round2(sum(od)), "total_despesas": round2(sum(despesas.values())),
            "atualizado_at": obj.get("updated_at")}


async def guardar(ano: int, dados: dict) -> dict:
    await objetivos_repo.update_where({"id": str(ano)}, {"id": str(ano), "vendas": _doze(dados.get("vendas")),
                                                         "despesas": _doze(dados.get("despesas")), "updated_at": now_iso()}, upsert=True)
    return await obter(ano)
