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
    empresa_repo,
    artigos_repo, encomendas_repo, inventarios_repo, localizacoes_repo, movimentos_stock_repo, ordens_compra_repo,
)
from app.services import audit

TIPOS_SEM_STOCK = ("servico", "inativo", "nao_utilizado")


def rq(v) -> float:
    """Arredonda quantidades a 4 casas (metros, m², kg…); os valores em euros usam round2."""
    return round(float(v or 0) + 0.0, 4)


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


# ---------------------------------------------------------------------------
# Localizações (armazéns, estantes, prateleiras)
# ---------------------------------------------------------------------------
async def local_padrao() -> dict:
    """Localização por defeito (criada na primeira utilização)."""
    p = await localizacoes_repo.find_one({"padrao": True})
    if p:
        return p
    p = await localizacoes_repo.find_one({"ativo": {"$ne": False}})
    if p:
        await localizacoes_repo.update(p["id"], {"padrao": True})
        return {**p, "padrao": True}
    p = {"id": new_id(), "codigo": "ARM", "nome": "Geral", "descricao": "Localização principal", "padrao": True, "ativo": True,
         "armazem_id": (await armazem_padrao())["id"], "created_at": now_iso()}
    await localizacoes_repo.insert(p)
    return p


def stock_por_local(a: dict, padrao_id: str) -> Dict[str, float]:
    """Stock do artigo por localização. Artigos antigos (sem detalhe) ficam todos na localização por defeito."""
    sl = {k: float(v) for k, v in (a.get("stock_local") or {}).items() if abs(float(v or 0)) > 1e-9}
    total = float(a.get("qtd_stock") or 0)
    dif = rq(total - sum(sl.values()))
    if abs(dif) > 1e-9:  # diferenças (dados antigos/acertos diretos) vão para a localização do artigo
        loc = a.get("localizacao_id") or padrao_id
        sl[loc] = rq(sl.get(loc, 0) + dif)
    return {k: rq(v) for k, v in sl.items() if abs(v) > 1e-9}


# ---------------------------------------------------------------------------
# Armazéns (cada localização pertence a um armazém)
# ---------------------------------------------------------------------------
async def armazem_padrao() -> dict:
    from app.repositories import armazens_repo
    a = await armazens_repo.find_one({"padrao": True})
    if a:
        return a
    a = await armazens_repo.find_one({"ativo": {"$ne": False}})
    if a:
        await armazens_repo.update(a["id"], {"padrao": True})
        return {**a, "padrao": True}
    a = {"id": new_id(), "codigo": "ARM", "nome": "Armazém principal", "morada": "", "padrao": True, "ativo": True, "created_at": now_iso()}
    await armazens_repo.insert(a)
    return a


async def listar_armazens() -> List[dict]:
    from app.repositories import armazens_repo
    await armazem_padrao()
    return await armazens_repo.find({}, sort=("nome", 1), limit=200)


async def guardar_armazem(dados: dict, aid: Optional[str] = None) -> dict:
    from app.repositories import armazens_repo
    nome = (dados.get("nome") or "").strip()
    if not nome:
        raise HTTPException(400, "Indique o nome do armazém")
    doc = {"nome": nome[:80], "codigo": (dados.get("codigo") or "").strip().upper()[:12], "morada": (dados.get("morada") or "").strip()[:200],
           "ativo": dados.get("ativo", True) is not False}
    if doc["codigo"]:
        outro = await armazens_repo.find_one({"codigo": doc["codigo"]})
        if outro and outro.get("id") != aid:
            raise HTTPException(409, f"O código «{doc['codigo']}» já é do armazém «{outro.get('nome')}»")
    if dados.get("padrao"):
        await armazens_repo.col.update_many({}, {"$set": {"padrao": False}})
        doc["padrao"] = True
    if aid:
        atual = await armazens_repo.get(aid)
        if not atual:
            raise HTTPException(404, "Armazém não encontrado")
        if atual.get("padrao") and not doc["ativo"]:
            raise HTTPException(400, "O armazém principal não pode ficar inativo")
        await armazens_repo.update(aid, doc)
        return await armazens_repo.get(aid)
    doc.update({"id": new_id(), "created_at": now_iso(), "padrao": bool(doc.get("padrao"))})
    await armazens_repo.insert(doc)
    return doc


