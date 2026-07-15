from typing import List

from fastapi import APIRouter, HTTPException

from app.domain.models import (
    Maquina, MaquinaInput, Consumivel, ConsumivelInput, MaoObra, MaoObraInput,
    Artigo, ArtigoInput, TipoPersonalizacao, TipoPersonalizacaoInput,
)
from app.core.database import new_id, now_iso
from app.repositories import maquinas_repo, consumiveis_repo, mao_obra_repo, artigos_repo, tipos_repo
from app.services.costing import artigo_breakdown, artigo_custo_total, enrich_artigo

router = APIRouter()


# ----------------------- Máquinas -----------------------
@router.get("/maquinas", response_model=List[Maquina])
async def list_maquinas():
    return await maquinas_repo.find(sort=("nome", 1))


@router.post("/maquinas", response_model=Maquina)
async def create_maquina(data: MaquinaInput):
    m = Maquina(**data.model_dump())
    await maquinas_repo.insert(m.model_dump())
    return m


@router.put("/maquinas/{mid}", response_model=Maquina)
async def update_maquina(mid: str, data: MaquinaInput):
    existing = await maquinas_repo.get(mid)
    if not existing:
        raise HTTPException(404, "Máquina não encontrada")
    existing.update(data.model_dump())
    await maquinas_repo.update(mid, data.model_dump())
    return existing


@router.delete("/maquinas/{mid}")
async def delete_maquina(mid: str):
    await maquinas_repo.delete({"id": mid})
    return {"ok": True}


# ----------------------- Consumíveis (Materiais) -----------------------
@router.get("/consumiveis", response_model=List[Consumivel])
async def list_consumiveis():
    return await consumiveis_repo.find(sort=("nome", 1))


@router.post("/consumiveis", response_model=Consumivel)
async def create_consumivel(data: ConsumivelInput):
    c = Consumivel(**data.model_dump())
    await consumiveis_repo.insert(c.model_dump())
    return c


@router.put("/consumiveis/{cid}", response_model=Consumivel)
async def update_consumivel(cid: str, data: ConsumivelInput):
    existing = await consumiveis_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Consumível não encontrado")
    await consumiveis_repo.update(cid, data.model_dump())
    existing.update(data.model_dump())
    return existing


@router.delete("/consumiveis/{cid}")
async def delete_consumivel(cid: str):
    await consumiveis_repo.delete({"id": cid})
    return {"ok": True}


# ----------------------- Mão de Obra -----------------------
@router.get("/mao-obra", response_model=List[MaoObra])
async def list_mao_obra():
    return await mao_obra_repo.find(sort=("nome", 1))


@router.post("/mao-obra", response_model=MaoObra)
async def create_mao_obra(data: MaoObraInput):
    m = MaoObra(**data.model_dump())
    await mao_obra_repo.insert(m.model_dump())
    return m


@router.put("/mao-obra/{mid}", response_model=MaoObra)
async def update_mao_obra(mid: str, data: MaoObraInput):
    existing = await mao_obra_repo.get(mid)
    if not existing:
        raise HTTPException(404, "Mão de obra não encontrada")
    await mao_obra_repo.update(mid, data.model_dump())
    existing.update(data.model_dump())
    return existing


@router.delete("/mao-obra/{mid}")
async def delete_mao_obra(mid: str):
    await mao_obra_repo.delete({"id": mid})
    return {"ok": True}


# ----------------------- Artigos -----------------------
@router.get("/artigos")
async def list_artigos():
    artigos = await artigos_repo.find(sort=("nome", 1))
    result = []
    for a in artigos:
        result.append(enrich_artigo(a, await artigo_breakdown(a)))
    return result


@router.get("/artigos/{aid}")
async def get_artigo(aid: str):
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    return enrich_artigo(a, await artigo_breakdown(a))


@router.post("/artigos")
async def create_artigo(data: ArtigoInput):
    a = Artigo(**data.model_dump())
    doc = a.model_dump()
    await artigos_repo.insert(doc)
    doc.pop("_id", None)
    return enrich_artigo(doc, await artigo_breakdown(doc))


@router.put("/artigos/{aid}")
async def update_artigo(aid: str, data: ArtigoInput):
    existing = await artigos_repo.get(aid)
    if not existing:
        raise HTTPException(404, "Artigo não encontrado")
    update = data.model_dump()
    await artigos_repo.update(aid, update)
    existing.update(update)
    return enrich_artigo(existing, await artigo_breakdown(existing))


@router.delete("/artigos/{aid}")
async def delete_artigo(aid: str):
    await artigos_repo.delete({"id": aid})
    return {"ok": True}


@router.post("/artigos/{aid}/duplicar")
async def duplicar_artigo(aid: str):
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    novo = {**a}
    novo.update({
        "id": new_id(),
        "nome": f"{a.get('nome', 'Artigo')} (cópia)",
        "created_at": now_iso(),
    })
    await artigos_repo.insert(novo)
    return enrich_artigo(novo, await artigo_breakdown(novo))


# ----------------------- Tipos de Personalização -----------------------
@router.get("/tipos-personalizacao", response_model=List[TipoPersonalizacao])
async def list_tipos():
    return await tipos_repo.find(sort=("nome", 1))


@router.post("/tipos-personalizacao", response_model=TipoPersonalizacao)
async def create_tipo(data: TipoPersonalizacaoInput):
    t = TipoPersonalizacao(**data.model_dump())
    await tipos_repo.insert(t.model_dump())
    return t


@router.put("/tipos-personalizacao/{tid}", response_model=TipoPersonalizacao)
async def update_tipo(tid: str, data: TipoPersonalizacaoInput):
    existing = await tipos_repo.get(tid)
    if not existing:
        raise HTTPException(404, "Tipo não encontrado")
    await tipos_repo.update(tid, data.model_dump())
    existing.update(data.model_dump())
    return existing


@router.delete("/tipos-personalizacao/{tid}")
async def delete_tipo(tid: str):
    await tipos_repo.delete({"id": tid})
    return {"ok": True}
