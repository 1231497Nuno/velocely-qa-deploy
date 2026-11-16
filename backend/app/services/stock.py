"""Stock: movimentos, receções das ordens de compra, conferência da fatura do fornecedor, sugestões de compra e inventário.

- O stock vive em `artigo.qtd_stock` (unidade de stock = `artigo.unidade`); cada alteração gera um movimento.
- Unidade de compra: `artigo.unidade_compra` + `artigo.fator_compra` (ex.: compra em «rolo», stock em «m», fator 50).
- `artigo.custo_medio`: custo médio ponderado das entradas (inclui portes repartidos) — usado na valorização do inventário.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import (
    artigos_repo, encomendas_repo, inventarios_repo, movimentos_stock_repo, ordens_compra_repo,
)
from app.services import audit

TIPOS_SEM_STOCK = ("servico", "inativo", "nao_utilizado")


def _quem(user: Optional[dict]) -> dict:
    return {"id": (user or {}).get("id"), "nome": (user or {}).get("name") or (user or {}).get("nome") or ""}


def gere_stock(a: dict) -> bool:
    """Só os artigos marcados «Gere stock» têm movimentos, inventário e sugestões de compra."""
    return bool(a.get("gere_stock")) and a.get("tipo_artigo") != "servico"


async def migrar_gere_stock() -> int:
    """Uma vez: artigos antigos sem o campo ficam a gerir stock se já tinham quantidade ou nível de reabastecimento."""
    n = 0
    for a in await artigos_repo.find({"gere_stock": {"$exists": False}}, limit=50000):
        sim = a.get("tipo_artigo") != "servico" and (
            abs(float(a.get("qtd_stock") or 0)) > 1e-9 or float(a.get("nivel_reabastecimento") or 0) > 0)
        await artigos_repo.update(a["id"], {"gere_stock": sim})
        n += 1
    return n


async def movimentar(artigo_id: str, delta: float, tipo: str, *, origem: Optional[dict] = None, custo_unit: Optional[float] = None,
                     user: Optional[dict] = None, data: Optional[str] = None, nota: str = "") -> Optional[dict]:
    """Altera o stock do artigo (só se gere stock) e regista o movimento. Entradas com custo atualizam o custo médio."""
    if not artigo_id or abs(delta) < 1e-12:
        return None
    a = await artigos_repo.get(artigo_id)
    if not a or not gere_stock(a):
        return None  # artigo sem gestão de stock: não mexe na quantidade
    antes = float(a.get("qtd_stock") or 0)
    depois = round2(antes + delta)
    patch: Dict[str, Any] = {"qtd_stock": depois, "woo_pendente": True}
    if delta > 0 and custo_unit is not None and custo_unit >= 0:
        cm = float(a.get("custo_medio") or a.get("custo_artigo") or 0)
        base = max(antes, 0.0)
        patch["custo_medio"] = round((cm * base + custo_unit * delta) / (base + delta), 4) if base + delta > 0 else custo_unit
        if tipo == "entrada":
            patch["qtd_ultima_compra"] = round2(delta)
    await artigos_repo.update(artigo_id, patch)
    m = {"id": new_id(), "artigo_id": artigo_id, "artigo_nome": a.get("nome") or "", "artigo_codigo": a.get("codigo") or "",
         "tipo": tipo, "quantidade": round2(delta), "saldo": depois, "custo_unit": custo_unit, "origem": origem or {},
         "nota": nota, "data": (data or now_iso())[:10], "por": _quem(user), "created_at": now_iso()}
    await movimentos_stock_repo.insert(m)
    return m


# ---------------------------------------------------------------------------
# Receções da ordem de compra
# ---------------------------------------------------------------------------
def _valor_linha(l: dict, qtd: Optional[float] = None) -> float:
    q = float(l.get("quantidade") or 0) if qtd is None else qtd
    return round2(q * float(l.get("preco_unit") or 0) * (1 - float(l.get("desconto") or 0) / 100))


def resumo_oc(oc: dict) -> dict:
    linhas = oc.get("linhas") or []
    tot_q = sum(float(l.get("quantidade") or 0) for l in linhas)
    rec_q = sum(min(float(l.get("qtd_recebida") or 0), float(l.get("quantidade") or 0)) for l in linhas)
    return {"recebido_pct": round2(rec_q / tot_q * 100) if tot_q else 0.0,
            "valor_recebido": round2(sum(_valor_linha(l, float(l.get("qtd_recebida") or 0)) for l in linhas)),
            "completa": bool(linhas) and all(float(l.get("qtd_recebida") or 0) + 1e-9 >= float(l.get("quantidade") or 0) for l in linhas)}


async def receber(oid: str, dados: dict, user: dict) -> dict:
    oc = await ordens_compra_repo.get(oid)
    if not oc:
        raise HTTPException(404, "Ordem de compra não encontrada")
    if oc.get("estado") == "cancelada":
        raise HTTPException(400, "Ordem de compra cancelada")
    from app.services import workflow
    await workflow.exigir_aprovacao_oc(oc, user, "receber a ordem de compra")
    linhas = [dict(l) for l in oc.get("linhas") or []]
    por_id = {l.get("id"): l for l in linhas}
    data = (dados.get("data") or now_iso())[:10]
    itens = []
    for r in dados.get("linhas") or []:
        q = round2(float(r.get("quantidade") or 0))
        if q <= 0:
            continue
        l = por_id.get(r.get("linha_id"))
        if not l:
            raise HTTPException(400, "Linha da ordem de compra inválida")
        falta = float(l.get("quantidade") or 0) - float(l.get("qtd_recebida") or 0)
        if q > falta + 1e-9 and not dados.get("aceitar_excesso"):
            raise HTTPException(400, f"«{l.get('artigo_nome') or l.get('nome')}»: faltam receber {max(falta, 0):g}. "
                                     "Marque «aceitar a mais» se o fornecedor mandou mais.")
        l["qtd_recebida"] = round2(float(l.get("qtd_recebida") or 0) + q)
        mov = None
        if l.get("artigo_id"):
            a = await artigos_repo.get(l["artigo_id"]) or {}
            fator = float(a.get("fator_compra") or 1) or 1
            preco = float(l.get("preco_unit") or 0) * (1 - float(l.get("desconto") or 0) / 100)
            mov = await movimentar(l["artigo_id"], q * fator, "entrada", origem={"tipo": "oc", "id": oid, "numero": oc.get("codigo")},
                                   custo_unit=round(preco / fator, 4), user=user, data=data)
        itens.append({"linha_id": l["id"], "descricao": l.get("artigo_nome") or l.get("nome") or "", "quantidade": q,
                      "movimento_id": (mov or {}).get("id")})
    if not itens:
        raise HTTPException(400, "Indique as quantidades recebidas")
    rec = {"id": new_id(), "data": data, "guia_fornecedor": (dados.get("guia_fornecedor") or "").strip(),
           "notas": (dados.get("notas") or "").strip(), "linhas": itens, "por": _quem(user), "created_at": now_iso()}
    patch = {"linhas": linhas, "rececoes": (oc.get("rececoes") or []) + [rec]}
    oc2 = {**oc, **patch}
    if resumo_oc(oc2)["completa"] and oc.get("estado") != "recebida":
        patch["estado"] = "recebida"
    await ordens_compra_repo.update(oid, patch)
    await audit.registar("ordem_compra", oid, "editado", user,
                         f"Receção na OC {oc.get('codigo')}: " + ", ".join(f"{i['quantidade']:g} {i['descricao']}" for i in itens),
                         oc.get("codigo"))
    return {**oc2, **patch, "resumo": resumo_oc({**oc2, **patch})}


async def fatura_fornecedor(oid: str, dados: dict, user: dict) -> dict:
    """Conferência da fatura do fornecedor com o que foi recebido; portes repartidos pelo custo dos artigos."""
    oc = await ordens_compra_repo.get(oid)
    if not oc:
        raise HTTPException(404, "Ordem de compra não encontrada")
    numero = (dados.get("numero") or "").strip()
    if not numero:
        raise HTTPException(400, "Indique o número da fatura do fornecedor")
    total = round2(float(dados.get("total") or 0))
    portes = round2(float(dados.get("portes") or 0))
    esperado = resumo_oc(oc)["valor_recebido"] or round2(float(oc.get("total") or 0))
    desvio = round2(total - portes - esperado)
    estado = "conferida" if abs(desvio) <= float(dados.get("tolerancia") or 0.5) else "com_diferencas"
    if portes > 0 and not (oc.get("fatura_fornecedor") or {}).get("portes_repartidos"):
        linhas = [l for l in oc.get("linhas") or [] if l.get("artigo_id") and float(l.get("qtd_recebida") or 0) > 0]
        base = sum(_valor_linha(l, float(l.get("qtd_recebida") or 0)) for l in linhas)
        for l in linhas:
            parte = portes * (_valor_linha(l, float(l["qtd_recebida"])) / base) if base else portes / len(linhas)
            a = await artigos_repo.get(l["artigo_id"]) or {}
            stock = float(a.get("qtd_stock") or 0)
            if stock > 0:
                cm = float(a.get("custo_medio") or a.get("custo_artigo") or 0)
                await artigos_repo.update(l["artigo_id"], {"custo_medio": round(cm + parte / stock, 4)})
    ff = {"numero": numero, "data": (dados.get("data") or now_iso())[:10], "total": total, "portes": portes,
          "esperado": esperado, "desvio": desvio, "estado": estado, "notas": (dados.get("notas") or "").strip(),
          "portes_repartidos": portes > 0, "por": _quem(user), "at": now_iso()}
    await ordens_compra_repo.update(oid, {"fatura_fornecedor": ff})
    await audit.registar("ordem_compra", oid, "editado", user,
                         f"Fatura do fornecedor {numero} ({total:.2f}€) {'conferida' if estado == 'conferida' else f'com diferença de {desvio:+.2f}€'}",
                         oc.get("codigo"))
    return {**oc, "fatura_fornecedor": ff}


# ---------------------------------------------------------------------------
# Reservas: o que as encomendas abertas e as OF por fechar vão gastar
# ---------------------------------------------------------------------------
async def reservas() -> Dict[str, float]:
    from app.repositories import ordens_repo
    artigos = {a["id"]: a for a in await artigos_repo.find({"gere_stock": True}, limit=20000)}
    out: Dict[str, float] = {}
    for e in await encomendas_repo.find({"estado": {"$nin": ["concluida", "cancelada"]}, "entregue": {"$ne": True}}, limit=5000):
        for l in e.get("artigos") or []:
            a = artigos.get(l.get("artigo_id"))
            if a and not a.get("produzido"):  # artigos produzidos gastam materiais (contados nas OF)
                out[a["id"]] = out.get(a["id"], 0) + float(l.get("quantidade") or 0)
    for of in await ordens_repo.find({"status": {"$nin": ["concluido", "cancelado"]}}, limit=5000):
        if (of.get("fecho") or {}).get("fechada"):
            continue
        for it in of.get("itens") or []:
            for m in it.get("materiais") or []:
                if m.get("material_id") in artigos and not m.get("consumido"):
                    out[m["material_id"]] = out.get(m["material_id"], 0) + float(m.get("quantidade") or 0)
    return {k: round2(v) for k, v in out.items()}


# ---------------------------------------------------------------------------
# Sugestões de compra
# ---------------------------------------------------------------------------
async def sugestoes() -> List[dict]:
    artigos = [a for a in await artigos_repo.find({}, limit=20000) if gere_stock(a) and float(a.get("nivel_reabastecimento") or 0) > 0]
    if not artigos:
        return []
    ids = {a["id"] for a in artigos}
    em_compra: Dict[str, float] = {}
    for oc in await ordens_compra_repo.find({"estado": "criada"}, limit=5000):
        for l in oc.get("linhas") or []:
            if l.get("artigo_id") in ids:
                a_f = next((a for a in artigos if a["id"] == l["artigo_id"]), {})
                falta = max(0.0, float(l.get("quantidade") or 0) - float(l.get("qtd_recebida") or 0))
                em_compra[l["artigo_id"]] = em_compra.get(l["artigo_id"], 0) + falta * (float(a_f.get("fator_compra") or 1) or 1)
    reservado = await reservas()
    out = []
    for a in artigos:
        stock = float(a.get("qtd_stock") or 0)
        proj = stock + em_compra.get(a["id"], 0) - reservado.get(a["id"], 0)
        nivel = float(a.get("nivel_reabastecimento") or 0)
        if proj >= nivel:
            continue
        fator = float(a.get("fator_compra") or 1) or 1
        precisa = max(nivel - proj, float(a.get("qtd_ultima_compra") or 0))
        qtd_compra = max(1.0, -(-precisa // fator))  # arredonda para cima em unidades de compra
        out.append({"artigo_id": a["id"], "codigo": a.get("codigo") or "", "nome": a.get("nome") or "",
                    "fornecedor_id": a.get("fornecedor_id"), "fornecedor_nome": a.get("fornecedor_nome") or "Sem fornecedor",
                    "cod_fornecedor": a.get("cod_fornecedor") or "", "unidade": a.get("unidade") or "un",
                    "unidade_compra": a.get("unidade_compra") or a.get("unidade") or "un", "fator_compra": fator,
                    "stock": round2(stock), "em_compra": round2(em_compra.get(a["id"], 0)), "reservado": round2(reservado.get(a["id"], 0)),
                    "projetado": round2(proj), "nivel": nivel, "qtd_sugerida": round2(qtd_compra),
                    "preco_compra": round2(float(a.get("preco_compra") or a.get("custo_artigo") or 0) * fator)})
    out.sort(key=lambda s: (s["fornecedor_nome"], s["nome"]))
    return out


async def criar_oc_de_sugestoes(itens: List[dict], user: dict) -> List[dict]:
    from app.domain.models import OrdemCompra, OrdemCompraLinha
    from app.services.numeracao import next_codigo
    grupos: Dict[str, List[dict]] = {}
    for i in itens:
        if float(i.get("quantidade") or 0) > 0:
            grupos.setdefault(i.get("fornecedor_id") or "", []).append(i)
    criadas = []
    for fid, lst in grupos.items():
        linhas = [OrdemCompraLinha(nome=i.get("nome") or "", artigo_id=i["artigo_id"], artigo_nome=i.get("nome") or "",
                                   quantidade=float(i["quantidade"]), preco_unit=float(i.get("preco_compra") or 0)).model_dump() for i in lst]
        total = round2(sum(l["quantidade"] * l["preco_unit"] for l in linhas))
        oc = OrdemCompra(assunto="Reposição de stock", fornecedor_id=fid or None, fornecedor_nome=lst[0].get("fornecedor_nome") or "",
                         tipo_despesa="compra", tipo_compra="Produtos", data=now_iso()[:10], linhas=linhas, subtotal=total, total=total)
        oc.codigo = await next_codigo("ordem_compra")
        await ordens_compra_repo.insert(oc.model_dump())
        await audit.registar("ordem_compra", oc.id, "criado", user, f"OC {oc.codigo} criada a partir das sugestões de compra", oc.codigo)
        criadas.append({"id": oc.id, "codigo": oc.codigo, "fornecedor": oc.fornecedor_nome, "total": total})
    return criadas


# ---------------------------------------------------------------------------
# Inventário
# ---------------------------------------------------------------------------
# M mercadorias · P matérias-primas/subsidiárias/consumo · A produtos acabados
CATEGORIA_AT = {"materia_prima": "P", "consumivel": "P", "ativo": "M"}


def categoria_at(a: dict) -> str:
    if a.get("tipo_artigo") == "ativo" and a.get("produzido"):
        return "A"
    return CATEGORIA_AT.get(a.get("tipo_artigo"), "M")


async def novo_inventario(data: str, user: dict) -> dict:
    if await inventarios_repo.find_one({"estado": "aberto"}):
        raise HTTPException(409, "Já há um inventário aberto — feche-o primeiro")
    linhas = []
    for a in await artigos_repo.find({}, sort=("nome", 1), limit=20000):
        if not gere_stock(a):
            continue
        linhas.append({"artigo_id": a["id"], "codigo": a.get("codigo") or "", "nome": a.get("nome") or "",
                       "unidade": a.get("unidade") or "un", "categoria_at": categoria_at(a),
                       "codigo_barras": a.get("codigo_produto") or "", "qtd_teorica": round2(float(a.get("qtd_stock") or 0)),
                       "qtd_contada": None, "custo": round(float(a.get("custo_medio") or a.get("custo_artigo") or 0), 4)})
    inv = {"id": new_id(), "data": (data or datetime.now(timezone.utc).date().isoformat())[:10], "estado": "aberto",
           "linhas": linhas, "criado_por": _quem(user), "created_at": now_iso()}
    await inventarios_repo.insert(inv)
    return inv


async def contar(iid: str, contagens: List[dict]) -> dict:
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    if inv.get("estado") != "aberto":
        raise HTTPException(409, "Inventário fechado")
    m = {c.get("artigo_id"): c.get("qtd_contada") for c in contagens}
    linhas = []
    for l in inv["linhas"]:
        if l["artigo_id"] in m:
            v = m[l["artigo_id"]]
            l = {**l, "qtd_contada": None if v in (None, "") else round2(float(v))}
        linhas.append(l)
    await inventarios_repo.update(iid, {"linhas": linhas})
    return {**inv, "linhas": linhas}


async def fechar_inventario(iid: str, user: dict) -> dict:
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    if inv.get("estado") != "aberto":
        raise HTTPException(409, "Inventário já fechado")
    n = 0
    for l in inv["linhas"]:
        if l.get("qtd_contada") is None:
            l["qtd_final"] = l["qtd_teorica"]
            continue
        a = await artigos_repo.get(l["artigo_id"]) or {}
        atual = float(a.get("qtd_stock") or 0)
        delta = round2(float(l["qtd_contada"]) - atual)
        if abs(delta) > 1e-9:
            await movimentar(l["artigo_id"], delta, "inventario", origem={"tipo": "inventario", "id": iid, "numero": inv["data"]},
                             user=user, data=inv["data"], nota="Acerto de inventário")
            n += 1
        l["qtd_final"] = round2(float(l["qtd_contada"]))
    for l in inv["linhas"]:
        l["valor"] = round2(float(l.get("qtd_final") or 0) * float(l.get("custo") or 0))
    patch = {"estado": "fechado", "linhas": inv["linhas"], "fechado_por": _quem(user), "fechado_at": now_iso(),
             "valor_total": round2(sum(l["valor"] for l in inv["linhas"])), "acertos": n}
    await inventarios_repo.update(iid, patch)
    await audit.registar("inventario", iid, "estado_alterado", user, f"Inventário de {inv['data']} fechado ({n} acertos)", inv["data"])
    return {**inv, **patch}


def csv_at(inv: dict) -> bytes:
    """Ficheiro de inventário para a AT (Portaria 126/2019): CSV com «;», valores com ponto decimal."""
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(["ProductCategory", "ProductCode", "ProductDescription", "ProductNumberCode", "ClosingStockQuantity",
                "UnitOfMeasure", "ClosingStockValue"])
    for l in inv.get("linhas") or []:
        q = float(l.get("qtd_final") if l.get("qtd_final") is not None else (l.get("qtd_contada") if l.get("qtd_contada") is not None else l.get("qtd_teorica")) or 0)
        if q <= 0:
            continue
        w.writerow([l.get("categoria_at") or "M", (l.get("codigo") or l["artigo_id"])[:60], (l.get("nome") or "")[:200],
                    (l.get("codigo_barras") or l.get("codigo") or "")[:60], f"{q:.2f}", (l.get("unidade") or "UN").upper()[:20],
                    f"{q * float(l.get('custo') or 0):.2f}"])
    return buf.getvalue().encode("utf-8")