async def apagar_armazem(aid: str) -> None:
    from app.repositories import armazens_repo
    a = await armazens_repo.get(aid)
    if not a:
        raise HTTPException(404, "Armazém não encontrado")
    if a.get("padrao"):
        raise HTTPException(400, "Não pode apagar o armazém principal — escolha outro como principal primeiro")
    if await localizacoes_repo.find_one({"armazem_id": aid}):
        raise HTTPException(400, "O armazém ainda tem localizações — mude-as de armazém ou apague-as primeiro")
    await armazens_repo.delete({"id": aid})


async def listar_localizacoes() -> List[dict]:
    """Localizações com o armazém a que pertencem (`armazem_nome`, `nome_completo`)."""
    await local_padrao()
    arms = {a["id"]: a for a in await listar_armazens()}
    padrao_arm = next((a for a in arms.values() if a.get("padrao")), None)
    lista = await localizacoes_repo.find({}, sort=("nome", 1), limit=2000)
    varios = len(arms) > 1
    for l in lista:
        if not l.get("armazem_id") or l["armazem_id"] not in arms:
            l["armazem_id"] = padrao_arm["id"]
            await localizacoes_repo.update(l["id"], {"armazem_id": padrao_arm["id"]})
        a = arms[l["armazem_id"]]
        l["armazem_nome"] = a.get("nome") or ""
        l["armazem_codigo"] = a.get("codigo") or ""
        l["nome_completo"] = f"{a.get('nome')} › {l.get('nome')}" if varios else l.get("nome") or ""
    lista.sort(key=lambda l: (not arms[l["armazem_id"]].get("padrao"), l["armazem_nome"].lower(), (l.get("nome") or "").lower()))
    return lista


async def nomes_localizacoes() -> Dict[str, str]:
    """id → nome para mostrar (com o armazém quando há mais do que um)."""
    return {l["id"]: l["nome_completo"] for l in await listar_localizacoes()}


async def guardar_localizacao(dados: dict, lid: Optional[str] = None) -> dict:
    nome = (dados.get("nome") or "").strip()
    if not nome:
        raise HTTPException(400, "Indique o nome da localização")
    doc = {"nome": nome[:80], "codigo": (dados.get("codigo") or "").strip()[:20], "descricao": (dados.get("descricao") or "").strip()[:200],
           "ativo": dados.get("ativo", True) is not False}
    from app.repositories import armazens_repo
    arm_id = dados.get("armazem_id") or ""
    if arm_id and not await armazens_repo.get(arm_id):
        raise HTTPException(400, "Armazém não encontrado")
    if arm_id or not lid:
        doc["armazem_id"] = arm_id or (await armazem_padrao())["id"]
    if doc["codigo"]:
        outra = await localizacoes_repo.find_one({"codigo": doc["codigo"]})
        if outra and outra.get("id") != lid:
            raise HTTPException(409, f"O código «{doc['codigo']}» já é da localização «{outra.get('nome')}»")
    if dados.get("padrao"):
        await localizacoes_repo.col.update_many({}, {"$set": {"padrao": False}})
        doc["padrao"] = True
    if lid:
        if not await localizacoes_repo.get(lid):
            raise HTTPException(404, "Localização não encontrada")
        await localizacoes_repo.update(lid, doc)
        return await localizacoes_repo.get(lid)
    doc.update({"id": new_id(), "created_at": now_iso(), "padrao": bool(doc.get("padrao"))})
    await localizacoes_repo.insert(doc)
    return doc


async def apagar_localizacao(lid: str) -> None:
    l = await localizacoes_repo.get(lid)
    if not l:
        raise HTTPException(404, "Localização não encontrada")
    if l.get("padrao"):
        raise HTTPException(400, "Não pode apagar a localização por defeito — escolha outra como padrão primeiro")
    padrao = await local_padrao()
    for a in await artigos_repo.find({"gere_stock": True}, limit=50000):
        if abs(stock_por_local(a, padrao["id"]).get(lid, 0)) > 1e-9:
            raise HTTPException(400, f"Ainda há stock nesta localização (ex.: «{a.get('nome')}»). Transfira-o primeiro.")
    await localizacoes_repo.delete({"id": lid})
    await artigos_repo.col.update_many({"localizacao_id": lid}, {"$set": {"localizacao_id": None}})


