"""Stock: movimentos, sugestões de compra e inventário."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.security import require_perm
from app.repositories import artigos_repo, inventarios_repo, movimentos_stock_repo
from app.services import stock as stock_svc

router = APIRouter()


@router.get("/stock")
async def listar_stock(q: str = Query(""), filtro: str = Query("todos"), localizacao: str = Query(""),
                       _u: dict = Depends(require_perm("artigos", "view"))):
    """Artigos que gerem stock, com estado (abaixo do nível, negativo) e stock por localização."""
    out = []
    ql = q.strip().lower()
    reservado = await stock_svc.reservas()
    padrao = await stock_svc.local_padrao()
    locs = {l["id"]: l.get("nome") or "" for l in await stock_svc.listar_localizacoes()}
    for a in await artigos_repo.find({}, sort=("nome", 1), limit=20000):
        if not stock_svc.gere_stock(a):
            continue
        if ql and ql not in f"{a.get('codigo', '')} {a.get('nome', '')} {a.get('fornecedor_nome', '')}".lower():
            continue
        sl = stock_svc.stock_por_local(a, padrao["id"])
        if localizacao and abs(sl.get(localizacao, 0)) < 1e-9:
            continue
        stock = float(a.get("qtd_stock") or 0)
        nivel = float(a.get("nivel_reabastecimento") or 0)
        estado = "negativo" if stock < 0 else ("abaixo" if nivel and stock < nivel else "ok")
        if filtro != "todos" and estado != filtro and not (filtro == "abaixo" and estado == "negativo"):
            continue
        custo = float(a.get("custo_medio") or a.get("custo_artigo") or 0)
        out.append({"id": a["id"], "codigo": a.get("codigo") or "", "nome": a.get("nome") or "", "unidade": a.get("unidade") or "un",
                    "tipo_artigo": a.get("tipo_artigo"), "fornecedor_nome": a.get("fornecedor_nome") or "",
                    "unidade_compra": a.get("unidade_compra") or "", "fator_compra": float(a.get("fator_compra") or 1),
                    "qtd_stock": round(stock, 2), "nivel_reabastecimento": nivel, "custo_medio": round(custo, 4),
                    "valor": round(max(stock, 0) * custo, 2), "estado": estado, "gere_stock": True,
                    "localizacao": a.get("localizacao") or "", "reservado": reservado.get(a["id"], 0.0),
                    "localizacao_id": a.get("localizacao_id") or padrao["id"],
                    "por_local": [{"id": k, "nome": locs.get(k, "?"), "quantidade": v} for k, v in sorted(sl.items(), key=lambda x: -x[1])],
                    "qtd_local": sl.get(localizacao) if localizacao else None,
                    "disponivel": round(stock - reservado.get(a["id"], 0.0), 2)})
    return {"items": out, "valor_total": round(sum(i["valor"] for i in out), 2)}


@router.get("/stock/movimentos")
async def movimentos(artigo_id: Optional[str] = None, limit: int = Query(200, le=2000), _u: dict = Depends(require_perm("artigos", "view"))):
    filtro = {"artigo_id": artigo_id} if artigo_id else {}
    return await movimentos_stock_repo.find(filtro, sort=("created_at", -1), limit=limit)


@router.post("/stock/ajuste")
async def ajuste(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    a = await artigos_repo.get(dados.get("artigo_id") or "")
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    if not stock_svc.gere_stock(a):
        raise HTTPException(400, "Este artigo não tem gestão de stock — ative-a primeiro")
    loc = dados.get("localizacao_id") or None
    if dados.get("nova_quantidade") is not None and loc:
        atual = stock_svc.stock_por_local(a, (await stock_svc.local_padrao())["id"]).get(loc, 0.0)
        delta = float(dados["nova_quantidade"]) - atual
    elif dados.get("nova_quantidade") is not None:
        delta = float(dados["nova_quantidade"]) - float(a.get("qtd_stock") or 0)
    else:
        delta = float(dados.get("delta") or 0)
    m = await stock_svc.movimentar(a["id"], delta, "ajuste", user=user, nota=(dados.get("motivo") or "").strip(), localizacao_id=loc)
    return m or {"ok": True}


@router.get("/stock/sugestoes")
async def sugestoes(_u: dict = Depends(require_perm("ordens_compra", "view"))):
    return await stock_svc.sugestoes()


@router.post("/stock/sugestoes/criar-oc")
async def criar_oc(dados: dict, user: dict = Depends(require_perm("ordens_compra", "create"))):
    criadas = await stock_svc.criar_oc_de_sugestoes(dados.get("itens") or [], user)
    if not criadas:
        raise HTTPException(400, "Escolha pelo menos um artigo com quantidade")
    return {"criadas": criadas}


@router.get("/inventarios")
async def listar_inventarios(_u: dict = Depends(require_perm("artigos", "view"))):
    out = await inventarios_repo.find({}, sort=("data", -1), limit=200)
    for i in out:
        ls = i.pop("linhas", []) or []
        i["n_artigos"] = len(ls)
        i["n_contados"] = sum(1 for l in ls if l.get("qtd_contada") is not None)
    return out


@router.post("/inventarios")
async def criar_inventario(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.novo_inventario(dados.get("data") or "", user)


@router.get("/inventarios/{iid}")
async def get_inventario(iid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    return inv


@router.put("/inventarios/{iid}/contagens")
async def contagens(iid: str, dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.contar(iid, dados.get("contagens") or [])


@router.post("/inventarios/{iid}/fechar")
async def fechar(iid: str, user: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.fechar_inventario(iid, user)


@router.delete("/inventarios/{iid}")
async def eliminar(iid: str, _u: dict = Depends(require_perm("artigos", "edit"))):
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    if inv.get("estado") != "aberto":
        raise HTTPException(409, "Só se pode eliminar um inventário aberto")
    await inventarios_repo.delete({"id": iid})
    return {"ok": True}


@router.get("/inventarios/{iid}/at.csv")
async def exportar_at(iid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    return Response(stock_svc.csv_at(inv), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="inventario-{inv["data"]}.csv"'})


@router.put("/stock/artigos/{aid}/config")
async def configurar(aid: str, dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    """Gestão de stock do artigo: ativa, unidade de compra/fator e nível de reabastecimento."""
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    if a.get("tipo_artigo") == "servico":
        raise HTTPException(400, "Serviços não têm stock")
    # Só altera o que vem no pedido
    patch: dict = {}
    if "gere_stock" in dados:
        patch["gere_stock"] = bool(dados.get("gere_stock"))
    if "unidade_compra" in dados:
        patch["unidade_compra"] = (dados.get("unidade_compra") or "").strip()
    if "fator_compra" in dados:
        fator = float(dados.get("fator_compra") or 1)
        if fator <= 0:
            raise HTTPException(400, "O fator de conversão tem de ser maior que zero")
        patch["fator_compra"] = fator
    if "nivel_reabastecimento" in dados:
        patch["nivel_reabastecimento"] = max(0.0, float(dados.get("nivel_reabastecimento") or 0))
    if "localizacao" in dados:
        patch["localizacao"] = (dados.get("localizacao") or "").strip()[:60]
    if "localizacao_id" in dados:
        patch["localizacao_id"] = dados.get("localizacao_id") or None
    await artigos_repo.update(aid, patch)
    return {**a, **patch}



# ---------------- Localizações ----------------
@router.get("/stock/localizacoes")
async def localizacoes(_u: dict = Depends(require_perm("artigos", "view"))):
    lista = await stock_svc.listar_localizacoes()
    padrao = next((l for l in lista if l.get("padrao")), lista[0] if lista else None)
    totais: dict = {}
    n: dict = {}
    for a in await artigos_repo.find({"gere_stock": True}, limit=50000):
        for k, v in stock_svc.stock_por_local(a, padrao["id"]).items():
            totais[k] = totais.get(k, 0) + float(a.get("custo_medio") or a.get("custo_artigo") or 0) * max(v, 0)
            n[k] = n.get(k, 0) + 1
    return [{**l, "n_artigos": n.get(l["id"], 0), "valor": round(totais.get(l["id"], 0), 2)} for l in lista]


@router.post("/stock/localizacoes")
async def criar_localizacao(dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.guardar_localizacao(dados)


@router.put("/stock/localizacoes/{lid}")
async def editar_localizacao(lid: str, dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.guardar_localizacao(dados, lid)


@router.delete("/stock/localizacoes/{lid}")
async def apagar_localizacao(lid: str, _u: dict = Depends(require_perm("artigos", "edit"))):
    await stock_svc.apagar_localizacao(lid)
    return {"ok": True}


@router.get("/stock/artigos/{aid}")
async def stock_do_artigo(aid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    return await stock_svc.stock_artigo(aid)


@router.post("/stock/transferir")
async def transferir(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.transferir(dados.get("artigo_id") or "", dados.get("de") or "", dados.get("para") or "",
                                      dados.get("quantidade"), user, (dados.get("nota") or "").strip())
