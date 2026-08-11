from typing import List, Optional
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from app.domain.models import (
    Maquina, MaquinaInput, Consumivel, ConsumivelInput, MaoObra, MaoObraInput,
    Artigo, ArtigoInput, TipoPersonalizacao, TipoPersonalizacaoInput,
    Categoria, CategoriaInput, Subcategoria, SubcategoriaInput,
)
from app.core.database import new_id, now_iso, round2
from app.core.security import get_current_user, require_perm
from app.core.pagination import parse_page, page_payload, text_search
from app.repositories import (
    maquinas_repo, consumiveis_repo, mao_obra_repo, artigos_repo, tipos_repo,
    orcamentos_repo, encomendas_repo, ordens_repo, categorias_repo, subcategorias_repo,
)
from app.services.costing import (
    artigo_breakdown, enrich_artigo, enrich_artigos_list, artigo_lite,
    compute_orcamento_totais, compute_encomendas_many, recompute_of_status,
)
from app.services.numeracao import next_codigo
from app.services import audit

router = APIRouter()


async def _list_or_page(repo, query, sort, page, page_size, map_fn=None):
    if page is None:
        items = await repo.find(query, sort=sort, limit=5000)
        return [map_fn(i) if map_fn else i for i in items] if map_fn else items
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        repo.count(query),
        repo.find(query, sort=sort, limit=ps, skip=skip),
    )
    if map_fn:
        items = [map_fn(i) for i in items]
    return page_payload(items, total, p, ps)


async def _subcategoria_counts(categoria_ids: list) -> dict:
    """Conta subcategorias por categoria numa única agregação (evita N+1)."""
    if not categoria_ids:
        return {}
    from app.core.database import db
    pipeline = [
        {"$match": {"categoria_id": {"$in": list(categoria_ids)}}},
        {"$group": {"_id": "$categoria_id", "n": {"$sum": 1}}},
    ]
    rows = await db.subcategorias.aggregate(pipeline).to_list(length=len(categoria_ids) + 10)
    return {r["_id"]: int(r.get("n") or 0) for r in rows if r.get("_id")}


async def _list_categorias_page(page, page_size, query):
    """Lista categorias com contagem de subcategorias na página."""
    if page is None:
        items = await categorias_repo.find(query, sort=("nome", 1), limit=5000)
        return items
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        categorias_repo.count(query),
        categorias_repo.find(query, sort=("nome", 1), limit=ps, skip=skip),
    )
    counts = await _subcategoria_counts([c["id"] for c in items if c.get("id")])
    for c in items:
        c["num_subcategorias"] = counts.get(c["id"], 0)
    return page_payload(items, total, p, ps)


async def _resolve_categorias(data: dict) -> dict:
    """Preenche nomes a partir dos IDs; limpa subcategoria se não pertencer à categoria."""
    cat_id = data.get("categoria_id") or None
    sub_id = data.get("subcategoria_id") or None
    if not cat_id:
        data["categoria_id"] = None
        data["categoria_nome"] = ""
        data["subcategoria_id"] = None
        data["subcategoria_nome"] = ""
        return data
    cat = await categorias_repo.get(cat_id)
    if not cat:
        raise HTTPException(400, "Categoria inválida")
    data["categoria_id"] = cat_id
    data["categoria_nome"] = cat.get("nome") or ""
    if sub_id:
        sub = await subcategorias_repo.get(sub_id)
        if not sub or sub.get("categoria_id") != cat_id:
            raise HTTPException(400, "Subcategoria inválida para esta categoria")
        data["subcategoria_id"] = sub_id
        data["subcategoria_nome"] = sub.get("nome") or ""
    else:
        data["subcategoria_id"] = None
        data["subcategoria_nome"] = ""
    return data


# ----------------------- Máquinas -----------------------
@router.get("/maquinas")
async def list_maquinas(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("maquinas", "view")),
):
    query = {}
    ts = text_search(["nome", "codigo"], q)
    if ts:
        query.update(ts)
    return await _list_or_page(maquinas_repo, query, ("nome", 1), page, page_size)