async def transferir(artigo_id: str, de: str, para: str, quantidade: float, user: dict, nota: str = "") -> dict:
    q = rq(float(quantidade or 0))
    if q <= 0 or not de or not para or de == para:
        raise HTTPException(400, "Indique a quantidade e duas localizações diferentes")
    a = await artigos_repo.get(artigo_id)
    if not a or not gere_stock(a):
        raise HTTPException(404, "Artigo sem gestão de stock")
    padrao = await local_padrao()
    sl = stock_por_local(a, padrao["id"])
    if sl.get(de, 0) + 1e-9 < q:
        raise HTTPException(400, f"Só há {sl.get(de, 0):g} nessa localização")
    nomes = {l["id"]: l["nome"] for l in await localizacoes_repo.find({"id": {"$in": [de, para]}}, limit=2)}
    o = {"tipo": "transferencia", "numero": f"{nomes.get(de, '?')} → {nomes.get(para, '?')}"}
    await movimentar(artigo_id, -q, "transferencia", origem=o, user=user, nota=nota, localizacao_id=de)
    await movimentar(artigo_id, q, "transferencia", origem=o, user=user, nota=nota, localizacao_id=para)
    return await stock_artigo(artigo_id)


async def stock_artigo(artigo_id: str) -> dict:
    """Stock do artigo por localização + últimos movimentos (ficha do artigo)."""
    a = await artigos_repo.get(artigo_id)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    padrao = await local_padrao()
    locs = {l["id"]: l for l in await listar_localizacoes()}
    sl = stock_por_local(a, padrao["id"]) if gere_stock(a) else {}
    res = (await reservas()).get(artigo_id, 0.0) if gere_stock(a) else 0.0
    linhas = [{"localizacao_id": k, "nome": (locs.get(k) or {}).get("nome_completo") or "Localização removida",
               "armazem_id": (locs.get(k) or {}).get("armazem_id"), "armazem": (locs.get(k) or {}).get("armazem_nome") or "",
               "codigo": (locs.get(k) or {}).get("codigo") or "", "quantidade": v} for k, v in sl.items()]
    linhas.sort(key=lambda x: -x["quantidade"])
    movs = await movimentos_stock_repo.find({"artigo_id": artigo_id}, sort=("created_at", -1), limit=30)
    return {"gere_stock": gere_stock(a), "unidade": a.get("unidade") or "un", "total": rq(float(a.get("qtd_stock") or 0)),
            "reservado": res, "disponivel": rq(float(a.get("qtd_stock") or 0) - res),
            "localizacao_padrao_id": a.get("localizacao_id") or padrao["id"], "localizacoes": linhas, "movimentos": movs}


