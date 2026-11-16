"""Stock: movimentos, sugestões de compra e inventário."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.security import require_perm
from app.repositories import artigos_repo, inventarios_repo, movimentos_stock_repo
from app.services import stock as stock_svc

router = APIRouter()


@router.get("/stock")
async def listar_stock(q: str = Query(""), filtro: str = Query("todos"), _u: dict = Depends(require_perm("artigos", "view"))):
    """Artigos que gerem stock, com estado (abaixo do nível, negativo)."""
    out = []
    ql = q.strip().lower()
    for a in await artigos_repo.find({}, sort=("nome", 1), limit=20000):
        if not stock_svc.gere_stock(a):
            continue
        if ql and ql not in f"{a.get('codigo', '')} {a.get('nome', '')} {a.get('fornecedor_nome', '')}".lower():
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
                    "valor": round(max(stock, 0) * custo, 2), "estado": estado, "gere_stock": True})
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
    if dados.get("nova_quantidade") is not None:
        delta = float(dados["nova_quantidade"]) - float(a.get("qtd_stock") or 0)
    else:
        delta = float(dados.get("delta") or 0)
    m = await stock_svc.movimentar(a["id"], delta, "ajuste", user=user, nota=(dados.get("motivo") or "").strip())
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
    fator = float(dados.get("fator_compra") or 1)
    if fator <= 0:
        raise HTTPException(400, "O fator de conversão tem de ser maior que zero")
    patch = {"gere_stock": bool(dados.get("gere_stock", True)), "unidade_compra": (dados.get("unidade_compra") or "").strip(),
             "fator_compra": fator, "nivel_reabastecimento": max(0.0, float(dados.get("nivel_reabastecimento") or 0))}
    await artigos_repo.update(aid, patch)
    return {**a, **patch}