@router.post("/maquinas", response_model=Maquina)
async def create_maquina(data: MaquinaInput, user: dict = Depends(require_perm("maquinas", "create"))):
    m = Maquina(**data.model_dump())
    m.codigo = await next_codigo("maquina")
    await maquinas_repo.insert(m.model_dump())
    await audit.registar("maquina", m.id, "criado", user, f"Máquina «{m.nome}» criada", m.codigo or m.nome)
    return m


@router.put("/maquinas/{mid}", response_model=Maquina)
async def update_maquina(mid: str, data: MaquinaInput, user: dict = Depends(require_perm("maquinas", "edit"))):
    existing = await maquinas_repo.get(mid)
    if not existing:
        raise HTTPException(404, "Máquina não encontrada")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, list(novo.keys()))
    existing.update(novo)
    await maquinas_repo.update(mid, novo)
    if alteracoes:
        await audit.registar("maquina", mid, "editado", user, f"Máquina «{novo.get('nome')}» editada", novo.get("nome"), alteracoes)
    return existing


@router.delete("/maquinas/{mid}")
async def delete_maquina(mid: str, user: dict = Depends(require_perm("maquinas", "delete"))):
    existing = await maquinas_repo.get(mid)
    await maquinas_repo.delete({"id": mid})
    if existing:
        await audit.registar("maquina", mid, "eliminado", user, f"Máquina «{existing.get('nome')}» eliminada", existing.get("nome"))
    return {"ok": True}


# ----------------------- Consumíveis (Materiais) -----------------------
@router.get("/consumiveis")
async def list_consumiveis(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("materiais", "view")),
):
    query = {}
    ts = text_search(["nome", "codigo", "unidade"], q)
    if ts:
        query.update(ts)
    return await _list_or_page(consumiveis_repo, query, ("nome", 1), page, page_size)


@router.post("/consumiveis", response_model=Consumivel)
async def create_consumivel(data: ConsumivelInput, user: dict = Depends(require_perm("materiais", "create"))):
    c = Consumivel(**data.model_dump())
    c.codigo = await next_codigo("material")
    await consumiveis_repo.insert(c.model_dump())
    await audit.registar("consumivel", c.id, "criado", user, f"Material «{c.nome}» criado", c.codigo or c.nome)
    return c


@router.put("/consumiveis/{cid}", response_model=Consumivel)
async def update_consumivel(cid: str, data: ConsumivelInput, user: dict = Depends(require_perm("materiais", "edit"))):
    existing = await consumiveis_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Consumível não encontrado")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, list(novo.keys()))
    await consumiveis_repo.update(cid, novo)
    existing.update(novo)
    if alteracoes:
        await audit.registar("consumivel", cid, "editado", user, f"Material «{novo.get('nome')}» editado", novo.get("nome"), alteracoes)
    return existing


@router.delete("/consumiveis/{cid}")
async def delete_consumivel(cid: str, user: dict = Depends(require_perm("materiais", "delete"))):
    existing = await consumiveis_repo.get(cid)
    await consumiveis_repo.delete({"id": cid})
    if existing:
        await audit.registar("consumivel", cid, "eliminado", user, f"Material «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}


# ----------------------- Mão de Obra -----------------------
@router.get("/mao-obra")
async def list_mao_obra(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("mao_obra", "view")),
):
    query = {}
    ts = text_search(["nome", "codigo"], q)
    if ts:
        query.update(ts)
    return await _list_or_page(mao_obra_repo, query, ("nome", 1), page, page_size)


@router.post("/mao-obra", response_model=MaoObra)
async def create_mao_obra(data: MaoObraInput, user: dict = Depends(require_perm("mao_obra", "create"))):
    m = MaoObra(**data.model_dump())
    m.codigo = await next_codigo("mao_obra")
    await mao_obra_repo.insert(m.model_dump())
    await audit.registar("mao_obra", m.id, "criado", user, f"Mão de obra «{m.nome}» criada", m.codigo or m.nome)
    return m