async def movimentar(artigo_id: str, delta: float, tipo: str, *, origem: Optional[dict] = None, custo_unit: Optional[float] = None,
                     user: Optional[dict] = None, data: Optional[str] = None, nota: str = "",
                     localizacao_id: Optional[str] = None) -> Optional[dict]:
    """Altera o stock do artigo (só se gere stock) e regista o movimento. Entradas com custo atualizam o custo médio."""
    if not artigo_id or abs(delta) < 1e-12:
        return None
    a = await artigos_repo.get(artigo_id)
    if not a or not gere_stock(a):
        return None  # artigo sem gestão de stock: não mexe na quantidade
    antes = float(a.get("qtd_stock") or 0)
    depois = rq(antes + delta)
    padrao = await local_padrao()
    loc = localizacao_id or a.get("localizacao_id") or padrao["id"]
    if loc != padrao["id"] and not await localizacoes_repo.get(loc):
        if localizacao_id:
            raise HTTPException(400, "Localização não encontrada (pode ter sido apagada)")
        loc = padrao["id"]  # a localização por defeito do artigo já não existe → vai para a da empresa
    sl = stock_por_local(a, padrao["id"])
    sl[loc] = rq(sl.get(loc, 0) + delta)
    patch: Dict[str, Any] = {"qtd_stock": depois, "woo_pendente": True, "stock_local": {k: v for k, v in sl.items() if abs(v) > 1e-9}}
    if delta > 0 and custo_unit is not None and custo_unit >= 0:
        cm = float(a.get("custo_medio") or a.get("custo_artigo") or 0)
        base = max(antes, 0.0)
        patch["custo_medio"] = round((cm * base + custo_unit * delta) / (base + delta), 4) if base + delta > 0 else custo_unit
        if tipo == "entrada":
            patch["qtd_ultima_compra"] = rq(delta)
    await artigos_repo.update(artigo_id, patch)
    m = {"id": new_id(), "artigo_id": artigo_id, "artigo_nome": a.get("nome") or "", "artigo_codigo": a.get("codigo") or "",
         "tipo": tipo, "quantidade": rq(delta), "saldo": depois, "custo_unit": custo_unit, "origem": origem or {},
         "localizacao_id": loc, "saldo_local": sl.get(loc, 0),
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
        q = rq(float(r.get("quantidade") or 0))
        if q <= 0:
            continue
        l = por_id.get(r.get("linha_id"))
        if not l:
            raise HTTPException(400, "Linha da ordem de compra inválida")
        falta = float(l.get("quantidade") or 0) - float(l.get("qtd_recebida") or 0)
        if q > falta + 1e-9 and not dados.get("aceitar_excesso"):
            raise HTTPException(400, f"«{l.get('artigo_nome') or l.get('nome')}»: faltam receber {max(falta, 0):g}. "
                                     "Marque «aceitar a mais» se o fornecedor mandou mais.")
        l["qtd_recebida"] = rq(float(l.get("qtd_recebida") or 0) + q)
        mov = None
        if l.get("artigo_id"):
            a = await artigos_repo.get(l["artigo_id"]) or {}
            fator = float(a.get("fator_compra") or 1) or 1
            preco = float(l.get("preco_unit") or 0) * (1 - float(l.get("desconto") or 0) / 100)
            mov = await movimentar(l["artigo_id"], q * fator, "entrada", origem={"tipo": "oc", "id": oid, "numero": oc.get("codigo")},
                                   custo_unit=round(preco / fator, 4), user=user, data=data,
                                   localizacao_id=r.get("localizacao_id") or dados.get("localizacao_id") or None)
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


async def receber_lote(dados: dict, user: dict) -> dict:
    """Várias receções de uma vez (mesma guia/entrega), só de OC do mesmo fornecedor.
    Valida tudo antes de mexer no stock; depois regista uma receção por OC."""
    pedidos = [p for p in dados.get("ocs") or [] if any(float(l.get("quantidade") or 0) > 0 for l in p.get("linhas") or [])]
    if not pedidos:
        raise HTTPException(400, "Indique as quantidades recebidas")
    ocs = []
    for p in pedidos:
        oc = await ordens_compra_repo.get(p.get("oc_id") or "")
        if not oc:
            raise HTTPException(404, "Ordem de compra não encontrada")
        if oc.get("estado") == "cancelada":
            raise HTTPException(400, f"A OC {oc.get('codigo')} está cancelada")
        ocs.append((oc, p))
    fornecedores = {o.get("fornecedor_id") or f"nome:{o.get('fornecedor_nome') or ''}" for o, _p in ocs}
    if len(fornecedores) > 1:
        raise HTTPException(400, "Só pode receber em conjunto ordens de compra do mesmo fornecedor")
    if not dados.get("aceitar_excesso"):
        for oc, p in ocs:
            por_id = {l.get("id"): l for l in oc.get("linhas") or []}
            for r in p.get("linhas") or []:
                l = por_id.get(r.get("linha_id"))
                if not l:
                    raise HTTPException(400, f"Linha inválida na OC {oc.get('codigo')}")
                falta = float(l.get("quantidade") or 0) - float(l.get("qtd_recebida") or 0)
                if float(r.get("quantidade") or 0) > falta + 1e-9:
                    raise HTTPException(400, f"{oc.get('codigo')} · «{l.get('artigo_nome') or l.get('nome')}»: faltam receber {max(falta, 0):g}. "
                                             "Marque «aceitar a mais» se o fornecedor mandou mais.")
    comum = {k: dados.get(k) for k in ("data", "guia_fornecedor", "notas", "localizacao_id", "aceitar_excesso")}
    feitas = []
    for oc, p in ocs:
        r = await receber(oc["id"], {**comum, "linhas": p.get("linhas") or []}, user)
        feitas.append({"id": oc["id"], "codigo": oc.get("codigo"), "estado": r.get("estado"), "completa": (r.get("resumo") or {}).get("completa")})
    return {"rececoes": feitas}


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
    if isinstance(dados.get("conferencia"), list):
        # Conferência linha a linha feita a partir do PDF da fatura
        ff["conferencia"] = dados["conferencia"][:200]
        ff["n_avisos"] = sum(1 for x in ff["conferencia"] if x.get("avisos"))
        if ff["n_avisos"] and estado == "conferida":
            ff["estado"] = "com_diferencas"
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
    return {k: rq(v) for k, v in out.items()}


# ---------------------------------------------------------------------------
# Saída de stock na entrega da encomenda (artigos de stock vendidos)
# ---------------------------------------------------------------------------
async def saida_encomenda(enc: dict, user: Optional[dict] = None) -> List[str]:
    """Ao entregar: abate ao stock os artigos de stock vendidos (não produzidos). Idempotente (`stock_saida`)."""
    if not enc or enc.get("stock_saida"):
        return []
    movs = []
    origem = {"tipo": "encomenda", "id": enc.get("id"), "numero": enc.get("numero")}
    for l in enc.get("artigos") or []:
        a = await artigos_repo.get(l.get("artigo_id")) if l.get("artigo_id") else None
        q = rq(l.get("quantidade"))
        if not a or not gere_stock(a) or a.get("produzido") or q <= 0:
            continue
        m = await movimentar(a["id"], -q, "venda", origem=origem, user=user, nota=enc.get("cliente") or "")
        if m:
            movs.append(m["id"])
    await encomendas_repo.update(enc["id"], {"stock_saida": movs or ["-"], "stock_saida_at": now_iso()})
    return movs


async def repor_saida_encomenda(enc: dict, user: Optional[dict] = None) -> int:
    """Desfaz a saída (entrega desmarcada / encomenda cancelada depois de entregue)."""
    ids = [x for x in (enc or {}).get("stock_saida") or [] if x and x != "-"]
    n = 0
    for mid in ids:
        m = await movimentos_stock_repo.get(mid)
        if m:
            await movimentar(m["artigo_id"], -float(m["quantidade"]), "ajuste", origem=m.get("origem"), user=user,
                             nota="Entrega anulada — stock reposto", localizacao_id=m.get("localizacao_id"))
            n += 1
    if enc and enc.get("stock_saida"):
        await encomendas_repo.update(enc["id"], {"stock_saida": [], "stock_saida_at": None})
    return n


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
                    "stock": rq(stock), "em_compra": rq(em_compra.get(a["id"], 0)), "reservado": rq(reservado.get(a["id"], 0)),
                    "projetado": rq(proj), "nivel": nivel, "qtd_sugerida": rq(qtd_compra),
                    "preco_compra": round2(float(a.get("preco_compra") or a.get("custo_artigo") or 0) * fator)})
    out.sort(key=lambda s: (s["fornecedor_nome"], s["nome"]))
    return out


