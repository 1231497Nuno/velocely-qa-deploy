"""Fecho do mês: um ecrã com o que foi faturado, recebido, o que falta receber, compras,
margem real vs objetivo e a lista do que falta tratar antes de enviar ao contabilista."""
from __future__ import annotations

import calendar
from datetime import date

from fastapi import HTTPException

from app.core.database import round2
from app.services import relatorios as rel


def limites_mes(mes: str) -> tuple:
    try:
        a, m = int(mes[:4]), int(mes[5:7])
        date(a, m, 1)
    except (ValueError, TypeError):
        raise HTTPException(400, "Mês inválido (use AAAA-MM)")
    return f"{a:04d}-{m:02d}-01", f"{a:04d}-{m:02d}-{calendar.monthrange(a, m)[1]:02d}"


def _tot(r: dict, k: str) -> float:
    return round2(float((r.get("totais") or {}).get(k) or 0))


async def resumo(mes: str, ver_custos: bool = True) -> dict:
    de, ate = limites_mes(mes)
    d = rel.Dados()
    p = rel.normalizar(de, ate, "mes", "", "", 0)
    fat = await rel.faturacao_documentos(d, p)
    rec = await rel.recebimentos_metodo(d, p)
    arec = await rel.a_receber(d, p)
    comp = await rel.compras_fornecedor(d, p)
    porfat = await rel.pagamentos_por_faturar(d, p)
    vendas = round2(sum(x["valor"] for x in (await rel._serie_vendas(d, p)).values()))

    pendentes = []
    rascunhos = [x for x in await d.documentos() if x.get("estado") == "rascunho" and de <= rel._dia(x, "data", "created_at") <= ate]
    if rascunhos:
        pendentes.append({"chave": "rascunhos", "texto": f"{len(rascunhos)} documento(s) de faturação em rascunho (por emitir)",
                          "link": "/financeiro"})
    if porfat["linhas"]:
        pendentes.append({"chave": "por_faturar", "texto": f"{len(porfat['linhas'])} pagamento(s) recebido(s) sem fatura · {_tot(porfat, 'valor'):.2f} €",
                          "link": "/relatorios?r=pagamentos_por_faturar"})
    sem_fatura = [o for o in await d.compras() if o.get("estado") == "recebida" and not o.get("fatura_fornecedor")
                  and de <= rel._dia(o, "data", "created_at") <= ate]
    if sem_fatura:
        pendentes.append({"chave": "faturas_fornecedor", "texto": f"{len(sem_fatura)} ordem(ns) de compra recebida(s) sem fatura do fornecedor registada",
                          "link": "/ordens-compra"})
    com_dif = [o for o in await d.compras() if ((o.get("fatura_fornecedor") or {}).get("estado") == "com_diferencas")
               and de <= rel._dia(o, "data", "created_at") <= ate]
    if com_dif:
        pendentes.append({"chave": "faturas_diferencas", "texto": f"{len(com_dif)} fatura(s) de fornecedor com diferenças por resolver",
                          "link": "/ordens-compra"})

    out = {
        "mes": mes[:7], "de": de, "ate": ate,
        "faturado": _tot(fat, "faturado"), "n_faturas": int(_tot(fat, "n_fat")), "anulado": _tot(fat, "anulado"),
        "recebido": _tot(rec, "total"), "a_receber": _tot(arec, "total"),
        "a_receber_90": _tot(arec, "b90"),
        "compras": _tot(comp, "total"), "compras_em_divida": _tot(comp, "divida"),
        "vendas": vendas,
        "top_devedores": [{"cliente": x["cliente"], "total": x["total"], "_link": x.get("_link")} for x in arec["linhas"][:5]],
        "top_fornecedores": [{"fornecedor": x["fornecedor"], "total": x["total"], "_link": x.get("_link")} for x in comp["linhas"][:5]],
        "pendentes": pendentes,
    }
    if ver_custos:
        res = await rel.resultado_periodo(d, p)
        out.update({"custo_producao": _tot(res, "custo_producao"), "resultado": _tot(res, "resultado"),
                    "margem": res["totais"].get("margem")})
        from app.services import objetivos
        obj = await objetivos.obter(int(mes[:4]))
        l = obj["linhas"][int(mes[5:7]) - 1]
        out["objetivo"] = {"vendas": l["obj_vendas"], "pct": l["pct_vendas"], "despesas": l["obj_despesas"]}
    return out