@router.put("/mao-obra/{mid}", response_model=MaoObra)
async def update_mao_obra(mid: str, data: MaoObraInput, user: dict = Depends(require_perm("mao_obra", "edit"))):
    existing = await mao_obra_repo.get(mid)
    if not existing:
        raise HTTPException(404, "Mão de obra não encontrada")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, list(novo.keys()))
    await mao_obra_repo.update(mid, novo)
    existing.update(novo)
    if alteracoes:
        await audit.registar("mao_obra", mid, "editado", user, f"Mão de obra «{novo.get('nome')}» editada", novo.get("nome"), alteracoes)
    return existing


@router.delete("/mao-obra/{mid}")
async def delete_mao_obra(mid: str, user: dict = Depends(require_perm("mao_obra", "delete"))):
    existing = await mao_obra_repo.get(mid)
    await mao_obra_repo.delete({"id": mid})
    if existing:
        await audit.registar("mao_obra", mid, "eliminado", user, f"Mão de obra «{existing.get('nome')}» eliminada", existing.get("nome"))
    return {"ok": True}


# ----------------------- Artigos -----------------------
@router.get("/artigos")
async def list_artigos(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    lite: bool = Query(False, description="Payload mínimo para selectors (sem BOM/custeio pesado)"),
    _u: dict = Depends(require_perm("artigos", "view")),
):
    query = {}
    ts = text_search(["nome", "codigo"], q)
    if ts:
        query.update(ts)

    if page is None:
        artigos = await artigos_repo.find(query, sort=("nome", 1), limit=5000)
        if lite:
            return [artigo_lite(a) for a in artigos]
        return await enrich_artigos_list(artigos)
    p, ps, skip = parse_page(page, page_size)
    total, artigos = await asyncio.gather(
        artigos_repo.count(query),
        artigos_repo.find(query, sort=("nome", 1), limit=ps, skip=skip),
    )
    if lite:
        items = [artigo_lite(a) for a in artigos]
    else:
        items = await enrich_artigos_list(artigos)
    return page_payload(items, total, p, ps)