async def criar_oc_de_sugestoes(itens: List[dict], user: dict, automatica: bool = False) -> List[dict]:
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
        oc = OrdemCompra(assunto="Reposição de stock" + (" (automática)" if automatica else ""), fornecedor_id=fid or None, fornecedor_nome=lst[0].get("fornecedor_nome") or "",
                         tipo_despesa="compra", tipo_compra="Produtos", data=now_iso()[:10], linhas=linhas, subtotal=total, total=total)
        oc.codigo = await next_codigo("ordem_compra")
        doc_oc = oc.model_dump()
        artigos_ref = {i["artigo_id"]: (await artigos_repo.get(i["artigo_id"]) or {}) for i in lst}
        for l in doc_oc.get("linhas") or []:
            a = artigos_ref.get(l.get("artigo_id")) or {}
            l.setdefault("cod_fornecedor", a.get("cod_fornecedor") or "")
            l["cod_fornecedor"] = l.get("cod_fornecedor") or a.get("cod_fornecedor") or ""
            l["unidade"] = l.get("unidade") or a.get("unidade_compra") or a.get("unidade") or ""
        if automatica:
            doc_oc.update({"automatica": True, "aprovada": False})
        await ordens_compra_repo.insert(doc_oc)
        await audit.registar("ordem_compra", oc.id, "criado", user,
                             f"OC {oc.codigo} criada {'automaticamente (stock abaixo do nível)' if automatica else 'a partir das sugestões de compra'}", oc.codigo)
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
    padrao = await local_padrao()
    locs = {l["id"]: l for l in await localizacoes_repo.find({}, limit=2000)}
    for a in await artigos_repo.find({}, sort=("nome", 1), limit=20000):
        if not gere_stock(a):
            continue
        sl = stock_por_local(a, padrao["id"]) or {a.get("localizacao_id") or padrao["id"]: 0.0}
        for loc, q in sl.items():
            linhas.append({"chave": f"{a['id']}|{loc}", "artigo_id": a["id"], "localizacao_id": loc,
                           "localizacao": (locs.get(loc) or {}).get("nome") or "", "codigo": a.get("codigo") or "",
                           "nome": a.get("nome") or "", "unidade": a.get("unidade") or "un", "categoria_at": categoria_at(a),
                           "codigo_barras": a.get("codigo_produto") or "", "qtd_teorica": rq(q), "qtd_contada": None,
                           "custo": round(float(a.get("custo_medio") or a.get("custo_artigo") or 0), 4)})
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
    m = {c.get("chave") or c.get("artigo_id"): c.get("qtd_contada") for c in contagens}
    linhas = []
    for l in inv["linhas"]:
        k = l.get("chave") or l["artigo_id"]
        if k not in m and l["artigo_id"] in m:
            k = l["artigo_id"]  # contagem antiga (sem localização)
        if k in m:
            v = m[k]
            l = {**l, "qtd_contada": None if v in (None, "") else rq(float(v))}
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
        if l.get("localizacao_id"):
            atual = stock_por_local(a, (await local_padrao())["id"]).get(l["localizacao_id"], 0.0)
        else:
            atual = float(a.get("qtd_stock") or 0)
        delta = rq(float(l["qtd_contada"]) - atual)
        if abs(delta) > 1e-9:
            await movimentar(l["artigo_id"], delta, "inventario", origem={"tipo": "inventario", "id": iid, "numero": inv["data"]},
                             user=user, data=inv["data"], nota="Acerto de inventário", localizacao_id=l.get("localizacao_id"))
            n += 1
        l["qtd_final"] = rq(float(l["qtd_contada"]))
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
    por_artigo: Dict[str, dict] = {}
    for l in inv.get("linhas") or []:
        q = float(l.get("qtd_final") if l.get("qtd_final") is not None else (l.get("qtd_contada") if l.get("qtd_contada") is not None else l.get("qtd_teorica")) or 0)
        x = por_artigo.setdefault(l["artigo_id"], {**l, "_q": 0.0})
        x["_q"] += q
    for l in por_artigo.values():
        q = l["_q"]
        if q <= 0:
            continue
        w.writerow([l.get("categoria_at") or "M", (l.get("codigo") or l["artigo_id"])[:60], (l.get("nome") or "")[:200],
                    (l.get("codigo_barras") or l.get("codigo") or "")[:60], f"{q:.2f}", (l.get("unidade") or "UN").upper()[:20],
                    f"{q * float(l.get('custo') or 0):.2f}"])
    return buf.getvalue().encode("utf-8")



