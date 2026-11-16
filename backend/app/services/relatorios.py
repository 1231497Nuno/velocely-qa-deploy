"""Relatórios (área Relatórios): vendas, produção e custos, recebimentos, compras e margens.

Cada relatório recebe os parâmetros comuns (período, agrupamento, comparação) e devolve:
    {"colunas": [{key, label, tipo, total}], "linhas": [{..., "_link": "/rota"}],
     "totais": {...}, "grafico": {tipo, x, series} | None, "notas": [...]}
Tipos de coluna: texto | moeda | numero | inteiro | pct | data.
As linhas podem levar `_link` para abrir o registo (do total ao detalhe).
Exportação: Excel (openpyxl) e PDF (reportlab).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException

from app.core.database import round2
from app.repositories import (
    clientes_repo, crm_estados_repo, documentos_financeiros_repo, empresa_repo, encomendas_repo, leads_repo,
    nao_conformidades_repo, orcamentos_repo, ordens_compra_repo, ordens_repo,
)
from app.services.costing import (
    compute_encomendas_many, compute_orcamento_totais, desconto_linha_item, op_custo_real, pers_valor_unit,
)

MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
AGRUPAMENTOS = ("dia", "semana", "mes", "trimestre", "ano")
METODOS_PT = {
    "transferencia": "Transferência", "numerario": "Numerário", "mbway": "MB WAY", "multibanco": "Multibanco",
    "cheque": "Cheque", "cartao": "Cartão", "outro": "Outro",
}


# ---------------------------------------------------------------------------
# Parâmetros e períodos
# ---------------------------------------------------------------------------
@dataclass
class Params:
    de: str
    ate: str
    agrupar: str = "mes"
    comparar: str = ""       # "" | anterior | ano
    cliente_id: str = ""
    limite: int = 0

    @property
    def hoje(self) -> str:
        return datetime.now(timezone.utc).date().isoformat()


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def normalizar(de: str, ate: str, agrupar: str, comparar: str, cliente_id: str = "", limite: int = 0) -> Params:
    hoje = datetime.now(timezone.utc).date()
    try:
        d_de = _d(de) if de else date(hoje.year, 1, 1)
        d_ate = _d(ate) if ate else hoje
    except ValueError:
        raise HTTPException(400, "Datas inválidas (use AAAA-MM-DD)")
    if d_de > d_ate:
        d_de, d_ate = d_ate, d_de
    return Params(d_de.isoformat(), d_ate.isoformat(), agrupar if agrupar in AGRUPAMENTOS else "mes",
                  comparar if comparar in ("anterior", "ano") else "", (cliente_id or "").strip(), max(0, int(limite or 0)))


def periodo_comparacao(p: Params) -> Optional[Params]:
    if not p.comparar:
        return None
    d_de, d_ate = _d(p.de), _d(p.ate)
    if p.comparar == "ano":
        def menos_ano(d: date) -> date:
            try:
                return d.replace(year=d.year - 1)
            except ValueError:
                return d.replace(year=d.year - 1, day=28)
        return Params(menos_ano(d_de).isoformat(), menos_ano(d_ate).isoformat(), p.agrupar, "", p.cliente_id, p.limite)
    dias = (d_ate - d_de).days + 1
    return Params((d_de - timedelta(days=dias)).isoformat(), (d_de - timedelta(days=1)).isoformat(),
                  p.agrupar, "", p.cliente_id, p.limite)


def chave_periodo(dia: str, agrupar: str) -> str:
    d = _d(dia)
    if agrupar == "dia":
        return d.isoformat()
    if agrupar == "semana":
        y, w, _ = d.isocalendar()
        return f"{y}-S{w:02d}"
    if agrupar == "trimestre":
        return f"{d.year}-T{(d.month - 1) // 3 + 1}"
    if agrupar == "ano":
        return str(d.year)
    return f"{d.year}-{d.month:02d}"


def rotulo_periodo(chave: str, agrupar: str) -> str:
    if agrupar == "mes":
        y, m = chave.split("-")
        return f"{MESES[int(m) - 1]} {y}"
    if agrupar == "dia":
        y, m, dd = chave.split("-")
        return f"{dd}/{m}/{y}"
    if agrupar == "semana":
        y, w = chave.split("-S")
        return f"Sem. {int(w)} {y}"
    if agrupar == "trimestre":
        y, t = chave.split("-T")
        return f"{t}.º trim. {y}"
    return chave


def chaves_periodo(p: Params) -> List[str]:
    """Todas as chaves do intervalo (para mostrar também os períodos a zero)."""
    out, vistos = [], set()
    d, fim = _d(p.de), _d(p.ate)
    passo = timedelta(days=1)
    while d <= fim:
        k = chave_periodo(d.isoformat(), p.agrupar)
        if k not in vistos:
            vistos.add(k)
            out.append(k)
        d += passo
        if len(out) > 400:
            break
    return out


def no_periodo(dia: Optional[str], p: Params) -> bool:
    return bool(dia) and p.de <= str(dia)[:10] <= p.ate


def var_pct(atual: float, anterior: float) -> Optional[float]:
    if not anterior:
        return None
    return round2((atual - anterior) / abs(anterior) * 100)


def _dia(doc: dict, *campos: str) -> str:
    for c in campos or ("data", "created_at"):
        v = doc.get(c)
        if v:
            return str(v)[:10]
    return ""


# ---------------------------------------------------------------------------
# Dados (carregados uma vez por pedido)
# ---------------------------------------------------------------------------
class Dados:
    def __init__(self) -> None:
        self._c: Dict[str, Any] = {}

    async def _get(self, k: str, f: Callable):
        if k not in self._c:
            self._c[k] = await f()
        return self._c[k]

    async def encomendas(self) -> List[dict]:
        async def f():
            encs = await encomendas_repo.find({"estado": {"$ne": "cancelada"}}, limit=20000)
            calc = await compute_encomendas_many(encs, include_orcamento=False)
            originais = {e["id"]: e for e in encs}
            for c in calc:
                c["_orig"] = originais.get(c["id"]) or {}
                c["_dia"] = _dia(c, "data", "created_at")
            return [c for c in calc if c.get("estado") != "cancelada"]
        return await self._get("encs", f)

    async def ofs(self) -> List[dict]:
        return await self._get("ofs", lambda: ordens_repo.find({}, limit=20000))

    async def documentos(self) -> List[dict]:
        return await self._get("docs", lambda: documentos_financeiros_repo.find({}, limit=50000))

    async def orcamentos(self) -> List[dict]:
        return await self._get("orcs", lambda: orcamentos_repo.find({}, limit=20000))

    async def compras(self) -> List[dict]:
        return await self._get("ocs", lambda: ordens_compra_repo.find({"estado": {"$ne": "cancelada"}}, limit=20000))

    async def ncs(self) -> List[dict]:
        return await self._get("ncs", lambda: nao_conformidades_repo.find({}, limit=20000))

    async def leads(self) -> List[dict]:
        return await self._get("leads", lambda: leads_repo.find({}, limit=20000))

    async def estados_crm(self) -> Dict[str, dict]:
        async def f():
            return {e["id"]: e for e in await crm_estados_repo.find({}, limit=200)}
        return await self._get("estados_crm", f)

    async def clientes(self) -> Dict[str, dict]:
        async def f():
            return {c["id"]: c for c in await clientes_repo.find({}, limit=50000)}
        return await self._get("clientes", f)


def _filtrar_cliente(encs: List[dict], p: Params) -> List[dict]:
    return [e for e in encs if e.get("cliente_id") == p.cliente_id] if p.cliente_id else encs


def _col(key: str, label: str, tipo: str = "texto", total: bool = False) -> dict:
    return {"key": key, "label": label, "tipo": tipo, "total": total}


def _totais(colunas: List[dict], linhas: List[dict]) -> dict:
    t: Dict[str, Any] = {}
    for c in colunas:
        if c.get("total"):
            t[c["key"]] = round2(sum(float(l.get(c["key"]) or 0) for l in linhas))
    return t


def _linha_valor_artigo(a: dict) -> float:
    qtd = float(a.get("quantidade") or 0)
    return round2((float(a.get("preco_unit") or 0) + pers_valor_unit(a)) * qtd - desconto_linha_item(a))


def _limitar(linhas: List[dict], p: Params) -> List[dict]:
    return linhas[: p.limite] if p.limite else linhas


# ---------------------------------------------------------------------------
# Vendas e faturação
# ---------------------------------------------------------------------------
async def _serie_vendas(d: Dados, p: Params) -> Dict[str, dict]:
    g: Dict[str, dict] = defaultdict(lambda: {"n": 0, "valor": 0.0, "com_iva": 0.0})
    for e in _filtrar_cliente(await d.encomendas(), p):
        if no_periodo(e["_dia"], p):
            k = chave_periodo(e["_dia"], p.agrupar)
            g[k]["n"] += 1
            g[k]["valor"] += float(e.get("valor_total") or 0)
            g[k]["com_iva"] += float(e.get("total_com_iva") or 0)
    return g


async def vendas_periodo(d: Dados, p: Params) -> dict:
    atual = await _serie_vendas(d, p)
    pc = periodo_comparacao(p)
    anterior = await _serie_vendas(d, pc) if pc else {}
    chaves_ant = chaves_periodo(pc) if pc else []
    linhas = []
    for i, k in enumerate(chaves_periodo(p)):
        a = atual.get(k) or {"n": 0, "valor": 0.0, "com_iva": 0.0}
        l = {"periodo": rotulo_periodo(k, p.agrupar), "n": a["n"], "valor": round2(a["valor"]),
             "com_iva": round2(a["com_iva"]), "ticket": round2(a["valor"] / a["n"]) if a["n"] else 0.0}
        if pc:
            ka = chaves_ant[i] if i < len(chaves_ant) else None
            v_ant = round2((anterior.get(ka) or {}).get("valor", 0.0)) if ka else 0.0
            l["valor_ant"] = v_ant
            l["variacao"] = var_pct(l["valor"], v_ant)
        linhas.append(l)
    colunas = [_col("periodo", "Período"), _col("n", "Encomendas", "inteiro", True), _col("valor", "Vendas s/ IVA", "moeda", True),
               _col("com_iva", "Vendas c/ IVA", "moeda", True), _col("ticket", "Valor médio", "moeda")]
    if pc:
        colunas += [_col("valor_ant", "Período de comparação", "moeda", True), _col("variacao", "Variação", "pct")]
    tot = _totais(colunas, linhas)
    tot["ticket"] = round2(tot["valor"] / tot["n"]) if tot.get("n") else 0.0
    if pc:
        tot["variacao"] = var_pct(tot["valor"], tot.get("valor_ant") or 0)
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras", "x": "periodo", "series": ["valor"] + (["valor_ant"] if pc else [])}}


async def _por_cliente_vendas(d: Dados, p: Params) -> Dict[str, dict]:
    g: Dict[str, dict] = {}
    for e in _filtrar_cliente(await d.encomendas(), p):
        if not no_periodo(e["_dia"], p):
            continue
        k = e.get("cliente_id") or f"nome:{e.get('cliente') or '—'}"
        x = g.setdefault(k, {"cliente": e.get("cliente") or "—", "cliente_id": e.get("cliente_id"), "n": 0, "valor": 0.0, "ultima": ""})
        x["n"] += 1
        x["valor"] += float(e.get("valor_total") or 0)
        x["ultima"] = max(x["ultima"], e["_dia"])
    return g


async def vendas_cliente(d: Dados, p: Params) -> dict:
    g = await _por_cliente_vendas(d, p)
    pc = periodo_comparacao(p)
    ant = await _por_cliente_vendas(d, pc) if pc else {}
    total = sum(x["valor"] for x in g.values()) or 0
    linhas = []
    for k, x in sorted(g.items(), key=lambda kv: -kv[1]["valor"]):
        l = {"cliente": x["cliente"], "n": x["n"], "valor": round2(x["valor"]),
             "pct": round2(x["valor"] / total * 100) if total else 0.0,
             "ticket": round2(x["valor"] / x["n"]) if x["n"] else 0.0, "ultima": x["ultima"] or None,
             "_link": f"/clientes/{x['cliente_id']}" if x.get("cliente_id") else None}
        if pc:
            v_ant = round2((ant.get(k) or {}).get("valor", 0.0))
            l["valor_ant"], l["variacao"] = v_ant, var_pct(l["valor"], v_ant)
        linhas.append(l)
    linhas = _limitar(linhas, p)
    colunas = [_col("cliente", "Cliente"), _col("n", "Encomendas", "inteiro", True), _col("valor", "Vendas s/ IVA", "moeda", True),
               _col("pct", "% do total", "pct"), _col("ticket", "Valor médio", "moeda"), _col("ultima", "Última encomenda", "data")]
    if pc:
        colunas += [_col("valor_ant", "Período de comparação", "moeda", True), _col("variacao", "Variação", "pct")]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras_h", "x": "cliente", "series": ["valor"], "max": 12}}


async def vendas_artigo(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = {}
    for e in _filtrar_cliente(await d.encomendas(), p):
        if not no_periodo(e["_dia"], p):
            continue
        for a in e.get("artigos") or []:
            k = a.get("artigo_id") or f"nome:{a.get('artigo_nome') or '—'}"
            x = g.setdefault(k, {"artigo": a.get("artigo_nome") or "—", "codigo": a.get("artigo_codigo") or "",
                                 "artigo_id": a.get("artigo_id"), "qtd": 0.0, "valor": 0.0, "encs": set()})
            x["qtd"] += float(a.get("quantidade") or 0)
            x["valor"] += _linha_valor_artigo(a)
            x["encs"].add(e["id"])
    total = sum(x["valor"] for x in g.values()) or 0
    linhas = [{"codigo": x["codigo"], "artigo": x["artigo"], "qtd": round2(x["qtd"]), "valor": round2(x["valor"]),
               "pct": round2(x["valor"] / total * 100) if total else 0.0, "n": len(x["encs"]),
               "preco_medio": round2(x["valor"] / x["qtd"]) if x["qtd"] else 0.0,
               "_link": f"/artigos/{x['artigo_id']}" if x.get("artigo_id") else None}
              for x in sorted(g.values(), key=lambda x: -x["valor"])]
    linhas = _limitar(linhas, p)
    colunas = [_col("codigo", "Código"), _col("artigo", "Artigo"), _col("qtd", "Quantidade", "numero", True),
               _col("valor", "Vendas s/ IVA", "moeda", True), _col("pct", "% do total", "pct"),
               _col("n", "Encomendas", "inteiro"), _col("preco_medio", "Preço médio", "moeda")]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras_h", "x": "artigo", "series": ["valor"], "max": 12},
            "notas": ["Valor das linhas com personalizações e descontos de linha (sem portes nem desconto global)."]}


def _origem(e: dict) -> str:
    if (e.get("origem_externa") or {}).get("canal") == "woocommerce":
        return "Loja online"
    if e.get("orcamento_id"):
        return "Orçamento"
    return "Direta"


async def vendas_origem(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = defaultdict(lambda: {"n": 0, "valor": 0.0})
    for e in _filtrar_cliente(await d.encomendas(), p):
        if no_periodo(e["_dia"], p):
            o = _origem(e)
            g[o]["n"] += 1
            g[o]["valor"] += float(e.get("valor_total") or 0)
    total = sum(x["valor"] for x in g.values()) or 0
    linhas = [{"origem": k, "n": x["n"], "valor": round2(x["valor"]), "pct": round2(x["valor"] / total * 100) if total else 0.0,
               "ticket": round2(x["valor"] / x["n"]) if x["n"] else 0.0}
              for k, x in sorted(g.items(), key=lambda kv: -kv[1]["valor"])]
    colunas = [_col("origem", "Origem"), _col("n", "Encomendas", "inteiro", True), _col("valor", "Vendas s/ IVA", "moeda", True),
               _col("pct", "% do total", "pct"), _col("ticket", "Valor médio", "moeda")]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "pizza", "x": "origem", "series": ["valor"]}}


async def faturacao_documentos(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = defaultdict(lambda: {"n_fat": 0, "faturado": 0.0, "recebido": 0.0, "n_anul": 0, "anulado": 0.0, "proformas": 0})
    for doc in await d.documentos():
        dia = _dia(doc, "data", "created_at")
        if not no_periodo(dia, p) or doc.get("estado") == "rascunho":
            continue
        if p.cliente_id and doc.get("cliente_id") != p.cliente_id:
            continue
        k = chave_periodo(dia, p.agrupar)
        tipo, total = doc.get("tipo"), float(doc.get("total") or 0)
        if doc.get("estado") == "anulada":
            if tipo in ("fatura", "fatura_recibo"):
                g[k]["n_anul"] += 1
                g[k]["anulado"] += total
            continue
        if tipo in ("fatura", "fatura_recibo"):
            g[k]["n_fat"] += 1
            g[k]["faturado"] += total
        if tipo == "fatura_recibo" or tipo == "recibo":
            g[k]["recebido"] += float(doc.get("valor_pago") or total) if tipo == "recibo" else total
        if tipo == "proforma":
            g[k]["proformas"] += 1
    linhas = []
    for k in chaves_periodo(p):
        x = g.get(k) or {"n_fat": 0, "faturado": 0.0, "recebido": 0.0, "n_anul": 0, "anulado": 0.0, "proformas": 0}
        linhas.append({"periodo": rotulo_periodo(k, p.agrupar), "n_fat": x["n_fat"], "faturado": round2(x["faturado"]),
                       "recebido": round2(x["recebido"]), "n_anul": x["n_anul"], "anulado": round2(x["anulado"]),
                       "proformas": x["proformas"]})
    colunas = [_col("periodo", "Período"), _col("n_fat", "Faturas", "inteiro", True), _col("faturado", "Faturado", "moeda", True),
               _col("recebido", "Recebido (recibos e FR)", "moeda", True), _col("n_anul", "Anuladas", "inteiro", True),
               _col("anulado", "Valor anulado", "moeda", True), _col("proformas", "Proformas", "inteiro", True)]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras", "x": "periodo", "series": ["faturado", "recebido"]},
            "notas": ["Documentos assinados/emitidos (sem rascunhos). Valores com IVA."]}


ORC_GANHO, ORC_PERDIDO = ("aceite",), ("rejeitado",)


async def orcamentos_conversao(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = defaultdict(lambda: {"n": 0, "ganhos": 0, "perdidos": 0, "abertos": 0, "valor": 0.0, "valor_ganho": 0.0})
    for o in await d.orcamentos():
        if o.get("status") == "rascunho":
            continue
        dia = _dia(o, "data", "created_at")
        if not no_periodo(dia, p) or (p.cliente_id and o.get("cliente_id") != p.cliente_id):
            continue
        k = chave_periodo(dia, p.agrupar)
        try:
            total = float(compute_orcamento_totais(o).get("total") or 0)
        except Exception:
            total = float(o.get("total") or 0)
        x = g[k]
        x["n"] += 1
        x["valor"] += total
        if o.get("status") in ORC_GANHO:
            x["ganhos"] += 1
            x["valor_ganho"] += total
        elif o.get("status") in ORC_PERDIDO:
            x["perdidos"] += 1
        else:
            x["abertos"] += 1
    linhas = []
    for k in chaves_periodo(p):
        x = g.get(k) or {"n": 0, "ganhos": 0, "perdidos": 0, "abertos": 0, "valor": 0.0, "valor_ganho": 0.0}
        dec = x["ganhos"] + x["perdidos"]
        linhas.append({"periodo": rotulo_periodo(k, p.agrupar), "n": x["n"], "ganhos": x["ganhos"], "perdidos": x["perdidos"],
                       "abertos": x["abertos"], "taxa": round2(x["ganhos"] / dec * 100) if dec else None,
                       "valor": round2(x["valor"]), "valor_ganho": round2(x["valor_ganho"])})
    colunas = [_col("periodo", "Período"), _col("n", "Orçamentos", "inteiro", True), _col("ganhos", "Ganhos", "inteiro", True),
               _col("perdidos", "Perdidos", "inteiro", True), _col("abertos", "Em aberto", "inteiro", True),
               _col("taxa", "Taxa de conversão", "pct"), _col("valor", "Valor proposto", "moeda", True),
               _col("valor_ganho", "Valor ganho", "moeda", True)]
    tot = _totais(colunas, linhas)
    dec = (tot.get("ganhos") or 0) + (tot.get("perdidos") or 0)
    tot["taxa"] = round2(tot["ganhos"] / dec * 100) if dec else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras", "x": "periodo", "series": ["valor", "valor_ganho"]},
            "notas": ["Taxa de conversão = ganhos ÷ (ganhos + perdidos). Rascunhos não contam."]}


async def clientes_novos(d: Dados, p: Params) -> dict:
    primeira: Dict[str, str] = {}
    for e in await d.encomendas():
        k = e.get("cliente_id") or e.get("cliente") or ""
        if k and (k not in primeira or e["_dia"] < primeira[k]):
            primeira[k] = e["_dia"]
    g: Dict[str, dict] = defaultdict(lambda: {"novos": set(), "recorrentes": set(), "valor_novos": 0.0, "valor_rec": 0.0})
    for e in await d.encomendas():
        if not no_periodo(e["_dia"], p):
            continue
        k = e.get("cliente_id") or e.get("cliente") or ""
        per = chave_periodo(e["_dia"], p.agrupar)
        if primeira.get(k) and chave_periodo(primeira[k], p.agrupar) == per:
            g[per]["novos"].add(k)
            g[per]["valor_novos"] += float(e.get("valor_total") or 0)
        else:
            g[per]["recorrentes"].add(k)
            g[per]["valor_rec"] += float(e.get("valor_total") or 0)
    linhas = []
    for k in chaves_periodo(p):
        x = g.get(k)
        n_novos = len(x["novos"]) if x else 0
        n_rec = len(x["recorrentes"] - x["novos"]) if x else 0
        linhas.append({"periodo": rotulo_periodo(k, p.agrupar), "novos": n_novos, "recorrentes": n_rec,
                       "valor_novos": round2(x["valor_novos"]) if x else 0.0, "valor_rec": round2(x["valor_rec"]) if x else 0.0})
    colunas = [_col("periodo", "Período"), _col("novos", "Clientes novos", "inteiro", True),
               _col("recorrentes", "Clientes que voltaram", "inteiro", True),
               _col("valor_novos", "Vendas a novos", "moeda", True), _col("valor_rec", "Vendas a recorrentes", "moeda", True)]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras", "x": "periodo", "series": ["novos", "recorrentes"]},
            "notas": ["Cliente novo = primeira encomenda nesse período."]}


async def crm_funil(d: Dados, p: Params) -> dict:
    estados = await d.estados_crm()
    g: Dict[str, dict] = defaultdict(lambda: {"n": 0, "valor": 0.0, "ganhos": 0, "perdidos": 0, "abertos": 0})
    for l in await d.leads():
        if not no_periodo(_dia(l, "created_at"), p):
            continue
        k = (l.get("origem") or "Sem origem").strip() or "Sem origem"
        tipo = (estados.get(l.get("estado_id") or "") or {}).get("tipo") or "aberto"
        x = g[k]
        x["n"] += 1
        x["valor"] += float(l.get("valor_estimado") or 0)
        x["ganhos" if tipo == "ganho" else "perdidos" if tipo == "perdido" else "abertos"] += 1
    linhas = []
    for k, x in sorted(g.items(), key=lambda kv: -kv[1]["n"]):
        dec = x["ganhos"] + x["perdidos"]
        linhas.append({"origem": k, "n": x["n"], "abertos": x["abertos"], "ganhos": x["ganhos"], "perdidos": x["perdidos"],
                       "taxa": round2(x["ganhos"] / dec * 100) if dec else None, "valor": round2(x["valor"])})
    colunas = [_col("origem", "Origem"), _col("n", "Leads", "inteiro", True), _col("abertos", "Em aberto", "inteiro", True),
               _col("ganhos", "Ganhos", "inteiro", True), _col("perdidos", "Perdidos", "inteiro", True),
               _col("taxa", "Taxa de conversão", "pct"), _col("valor", "Valor estimado", "moeda", True)]
    tot = _totais(colunas, linhas)
    dec = (tot.get("ganhos") or 0) + (tot.get("perdidos") or 0)
    tot["taxa"] = round2(tot["ganhos"] / dec * 100) if dec else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras_h", "x": "origem", "series": ["n"]}}


# ---------------------------------------------------------------------------
# Produção e custos
# ---------------------------------------------------------------------------
async def custos_encomenda(d: Dados, p: Params) -> dict:
    linhas = []
    for e in _filtrar_cliente(await d.encomendas(), p):
        if not no_periodo(e["_dia"], p):
            continue
        prev, real = float(e.get("custo_producao_estimado") or 0), float(e.get("custo_producao_real") or 0)
        if prev <= 0 and real <= 0:
            continue
        linhas.append({"numero": e.get("numero"), "cliente": e.get("cliente"), "estado": e.get("estado"),
                       "previsto": round2(prev), "real": round2(real), "desvio": round2(real - prev),
                       "desvio_pct": var_pct(real, prev), "nc": round2(e.get("custo_desperdicio_nc") or 0),
                       "_link": f"/encomendas/{e['id']}?tab=producao"})
    linhas.sort(key=lambda l: -(l["desvio"] or 0))
    linhas = _limitar(linhas, p)
    colunas = [_col("numero", "Encomenda"), _col("cliente", "Cliente"), _col("estado", "Estado"),
               _col("previsto", "Custo previsto", "moeda", True), _col("real", "Custo real", "moeda", True),
               _col("desvio", "Desvio", "moeda", True), _col("desvio_pct", "Desvio %", "pct"),
               _col("nc", "Não conformidades", "moeda", True)]
    tot = _totais(colunas, linhas)
    tot["desvio_pct"] = var_pct(tot.get("real") or 0, tot.get("previsto") or 0)
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras", "x": "numero", "series": ["previsto", "real"], "max": 15},
            "notas": ["Custo de produção das OF (máquina + mão de obra) mais o desperdício das não conformidades.",
                      "Desvio positivo = custou mais do que o previsto."]}


async def producao_operacoes(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = {}
    for o in await d.ofs():
        if not no_periodo(_dia(o, "data", "created_at"), p):
            continue
        if p.cliente_id and o.get("cliente_id") != p.cliente_id:
            continue
        for it in o.get("itens") or []:
            for op in it.get("operacoes") or []:
                maq = op.get("maquina_nome") or ""
                k = f"{op.get('nome') or '—'}|{maq}"
                x = g.setdefault(k, {"operacao": op.get("nome") or "—", "maquina": maq or "—", "n": 0, "concluidas": 0,
                                     "prev_min": 0.0, "real_min": 0.0, "custo_prev": 0.0, "custo_real": 0.0})
                x["n"] += 1
                x["concluidas"] += 1 if op.get("concluida") else 0
                x["prev_min"] += float(op.get("tempo_min") or 0)
                maq_real = op.get("tempo_maquina_real")
                maq_real = float(maq_real if maq_real is not None else (op.get("tempo_maquina") or 0))
                if op.get("concluida") or op.get("tempo_real_seg"):
                    x["real_min"] += maq_real + float(op.get("tempo_real_seg") or 0) / 60.0
                    x["custo_real"] += op_custo_real(op)
                x["custo_prev"] += float(op.get("custo_estimado") or 0)
    linhas = []
    for x in sorted(g.values(), key=lambda x: -x["prev_min"]):
        linhas.append({"operacao": x["operacao"], "maquina": x["maquina"], "n": x["n"], "concluidas": x["concluidas"],
                       "prev_h": round2(x["prev_min"] / 60), "real_h": round2(x["real_min"] / 60),
                       "desvio_pct": var_pct(x["real_min"], x["prev_min"]) if x["real_min"] else None,
                       "custo_prev": round2(x["custo_prev"]), "custo_real": round2(x["custo_real"])})
    colunas = [_col("operacao", "Operação"), _col("maquina", "Máquina"), _col("n", "Operações", "inteiro", True),
               _col("concluidas", "Concluídas", "inteiro", True), _col("prev_h", "Horas previstas", "numero", True),
               _col("real_h", "Horas reais", "numero", True), _col("desvio_pct", "Desvio %", "pct"),
               _col("custo_prev", "Custo previsto", "moeda", True), _col("custo_real", "Custo real", "moeda", True)]
    tot = _totais(colunas, linhas)
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras_h", "x": "operacao", "series": ["prev_h", "real_h"], "max": 12},
            "notas": ["Horas reais = mão de obra cronometrada + tempo de máquina (acertado, ou o previsto se não houver acerto).",
                      "Só conta o real das operações iniciadas ou concluídas."]}


async def prazos_cumprimento(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = defaultdict(lambda: {"n": 0, "no_prazo": 0, "atraso": 0, "atrasadas": 0, "a_tempo": 0, "dias": 0})
    hoje = p.hoje
    for e in _filtrar_cliente(await d.encomendas(), p):
        prazo = (e.get("prazo_entrega") or "")[:10]
        if not no_periodo(prazo, p):
            continue
        x = g[chave_periodo(prazo, p.agrupar)]
        x["n"] += 1
        entregue = (e.get("data_entrega") or "")[:10] if e.get("entregue") else ""
        if entregue:
            if entregue <= prazo:
                x["no_prazo"] += 1
            else:
                x["atraso"] += 1
                x["dias"] += (_d(entregue) - _d(prazo)).days
        elif prazo < hoje:
            x["atrasadas"] += 1
        else:
            x["a_tempo"] += 1
    linhas = []
    for k in chaves_periodo(p):
        x = g.get(k) or {"n": 0, "no_prazo": 0, "atraso": 0, "atrasadas": 0, "a_tempo": 0, "dias": 0}
        fechadas = x["no_prazo"] + x["atraso"] + x["atrasadas"]
        linhas.append({"periodo": rotulo_periodo(k, p.agrupar), "n": x["n"], "no_prazo": x["no_prazo"], "atraso": x["atraso"],
                       "atrasadas": x["atrasadas"], "a_tempo": x["a_tempo"],
                       "cumprimento": round2(x["no_prazo"] / fechadas * 100) if fechadas else None,
                       "atraso_medio": round2(x["dias"] / x["atraso"]) if x["atraso"] else None})
    colunas = [_col("periodo", "Prazo em"), _col("n", "Encomendas", "inteiro", True), _col("no_prazo", "Entregues no prazo", "inteiro", True),
               _col("atraso", "Entregues com atraso", "inteiro", True), _col("atrasadas", "Atrasadas por entregar", "inteiro", True),
               _col("a_tempo", "Ainda dentro do prazo", "inteiro", True), _col("cumprimento", "Cumprimento", "pct"),
               _col("atraso_medio", "Atraso médio (dias)", "numero")]
    tot = _totais(colunas, linhas)
    fechadas = (tot.get("no_prazo") or 0) + (tot.get("atraso") or 0) + (tot.get("atrasadas") or 0)
    tot["cumprimento"] = round2(tot["no_prazo"] / fechadas * 100) if fechadas else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras", "x": "periodo", "series": ["no_prazo", "atraso", "atrasadas"]},
            "notas": ["Agrupado pela data do prazo de entrega. Cumprimento = entregues no prazo ÷ (entregues + atrasadas)."]}


NC_TIPO_PT = {"defeito": "Defeito", "quantidade": "Quantidade", "material": "Material", "prazo": "Prazo", "outro": "Outro"}


async def nao_conformidades(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = defaultdict(lambda: {"n": 0, "abertas": 0, "fechadas": 0, "qtd": 0.0, "custo": 0.0})
    for n in await d.ncs():
        if not no_periodo(_dia(n, "created_at"), p):
            continue
        x = g[NC_TIPO_PT.get(n.get("tipo"), n.get("tipo") or "Outro")]
        x["n"] += 1
        x["fechadas" if n.get("estado") == "fechada" else "abertas"] += 1
        x["qtd"] += float(n.get("quantidade") or 0)
        x["custo"] += float(n.get("custo_desperdicio") or 0)
    linhas = [{"tipo": k, "n": x["n"], "abertas": x["abertas"], "fechadas": x["fechadas"], "qtd": round2(x["qtd"]),
               "custo": round2(x["custo"])} for k, x in sorted(g.items(), key=lambda kv: -kv[1]["n"])]
    colunas = [_col("tipo", "Tipo"), _col("n", "Não conformidades", "inteiro", True), _col("abertas", "Abertas", "inteiro", True),
               _col("fechadas", "Fechadas", "inteiro", True), _col("qtd", "Unidades afetadas", "numero", True),
               _col("custo", "Custo do desperdício", "moeda", True)]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "pizza", "x": "tipo", "series": ["n"]}}


# ---------------------------------------------------------------------------
# Recebimentos
# ---------------------------------------------------------------------------
async def a_receber(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = {}
    ref = _d(p.ate)
    for e in _filtrar_cliente(await d.encomendas(), p):
        falta = float(e.get("valor_pendente") or 0)
        if falta <= 0.009 or not e["_dia"] or e["_dia"] > p.ate:
            continue
        dias = (ref - _d(e["_dia"])).days
        b = "b0" if dias <= 30 else "b30" if dias <= 60 else "b60" if dias <= 90 else "b90"
        k = e.get("cliente_id") or f"nome:{e.get('cliente')}"
        x = g.setdefault(k, {"cliente": e.get("cliente") or "—", "cliente_id": e.get("cliente_id"), "n": 0,
                             "b0": 0.0, "b30": 0.0, "b60": 0.0, "b90": 0.0, "total": 0.0, "mais_antiga": e["_dia"]})
        x["n"] += 1
        x[b] += falta
        x["total"] += falta
        x["mais_antiga"] = min(x["mais_antiga"], e["_dia"])
    linhas = [{**{k: (round2(v) if isinstance(v, float) else v) for k, v in x.items() if k != "cliente_id"},
               "_link": f"/clientes/{x['cliente_id']}" if x.get("cliente_id") else None}
              for x in sorted(g.values(), key=lambda x: -x["total"])]
    linhas = _limitar(linhas, p)
    colunas = [_col("cliente", "Cliente"), _col("n", "Encomendas", "inteiro", True), _col("b0", "Até 30 dias", "moeda", True),
               _col("b30", "31–60 dias", "moeda", True), _col("b60", "61–90 dias", "moeda", True),
               _col("b90", "Mais de 90 dias", "moeda", True), _col("total", "Total em falta", "moeda", True),
               _col("mais_antiga", "Encomenda mais antiga", "data")]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras_h", "x": "cliente", "series": ["total"], "max": 12},
            "notas": [f"Situação a {rotulo_periodo(p.ate, 'dia')}: antiguidade contada desde a data da encomenda. Valores c/ IVA."]}


async def recebimentos_metodo(d: Dados, p: Params) -> dict:
    g: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    usados = set()
    for e in _filtrar_cliente(await d.encomendas(), p):
        for pg in (e["_orig"].get("pagamentos") or []):
            dia = _dia(pg, "data", "created_at")
            if not no_periodo(dia, p):
                continue
            m = pg.get("metodo") or "outro"
            usados.add(m)
            v = float(pg.get("valor") or 0) * (-1 if pg.get("tipo") == "devolucao" else 1)
            g[chave_periodo(dia, p.agrupar)][m] += v
    metodos = [m for m in METODOS_PT if m in usados] + sorted(usados - set(METODOS_PT))
    linhas = []
    for k in chaves_periodo(p):
        x = g.get(k) or {}
        l = {"periodo": rotulo_periodo(k, p.agrupar)}
        for m in metodos:
            l[m] = round2(x.get(m, 0.0))
        l["total"] = round2(sum(x.values()))
        linhas.append(l)
    colunas = [_col("periodo", "Período")] + [_col(m, METODOS_PT.get(m, m), "moeda", True) for m in metodos] + \
              [_col("total", "Total recebido", "moeda", True)]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras_empilhadas", "x": "periodo", "series": metodos},
            "notas": ["Pagamentos registados nas encomendas (devoluções a descontar)."]}


async def pagamentos_por_faturar(d: Dados, p: Params) -> dict:
    docs = {x["id"]: x for x in await d.documentos()}
    linhas = []
    for e in _filtrar_cliente(await d.encomendas(), p):
        for pg in (e["_orig"].get("pagamentos") or []):
            dia = _dia(pg, "data", "created_at")
            if pg.get("tipo") == "devolucao" or pg.get("origem") == "fatura" or not dia or dia > p.ate or dia < p.de:
                continue
            doc = docs.get(pg.get("documento_id") or "")
            if doc and doc.get("estado") != "anulada":
                if doc.get("estado") != "rascunho":
                    continue
            linhas.append({"data": dia, "recibo": pg.get("recibo_numero") or "", "cliente": e.get("cliente"),
                           "encomenda": e.get("numero"), "metodo": METODOS_PT.get(pg.get("metodo"), pg.get("metodo") or ""),
                           "situacao": "Rascunho" if doc and doc.get("estado") == "rascunho" else "Sem fatura",
                           "valor": round2(pg.get("valor") or 0), "_link": f"/pagamentos/{e['id']}/{pg.get('id')}"})
    linhas.sort(key=lambda l: l["data"])
    colunas = [_col("data", "Data", "data"), _col("recibo", "Recibo"), _col("cliente", "Cliente"), _col("encomenda", "Encomenda"),
               _col("metodo", "Método"), _col("situacao", "Situação"), _col("valor", "Valor", "moeda", True)]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas), "grafico": None,
            "notas": ["Pagamentos recebidos que ainda não têm fatura emitida (ou só em rascunho)."]}


# ---------------------------------------------------------------------------
# Compras e margens
# ---------------------------------------------------------------------------
async def compras_fornecedor(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = {}
    for o in await d.compras():
        if not no_periodo(_dia(o, "data", "created_at"), p):
            continue
        k = o.get("fornecedor_id") or f"nome:{o.get('fornecedor_nome') or '—'}"
        x = g.setdefault(k, {"fornecedor": o.get("fornecedor_nome") or "—", "fornecedor_id": o.get("fornecedor_id"),
                             "n": 0, "total": 0.0, "recebidas": 0, "por_receber": 0.0, "pago": 0.0})
        tot = float(o.get("total") or 0)
        x["n"] += 1
        x["total"] += tot
        x["pago"] += float(o.get("valor_pago") or 0)
        if o.get("estado") == "recebida":
            x["recebidas"] += 1
        else:
            x["por_receber"] += tot
    total = sum(x["total"] for x in g.values()) or 0
    linhas = [{"fornecedor": x["fornecedor"], "n": x["n"], "total": round2(x["total"]),
               "pct": round2(x["total"] / total * 100) if total else 0.0, "recebidas": x["recebidas"],
               "por_receber": round2(x["por_receber"]), "pago": round2(x["pago"]),
               "divida": round2(max(0.0, x["total"] - x["pago"])),
               "_link": f"/fornecedores/{x['fornecedor_id']}" if x.get("fornecedor_id") else None}
              for x in sorted(g.values(), key=lambda x: -x["total"])]
    linhas = _limitar(linhas, p)
    colunas = [_col("fornecedor", "Fornecedor"), _col("n", "Ordens de compra", "inteiro", True), _col("total", "Total", "moeda", True),
               _col("pct", "% do total", "pct"), _col("recebidas", "Recebidas", "inteiro", True),
               _col("por_receber", "Por receber (material)", "moeda", True), _col("pago", "Pago", "moeda", True),
               _col("divida", "Em dívida", "moeda", True)]
    return {"colunas": colunas, "linhas": linhas, "totais": _totais(colunas, linhas),
            "grafico": {"tipo": "barras_h", "x": "fornecedor", "series": ["total"], "max": 12}}


async def resultado_periodo(d: Dados, p: Params) -> dict:
    vendas = await _serie_vendas(d, p)
    compras: Dict[str, float] = defaultdict(float)
    for o in await d.compras():
        dia = _dia(o, "data", "created_at")
        if no_periodo(dia, p):
            compras[chave_periodo(dia, p.agrupar)] += float(o.get("total") or 0)
    custo: Dict[str, float] = defaultdict(float)
    for e in await d.encomendas():
        if no_periodo(e["_dia"], p):
            custo[chave_periodo(e["_dia"], p.agrupar)] += float(e.get("custo_producao_real") or 0)
    linhas = []
    for k in chaves_periodo(p):
        v = round2((vendas.get(k) or {}).get("valor", 0.0))
        c = round2(compras.get(k, 0.0))
        cp = round2(custo.get(k, 0.0))
        linhas.append({"periodo": rotulo_periodo(k, p.agrupar), "vendas": v, "compras": c, "custo_producao": cp,
                       "resultado": round2(v - c - cp), "margem": round2((v - c - cp) / v * 100) if v else None})
    colunas = [_col("periodo", "Período"), _col("vendas", "Vendas s/ IVA", "moeda", True), _col("compras", "Compras e despesas", "moeda", True),
               _col("custo_producao", "Custo de produção (OF)", "moeda", True), _col("resultado", "Resultado", "moeda", True),
               _col("margem", "Margem", "pct")]
    tot = _totais(colunas, linhas)
    tot["margem"] = round2(tot["resultado"] / tot["vendas"] * 100) if tot.get("vendas") else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras", "x": "periodo", "series": ["vendas", "compras", "resultado"]},
            "notas": ["Indicativo (não é contabilidade): vendas das encomendas − ordens de compra − custo das OF.",
                      "As compras de material também podem estar refletidas no custo das OF; leia o resultado como tendência."]}


async def resultado_centro_custo(d: Dados, p: Params) -> dict:
    """Vendas (pela categoria do artigo → centro de custo) e compras/despesas (centro da OC) por centro de custo."""
    from app.repositories import artigos_repo, categorias_repo
    cats = {c["id"]: c.get("centro_custo") or "" for c in await categorias_repo.find({}, limit=5000)}
    arts = {a["id"]: cats.get(a.get("categoria_id"), "") for a in await artigos_repo.find({}, limit=50000,
                                                                                         projection={"id": 1, "categoria_id": 1})}
    g: Dict[str, dict] = defaultdict(lambda: {"vendas": 0.0, "custo_producao": 0.0, "compras": 0.0})
    for e in _filtrar_cliente(await d.encomendas(), p):
        if not no_periodo(e["_dia"], p):
            continue
        linhas = (e.get("_orig") or {}).get("artigos") or e.get("artigos") or []
        bruto = sum(_linha_valor_artigo(a) for a in linhas) or 1
        valor = float(e.get("valor_total") or 0)
        custo = float(e.get("custo_producao_real") or 0)
        for a in linhas:
            peso = _linha_valor_artigo(a) / bruto
            cc = arts.get(a.get("artigo_id"), "") or "Sem centro"
            g[cc]["vendas"] += valor * peso
            g[cc]["custo_producao"] += custo * peso
    for o in await d.compras():
        if no_periodo(_dia(o, "data", "created_at"), p) and o.get("tipo_despesa") != "compra":
            g[o.get("centro_custo") or "Sem centro"]["compras"] += float(o.get("total") or 0)
    linhas = []
    for cc, v in g.items():
        r = v["vendas"] - v["custo_producao"] - v["compras"]
        linhas.append({"centro": cc, "vendas": round2(v["vendas"]), "custo_producao": round2(v["custo_producao"]),
                       "compras": round2(v["compras"]), "resultado": round2(r),
                       "margem": round2(r / v["vendas"] * 100) if v["vendas"] else None})
    linhas.sort(key=lambda l: -l["vendas"])
    colunas = [_col("centro", "Centro de custo"), _col("vendas", "Vendas s/ IVA", "moeda", True),
               _col("custo_producao", "Custo de produção", "moeda", True), _col("compras", "Despesas", "moeda", True),
               _col("resultado", "Resultado", "moeda", True), _col("margem", "Margem", "pct")]
    tot = _totais(colunas, linhas)
    tot["margem"] = round2(tot["resultado"] / tot["vendas"] * 100) if tot.get("vendas") else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras", "x": "centro", "series": ["vendas", "resultado"]},
            "notas": ["O centro de custo das vendas vem da categoria do artigo (Relatórios → Objetivos → Centros de custo).",
                      "Despesas = ordens de compra que não são compra de material (essas já entram no custo de produção)."]}


async def margem_encomenda(d: Dados, p: Params) -> dict:
    linhas = []
    for e in _filtrar_cliente(await d.encomendas(), p):
        if not no_periodo(e["_dia"], p):
            continue
        v, c = float(e.get("valor_total") or 0), float(e.get("custo_producao_real") or 0)
        linhas.append({"numero": e.get("numero"), "data": e["_dia"], "cliente": e.get("cliente"), "valor": round2(v),
                       "custo": round2(c), "margem": round2(v - c), "margem_pct": round2((v - c) / v * 100) if v else None,
                       "_link": f"/encomendas/{e['id']}"})
    linhas.sort(key=lambda l: (l["margem_pct"] is None, l["margem_pct"] if l["margem_pct"] is not None else 0))
    linhas = _limitar(linhas, p)
    colunas = [_col("numero", "Encomenda"), _col("data", "Data", "data"), _col("cliente", "Cliente"),
               _col("valor", "Venda s/ IVA", "moeda", True), _col("custo", "Custo real", "moeda", True),
               _col("margem", "Margem", "moeda", True), _col("margem_pct", "Margem %", "pct")]
    tot = _totais(colunas, linhas)
    tot["margem_pct"] = round2(tot["margem"] / tot["valor"] * 100) if tot.get("valor") else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot, "grafico": None,
            "notas": ["Ordenado da pior para a melhor margem. Custo real = OF + desperdício das não conformidades."]}


async def margem_cliente(d: Dados, p: Params) -> dict:
    g: Dict[str, dict] = {}
    for e in _filtrar_cliente(await d.encomendas(), p):
        if not no_periodo(e["_dia"], p):
            continue
        k = e.get("cliente_id") or f"nome:{e.get('cliente')}"
        x = g.setdefault(k, {"cliente": e.get("cliente") or "—", "cliente_id": e.get("cliente_id"), "n": 0, "valor": 0.0, "custo": 0.0})
        x["n"] += 1
        x["valor"] += float(e.get("valor_total") or 0)
        x["custo"] += float(e.get("custo_producao_real") or 0)
    linhas = [{"cliente": x["cliente"], "n": x["n"], "valor": round2(x["valor"]), "custo": round2(x["custo"]),
               "margem": round2(x["valor"] - x["custo"]),
               "margem_pct": round2((x["valor"] - x["custo"]) / x["valor"] * 100) if x["valor"] else None,
               "_link": f"/clientes/{x['cliente_id']}" if x.get("cliente_id") else None}
              for x in sorted(g.values(), key=lambda x: -(x["valor"] - x["custo"]))]
    linhas = _limitar(linhas, p)
    colunas = [_col("cliente", "Cliente"), _col("n", "Encomendas", "inteiro", True), _col("valor", "Venda s/ IVA", "moeda", True),
               _col("custo", "Custo real", "moeda", True), _col("margem", "Margem", "moeda", True), _col("margem_pct", "Margem %", "pct")]
    tot = _totais(colunas, linhas)
    tot["margem_pct"] = round2(tot["margem"] / tot["valor"] * 100) if tot.get("valor") else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot,
            "grafico": {"tipo": "barras_h", "x": "cliente", "series": ["margem"], "max": 12}}


async def margem_artigo(d: Dados, p: Params) -> dict:
    encs = [e for e in _filtrar_cliente(await d.encomendas(), p) if no_periodo(e["_dia"], p)]
    ids = {e["id"] for e in encs}
    g: Dict[str, dict] = {}
    for e in encs:
        for a in e.get("artigos") or []:
            k = a.get("artigo_id") or f"nome:{a.get('artigo_nome')}"
            x = g.setdefault(k, {"artigo": a.get("artigo_nome") or "—", "codigo": a.get("artigo_codigo") or "",
                                 "artigo_id": a.get("artigo_id"), "qtd": 0.0, "valor": 0.0, "custo": 0.0})
            x["qtd"] += float(a.get("quantidade") or 0)
            x["valor"] += _linha_valor_artigo(a)
    for o in await d.ofs():
        if o.get("encomenda_id") not in ids:
            continue
        for it in o.get("itens") or []:
            x = g.get(it.get("artigo_id") or "")
            if x is not None:
                x["custo"] += sum(op_custo_real(op) for op in it.get("operacoes") or [])
    linhas = [{"codigo": x["codigo"], "artigo": x["artigo"], "qtd": round2(x["qtd"]), "valor": round2(x["valor"]),
               "custo": round2(x["custo"]), "margem": round2(x["valor"] - x["custo"]),
               "margem_pct": round2((x["valor"] - x["custo"]) / x["valor"] * 100) if x["valor"] else None,
               "_link": f"/artigos/{x['artigo_id']}" if x.get("artigo_id") else None}
              for x in sorted(g.values(), key=lambda x: -x["valor"])]
    linhas = _limitar(linhas, p)
    colunas = [_col("codigo", "Código"), _col("artigo", "Artigo"), _col("qtd", "Quantidade", "numero", True),
               _col("valor", "Venda s/ IVA", "moeda", True), _col("custo", "Custo de produção", "moeda", True),
               _col("margem", "Margem", "moeda", True), _col("margem_pct", "Margem %", "pct")]
    tot = _totais(colunas, linhas)
    tot["margem_pct"] = round2(tot["margem"] / tot["valor"] * 100) if tot.get("valor") else None
    return {"colunas": colunas, "linhas": linhas, "totais": tot, "grafico": None,
            "notas": ["Custo = operações das OF desse artigo (máquina + mão de obra). Artigos de revenda sem OF aparecem sem custo."]}


# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------
AREAS = [
    {"id": "vendas", "label": "Vendas e faturação"},
    {"id": "producao", "label": "Produção e custos"},
    {"id": "recebimentos", "label": "Recebimentos"},
    {"id": "compras", "label": "Compras e margens"},
    {"id": "comercial", "label": "Clientes e comercial"},
]

RELATORIOS: Dict[str, dict] = {
    "vendas_periodo": {"area": "vendas", "titulo": "Vendas por período", "fn": vendas_periodo, "tempo": True, "comparar": True,
                       "descricao": "Encomendas e valor vendido por dia, semana, mês, trimestre ou ano, com comparação."},
    "vendas_cliente": {"area": "vendas", "titulo": "Vendas por cliente", "fn": vendas_cliente, "comparar": True, "ranking": True,
                       "descricao": "Ranking de clientes: valor, peso no total e última encomenda."},
    "vendas_artigo": {"area": "vendas", "titulo": "Vendas por artigo", "fn": vendas_artigo, "ranking": True,
                      "descricao": "Quantidades e valor vendido por artigo."},
    "vendas_origem": {"area": "vendas", "titulo": "Vendas por origem", "fn": vendas_origem,
                      "descricao": "Loja online, orçamentos e encomendas diretas."},
    "faturacao_documentos": {"area": "vendas", "titulo": "Faturação emitida", "fn": faturacao_documentos, "tempo": True,
                             "descricao": "Faturas, recebimentos, anulações e proformas por período."},
    "custos_encomenda": {"custos": True, "area": "producao", "titulo": "Custo previsto vs real", "fn": custos_encomenda, "ranking": True,
                         "descricao": "Desvios de custo de produção por encomenda."},
    "producao_operacoes": {"custos": True, "area": "producao", "titulo": "Tempos por operação e máquina", "fn": producao_operacoes,
                           "descricao": "Horas previstas e reais, desvios e custos por operação."},
    "prazos_cumprimento": {"area": "producao", "titulo": "Cumprimento de prazos", "fn": prazos_cumprimento, "tempo": True,
                           "descricao": "Entregas no prazo, com atraso e atrasadas por entregar."},
    "nao_conformidades": {"area": "producao", "titulo": "Não conformidades", "fn": nao_conformidades,
                          "descricao": "Por tipo: abertas, fechadas e custo do desperdício."},
    "a_receber": {"area": "recebimentos", "titulo": "A receber por antiguidade", "fn": a_receber, "ranking": True, "so_ate": True,
                  "descricao": "Valores em falta por cliente, em escalões de 30 dias."},
    "recebimentos_metodo": {"area": "recebimentos", "titulo": "Recebimentos por método", "fn": recebimentos_metodo, "tempo": True,
                            "descricao": "Dinheiro recebido por período e método de pagamento."},
    "pagamentos_por_faturar": {"area": "recebimentos", "titulo": "Pagamentos por faturar", "fn": pagamentos_por_faturar,
                               "descricao": "Recebimentos sem fatura emitida."},
    "compras_fornecedor": {"area": "compras", "titulo": "Compras por fornecedor", "fn": compras_fornecedor, "ranking": True,
                           "descricao": "Ordens de compra, material por receber e valores em dívida."},
    "resultado_periodo": {"custos": True, "area": "compras", "titulo": "Vendas vs compras", "fn": resultado_periodo, "tempo": True,
                          "descricao": "Vendas, compras, custo de produção e resultado indicativo por período."},
    "resultado_centro_custo": {"custos": True, "area": "compras", "titulo": "Resultado por centro de custo", "fn": resultado_centro_custo,
                               "descricao": "Vendas, custo de produção, despesas e margem por área de negócio (centro de custo)."},
    "margem_encomenda": {"custos": True, "area": "compras", "titulo": "Margem por encomenda", "fn": margem_encomenda, "ranking": True,
                         "descricao": "Venda, custo real e margem de cada encomenda."},
    "margem_cliente": {"custos": True, "area": "compras", "titulo": "Margem por cliente", "fn": margem_cliente, "ranking": True,
                       "descricao": "Rentabilidade por cliente."},
    "margem_artigo": {"custos": True, "area": "compras", "titulo": "Margem por artigo", "fn": margem_artigo, "ranking": True,
                      "descricao": "Venda e custo de produção por artigo."},
    "orcamentos_conversao": {"area": "comercial", "titulo": "Conversão de orçamentos", "fn": orcamentos_conversao, "tempo": True,
                             "descricao": "Orçamentos ganhos, perdidos e taxa de conversão."},
    "clientes_novos": {"area": "comercial", "titulo": "Clientes novos e recorrentes", "fn": clientes_novos, "tempo": True,
                       "descricao": "Quantos clientes novos e quantos voltaram a comprar."},
    "crm_funil": {"area": "comercial", "titulo": "Leads por origem", "fn": crm_funil,
                  "descricao": "Leads do CRM por origem, conversão e valor estimado."},
}


def catalogo() -> dict:
    return {
        "areas": AREAS,
        "relatorios": [{"id": k, **{x: v for x, v in r.items() if x != "fn"}} for k, r in RELATORIOS.items()],
    }


async def gerar(rid: str, p: Params) -> dict:
    r = RELATORIOS.get(rid)
    if not r:
        raise HTTPException(404, "Relatório desconhecido")
    out = await r["fn"](Dados(), p)
    out.setdefault("notas", [])
    out.update({
        "id": rid, "titulo": r["titulo"], "descricao": r["descricao"], "area": r["area"],
        "parametros": {"de": p.de, "ate": p.ate, "agrupar": p.agrupar, "comparar": p.comparar, "cliente_id": p.cliente_id},
    })
    if p.comparar and (pc := periodo_comparacao(p)):
        out["parametros"]["comparacao"] = {"de": pc.de, "ate": pc.ate}
    return out


# ---------------------------------------------------------------------------
# Exportação
# ---------------------------------------------------------------------------
def _fmt(v: Any, tipo: str) -> str:
    if v is None or v == "":
        return "—"
    if tipo == "moeda":
        return f"{float(v):,.2f} €".replace(",", " ").replace(".", ",")
    if tipo == "pct":
        return f"{float(v):,.1f}%".replace(".", ",")
    if tipo == "inteiro":
        return f"{int(round(float(v))):,}".replace(",", " ")
    if tipo == "numero":
        return f"{float(v):,.2f}".replace(",", " ").replace(".", ",").rstrip("0").rstrip(",")
    if tipo == "data":
        s = str(v)[:10]
        return f"{s[8:10]}/{s[5:7]}/{s[:4]}" if len(s) == 10 else s
    return str(v)


def _subtitulo(rel: dict) -> str:
    pr = rel["parametros"]
    t = f"Período: {_fmt(pr['de'], 'data')} a {_fmt(pr['ate'], 'data')}"
    if pr.get("comparacao"):
        t += f" · comparado com {_fmt(pr['comparacao']['de'], 'data')} a {_fmt(pr['comparacao']['ate'], 'data')}"
    return t


def exportar_xlsx(rel: dict, empresa: str = "") -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = rel["titulo"][:31]
    cols = rel["colunas"]
    ws.append([rel["titulo"]])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([f"{empresa + ' · ' if empresa else ''}{_subtitulo(rel)}"])
    ws["A2"].font = Font(color="6B7280")
    ws.append([])
    ws.append([c["label"] for c in cols])
    head = ws.max_row
    fill = PatternFill("solid", fgColor="111827")
    for i in range(1, len(cols) + 1):
        cell = ws.cell(row=head, column=i)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = fill
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    formatos = {"moeda": '#,##0.00 "€"', "pct": '0.0"%"', "numero": "#,##0.00", "inteiro": "0", "data": "DD/MM/YYYY"}
    for l in rel["linhas"]:
        linha = []
        for c in cols:
            v = l.get(c["key"])
            if c["tipo"] == "data" and v:
                try:
                    v = date.fromisoformat(str(v)[:10])
                except ValueError:
                    pass
            linha.append(v)
        ws.append(linha)
        for i, c in enumerate(cols, start=1):
            if c["tipo"] in formatos:
                ws.cell(row=ws.max_row, column=i).number_format = formatos[c["tipo"]]
    if rel.get("totais"):
        tot = ["Total"] + [rel["totais"].get(c["key"]) for c in cols[1:]]
        ws.append(tot)
        r = ws.max_row
        for i, c in enumerate(cols, start=1):
            cell = ws.cell(row=r, column=i)
            cell.font = Font(bold=True)
            cell.border = Border(top=Side(style="thin"))
            if c["tipo"] in formatos and i > 1:
                cell.number_format = formatos[c["tipo"]]
    for n in rel.get("notas") or []:
        ws.append([])
        ws.append([n])
        ws.cell(row=ws.max_row, column=1).font = Font(italic=True, color="6B7280")
    for i, c in enumerate(cols, start=1):
        largura = max([len(c["label"])] + [len(_fmt(l.get(c["key"]), c["tipo"])) for l in rel["linhas"][:500]] + [8])
        ws.column_dimensions[get_column_letter(i)].width = min(48, largura + 3)
    ws.freeze_panes = ws.cell(row=head + 1, column=1)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def exportar_pdf(rel: dict, empresa: str = "") -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = BytesIO()
    pagina = landscape(A4) if len(rel["colunas"]) > 5 else A4
    doc = SimpleDocTemplate(buf, pagesize=pagina, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
                            title=rel["titulo"])
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=19)
    sub = ParagraphStyle("sub", fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#6B7280"), leading=11)
    cel = ParagraphStyle("cel", fontName="Helvetica", fontSize=8, leading=10)
    th = ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=colors.white)
    nota = ParagraphStyle("nota", fontName="Helvetica-Oblique", fontSize=7.5, leading=10, textColor=colors.HexColor("#6B7280"))
    els = [Paragraph(rel["titulo"], h1), Paragraph(f"{empresa + ' · ' if empresa else ''}{_subtitulo(rel)}", sub), Spacer(1, 5 * mm)]
    cols = rel["colunas"]
    direita = {i for i, c in enumerate(cols) if c["tipo"] != "texto" and c["tipo"] != "data"}
    cel_r = ParagraphStyle("celr", parent=cel, alignment=2)
    th_r = ParagraphStyle("thr", parent=th, alignment=2)
    tb = ParagraphStyle("tb", parent=cel, fontName="Helvetica-Bold")
    tb_r = ParagraphStyle("tbr", parent=tb, alignment=2)

    def esc(t: str) -> str:
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    dados = [[Paragraph(esc(c["label"]), th_r if i in direita else th) for i, c in enumerate(cols)]]
    for l in rel["linhas"][:2000]:
        dados.append([Paragraph(esc(_fmt(l.get(c["key"]), c["tipo"])), cel_r if i in direita else cel) for i, c in enumerate(cols)])
    if rel.get("totais"):
        dados.append([Paragraph("Total", tb)] + [
            Paragraph(esc(_fmt(rel["totais"].get(c["key"]), c["tipo"])) if c["key"] in rel["totais"] else "", tb_r if i in direita else tb)
            for i, c in enumerate(cols) if i > 0])
    largura = pagina[0] - 24 * mm
    pesos = [2.2 if c["tipo"] == "texto" else 1.0 for c in cols]
    t = Table(dados, colWidths=[largura * w / sum(pesos) for w in pesos], repeatRows=1)
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if rel.get("totais"):
        estilo.append(("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.HexColor("#111827")))
    t.setStyle(TableStyle(estilo))
    els.append(t)
    for n in rel.get("notas") or []:
        els += [Spacer(1, 2 * mm), Paragraph(n, nota)]
    gerado = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")

    def rodape(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#9CA3AF"))
        canvas.drawString(12 * mm, 7 * mm, f"Gerado em {gerado} UTC")
        canvas.drawRightString(pagina[0] - 12 * mm, 7 * mm, f"Página {d.page}")
        canvas.restoreState()

    doc.build(els, onFirstPage=rodape, onLaterPages=rodape)
    return buf.getvalue()


async def nome_empresa() -> str:
    s = await empresa_repo.find_one({"id": "empresa"}) or {}
    return s.get("nome") or ""