@router.get("/artigos/{aid}")
async def get_artigo(aid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    return enrich_artigo(a, await artigo_breakdown(a))


@router.get("/artigos/{aid}/resumo")
async def artigo_resumo(aid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")

    # Só documentos que referenciam o artigo (evita varrer 1000+ encomendas).
    artigo_bd, orcs_raw, encs_raw, ofs_raw = await asyncio.gather(
        artigo_breakdown(a),
        orcamentos_repo.find({"linhas.artigo_id": aid}, sort=("data", -1), limit=5000),
        encomendas_repo.find({"artigos.artigo_id": aid}, sort=("data", -1), limit=5000),
        ordens_repo.find({"itens.artigo_id": aid}, sort=("data", -1), limit=5000),
    )
    artigo = enrich_artigo(a, artigo_bd)

    orcamentos = []
    for o in orcs_raw:
        linhas = [l for l in (o.get("linhas") or []) if l.get("artigo_id") == aid]
        if not linhas:
            continue
        oc = compute_orcamento_totais(o)
        orcamentos.append({
            "id": o["id"], "numero": o.get("numero"), "cliente": o.get("cliente"), "data": o.get("data"),
            "status": o.get("status"), "quantidade": round2(sum(l.get("quantidade") or 0 for l in linhas)),
            "total": oc.get("total"),
        })

    # Batch: 1 lookup de OFs/orçamentos/empresa em vez de N×compute_encomenda.
    encs_computed = await compute_encomendas_many(encs_raw)
    encomendas = []
    receita = 0.0
    for e, ec in zip(encs_raw, encs_computed):
        arts = [x for x in (e.get("artigos") or []) if x.get("artigo_id") == aid]
        if not arts:
            continue
        for x in arts:
            pers = sum((p.get("valor") or 0) for p in (x.get("personalizacoes") or []))
            bruto = ((x.get("preco_unit") or 0) + pers) * (x.get("quantidade") or 0)
            d = x.get("desconto") or 0
            desc = min(d, bruto) if x.get("desconto_tipo") == "eur" else (bruto * d / 100.0)
            receita += bruto - desc
        encomendas.append({
            "id": e["id"], "numero": e.get("numero"), "cliente": e.get("cliente"), "data": e.get("data"),
            "estado": ec.get("estado"), "status_pagamento": ec.get("status_pagamento"),
            "quantidade": round2(sum(x.get("quantidade") or 0 for x in arts)), "valor_total": ec.get("valor_total"),
        })

    ordens_fabrico = []
    for f in ofs_raw:
        its = [x for x in (f.get("itens") or []) if x.get("artigo_id") == aid]
        if not its:
            continue
        fc = recompute_of_status(f)
        ordens_fabrico.append({
            "id": f["id"], "numero": f.get("numero"), "cliente": f.get("cliente"), "data": f.get("data"),
            "status": fc.get("status"), "progresso": fc.get("progresso"),
            "quantidade": round2(sum(x.get("quantidade") or 0 for x in its)),
        })

    qtd_encomendada = round2(sum(x["quantidade"] for x in encomendas))
    custo_prod = round2((artigo.get("custo_producao_total") or 0) * qtd_encomendada)
    stats = {
        "num_orcamentos": len(orcamentos),
        "num_encomendas": len(encomendas),
        "num_ofs": len(ordens_fabrico),
        "qtd_orcada": round2(sum(x["quantidade"] for x in orcamentos)),
        "qtd_encomendada": qtd_encomendada,
        "qtd_produzida": round2(sum(x["quantidade"] for x in ordens_fabrico)),
        "receita": round2(receita),
        "custo": custo_prod,
        "ganho": round2(receita - custo_prod),
    }
    return {"artigo": artigo, "orcamentos": orcamentos, "encomendas": encomendas,
            "ordens_fabrico": ordens_fabrico, "stats": stats}


@router.post("/artigos")
async def create_artigo(data: ArtigoInput, user: dict = Depends(require_perm("artigos", "create"))):
    payload = await _resolve_categorias(data.model_dump())
    a = Artigo(**payload)
    a.codigo = await next_codigo("artigo")
    doc = a.model_dump()
    await artigos_repo.insert(doc)
    doc.pop("_id", None)
    await audit.registar("artigo", a.id, "criado", user, f"Artigo «{a.nome}» criado", a.codigo or a.nome)
    return enrich_artigo(doc, await artigo_breakdown(doc))


@router.put("/artigos/{aid}")
async def update_artigo(aid: str, data: ArtigoInput, user: dict = Depends(require_perm("artigos", "edit"))):
    existing = await artigos_repo.get(aid)
    if not existing:
        raise HTTPException(404, "Artigo não encontrado")
    update = await _resolve_categorias(data.model_dump())
    alteracoes = audit.diff_campos(existing, update, ["nome", "descricao", "unidade", "custo_artigo", "margem", "categoria_id", "subcategoria_id"])
    await artigos_repo.update(aid, update)
    existing.update(update)
    await audit.registar("artigo", aid, "editado", user, f"Artigo «{update.get('nome')}» editado", update.get("nome"), alteracoes)
    return enrich_artigo(existing, await artigo_breakdown(existing))


@router.delete("/artigos/{aid}")
async def delete_artigo(aid: str, user: dict = Depends(require_perm("artigos", "delete"))):
    existing = await artigos_repo.get(aid)
    await artigos_repo.delete({"id": aid})
    if existing:
        await audit.registar("artigo", aid, "eliminado", user, f"Artigo «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}


@router.post("/artigos/{aid}/duplicar")
async def duplicar_artigo(aid: str, user: dict = Depends(require_perm("artigos", "create"))):
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    novo = {**a}
    novo.update({
        "id": new_id(),
        "codigo": await next_codigo("artigo"),
        "nome": f"{a.get('nome', 'Artigo')} (cópia)",
        "created_at": now_iso(),
    })
    await artigos_repo.insert(novo)
    await audit.registar("artigo", novo["id"], "duplicado", user, f"Artigo «{novo['nome']}» criado a partir de «{a.get('nome')}»", novo.get("codigo") or novo["nome"])
    return enrich_artigo(novo, await artigo_breakdown(novo))


# ----------------------- Tipos de Personalização -----------------------
@router.get("/tipos-personalizacao")
async def list_tipos(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("personalizacao", "view")),
):
    query = {}
    ts = text_search(["nome", "codigo"], q)
    if ts:
        query.update(ts)
    return await _list_or_page(tipos_repo, query, ("nome", 1), page, page_size)


@router.post("/tipos-personalizacao", response_model=TipoPersonalizacao)
async def create_tipo(data: TipoPersonalizacaoInput, user: dict = Depends(require_perm("personalizacao", "create"))):
    t = TipoPersonalizacao(**data.model_dump())
    t.codigo = await next_codigo("tipo_personalizacao")
    await tipos_repo.insert(t.model_dump())
    await audit.registar("tipo_personalizacao", t.id, "criado", user, f"Tipo «{t.nome}» criado", t.codigo or t.nome)
    return t


@router.put("/tipos-personalizacao/{tid}", response_model=TipoPersonalizacao)
async def update_tipo(tid: str, data: TipoPersonalizacaoInput, user: dict = Depends(require_perm("personalizacao", "edit"))):
    existing = await tipos_repo.get(tid)
    if not existing:
        raise HTTPException(404, "Tipo não encontrado")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, list(novo.keys()))
    await tipos_repo.update(tid, novo)
    existing.update(novo)
    if alteracoes:
        await audit.registar("tipo_personalizacao", tid, "editado", user, f"Tipo «{novo.get('nome')}» editado", novo.get("nome"), alteracoes)
    return existing


@router.delete("/tipos-personalizacao/{tid}")
async def delete_tipo(tid: str, user: dict = Depends(require_perm("personalizacao", "delete"))):
    existing = await tipos_repo.get(tid)
    await tipos_repo.delete({"id": tid})
    if existing:
        await audit.registar("tipo_personalizacao", tid, "eliminado", user, f"Tipo «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}


# ----------------------- Categorias -----------------------
@router.get("/categorias")
async def list_categorias(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("artigos", "view")),
):
    query = {}
    ts = text_search(["nome", "codigo"], q)
    if ts:
        query.update(ts)
    return await _list_categorias_page(page, page_size, query)


@router.post("/categorias", response_model=Categoria)
async def create_categoria(data: CategoriaInput, user: dict = Depends(require_perm("artigos", "create"))):
    c = Categoria(**data.model_dump())
    c.codigo = await next_codigo("categoria")
    await categorias_repo.insert(c.model_dump())
    await audit.registar("categoria", c.id, "criado", user, f"Categoria «{c.nome}» criada", c.codigo or c.nome)
    return c


@router.put("/categorias/{cid}", response_model=Categoria)
async def update_categoria(cid: str, data: CategoriaInput, user: dict = Depends(require_perm("artigos", "edit"))):
    existing = await categorias_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Categoria não encontrada")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, ["nome"])
    await categorias_repo.update(cid, novo)
    if novo.get("nome") and novo["nome"] != existing.get("nome"):
        await subcategorias_repo.update_many({"categoria_id": cid}, {"categoria_nome": novo["nome"]})
        await artigos_repo.update_many({"categoria_id": cid}, {"categoria_nome": novo["nome"]})
    existing.update(novo)
    if alteracoes:
        await audit.registar("categoria", cid, "editado", user, f"Categoria «{novo.get('nome')}» editada", novo.get("nome"), alteracoes)
    return existing


@router.delete("/categorias/{cid}")
async def delete_categoria(cid: str, user: dict = Depends(require_perm("artigos", "delete"))):
    existing = await categorias_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Categoria não encontrada")
    if await subcategorias_repo.find_one({"categoria_id": cid}):
        raise HTTPException(400, "Categoria tem subcategorias — elimine-as primeiro")
    if await artigos_repo.find_one({"categoria_id": cid}):
        raise HTTPException(400, "Categoria em uso por artigos")
    await categorias_repo.delete({"id": cid})
    await audit.registar("categoria", cid, "eliminado", user, f"Categoria «{existing.get('nome')}» eliminada", existing.get("codigo") or existing.get("nome"))
    return {"ok": True}


# ----------------------- Subcategorias -----------------------
@router.get("/subcategorias")
async def list_subcategorias(
    categoria_id: Optional[str] = None,
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("artigos", "view")),
):
    query = {"categoria_id": categoria_id} if categoria_id else {}
    ts = text_search(["nome", "codigo", "categoria_nome"], q)
    if ts:
        query = {"$and": [query, ts]} if query else ts
    return await _list_or_page(subcategorias_repo, query, ("nome", 1), page, page_size)