# ---------------------------------------------------------------------------
# Compras automáticas (stock abaixo do nível de reabastecimento)
# ---------------------------------------------------------------------------
async def get_config_compras() -> dict:
    e = await empresa_repo.find_one({"id": "empresa"}) or {}
    return {"ativo": False, "ultima": "", **(e.get("compras_auto") or {})}


async def compras_automaticas(forcar: bool = False) -> List[dict]:
    """Uma vez por dia: cria as OC das sugestões de compra (por fornecedor) para aprovar.
    Não duplica: as quantidades já em OC abertas contam como «em compra»."""
    from datetime import date
    cfg = await get_config_compras()
    hoje = date.today().isoformat()
    if not forcar and (not cfg.get("ativo") or cfg.get("ultima") == hoje):
        return []
    await empresa_repo.update_where({"id": "empresa"}, {"compras_auto": {**cfg, "ultima": hoje}}, upsert=True)
    itens = [{**s, "quantidade": s["qtd_sugerida"]} for s in await sugestoes() if s.get("fornecedor_id")]
    if not itens:
        return []
    criadas = await criar_oc_de_sugestoes(itens, {"id": "sistema", "name": "Compras automáticas"}, automatica=True)
    from app.services import workflow
    for c in criadas:
        await workflow.evento("compra_automatica", f"OC {c['codigo']} por aprovar ({c['fornecedor']})",
                              f"Criada automaticamente porque há artigos abaixo do nível de reabastecimento · {c['total']:.2f} €",
                              link=f"/ordens-compra/{c['id']}", entidade="ordem_compra", entidade_id=c["id"], chave=f"oc_auto:{c['id']}")
    return criadas