@router.post("/subcategorias", response_model=Subcategoria)
async def create_subcategoria(data: SubcategoriaInput, user: dict = Depends(require_perm("artigos", "create"))):
    cat = await categorias_repo.get(data.categoria_id)
    if not cat:
        raise HTTPException(400, "Categoria inválida")
    s = Subcategoria(**data.model_dump())
    s.codigo = await next_codigo("subcategoria")
    s.categoria_nome = cat.get("nome") or ""
    await subcategorias_repo.insert(s.model_dump())
    await audit.registar("subcategoria", s.id, "criado", user, f"Subcategoria «{s.nome}» criada", s.codigo or s.nome)
    return s


@router.put("/subcategorias/{sid}", response_model=Subcategoria)
async def update_subcategoria(sid: str, data: SubcategoriaInput, user: dict = Depends(require_perm("artigos", "edit"))):
    existing = await subcategorias_repo.get(sid)
    if not existing:
        raise HTTPException(404, "Subcategoria não encontrada")
    cat = await categorias_repo.get(data.categoria_id)
    if not cat:
        raise HTTPException(400, "Categoria inválida")
    novo = data.model_dump()
    novo["categoria_nome"] = cat.get("nome") or ""
    alteracoes = audit.diff_campos(existing, novo, ["nome", "categoria_id"])
    await subcategorias_repo.update(sid, novo)
    if novo.get("nome") and novo["nome"] != existing.get("nome"):
        await artigos_repo.update_many({"subcategoria_id": sid}, {"subcategoria_nome": novo["nome"]})
    # se mudou de categoria, actualizar artigos
    if data.categoria_id != existing.get("categoria_id"):
        await artigos_repo.update_many(
            {"subcategoria_id": sid},
            {"categoria_id": data.categoria_id, "categoria_nome": novo["categoria_nome"], "subcategoria_nome": novo.get("nome") or ""},
        )
    existing.update(novo)
    if alteracoes:
        await audit.registar("subcategoria", sid, "editado", user, f"Subcategoria «{novo.get('nome')}» editada", novo.get("nome"), alteracoes)
    return existing


@router.delete("/subcategorias/{sid}")
async def delete_subcategoria(sid: str, user: dict = Depends(require_perm("artigos", "delete"))):
    existing = await subcategorias_repo.get(sid)
    if not existing:
        raise HTTPException(404, "Subcategoria não encontrada")
    if await artigos_repo.find_one({"subcategoria_id": sid}):
        raise HTTPException(400, "Subcategoria em uso por artigos")
    await subcategorias_repo.delete({"id": sid})
    await audit.registar("subcategoria", sid, "eliminado", user, f"Subcategoria «{existing.get('nome')}» eliminada", existing.get("codigo") or existing.get("nome"))
    return {"ok": True}