async def aprovar_e_enviar_oc(oid: str, user: dict, enviar: bool = True, mensagem: str = "") -> dict:
    """Aprova a OC e (se pedido) envia-a por email ao fornecedor com a nota de encomenda em PDF."""
    import asyncio
    from app.repositories import fornecedores_repo
    from app.services import email as email_svc
    from app.services.email_templates import text_to_html_fragments
    from app.services.pdf import build_oc_pdf
    oc = await ordens_compra_repo.get(oid)
    if not oc:
        raise HTTPException(404, "Ordem de compra não encontrada")
    patch = {"aprovada": True, "aprovada_por": _quem(user), "aprovada_at": now_iso()}
    enviado_para = None
    if enviar:
        f = await fornecedores_repo.get(oc.get("fornecedor_id") or "") or {}
        to = (f.get("email") or "").strip()
        if not to or "@" not in to:
            raise HTTPException(400, "O fornecedor não tem email — aprove sem enviar ou preencha o email na ficha do fornecedor")
        if not email_svc.smtp_configured():
            raise HTTPException(503, "O envio de email não está configurado no servidor")
        emp = await empresa_repo.find_one({"id": "empresa"}) or {}
        pdf = build_oc_pdf(oc, emp, f)
        corpo = (f"Bom dia,\n\nSegue em anexo a nossa nota de encomenda {oc.get('codigo')}.\n"
                 + (f"\n{mensagem.strip()}\n" if (mensagem or "").strip() else "")
                 + f"\nAgradecemos a confirmação e o prazo de entrega previsto.\n\nCumprimentos,\n{emp.get('nome') or ''}\n")
        ok, motivo = await asyncio.to_thread(email_svc.send_email, to, f"Nota de encomenda {oc.get('codigo')} — {emp.get('nome') or ''}".strip(" —"),
                                             corpo, html=email_svc._branded_html(text_to_html_fragments(corpo)),
                                             attachments=[(f"{oc.get('codigo')}.pdf", pdf, "application/pdf")])
        if not ok:
            raise HTTPException(500, f"Não foi possível enviar o email: {motivo}")
        enviado_para = email_svc.mask_email(to)
        patch.update({"enviada_fornecedor_at": now_iso(), "enviada_para": enviado_para})
    await ordens_compra_repo.update(oid, patch)
    await audit.registar("ordem_compra", oid, "editado", user,
                         f"OC {oc.get('codigo')} aprovada" + (f" e enviada ao fornecedor ({enviado_para})" if enviado_para else ""), oc.get("codigo"))
    return {**oc, **patch}
