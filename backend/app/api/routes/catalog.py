from typing import List

from fastapi import APIRouter, Depends, HTTPException

from app.domain.models import (
    Maquina, MaquinaInput, Consumivel, ConsumivelInput, MaoObra, MaoObraInput,
    Artigo, ArtigoInput, TipoPersonalizacao, TipoPersonalizacaoInput,
)
from app.core.database import new_id, now_iso
from app.core.security import get_current_user
from app.repositories import maquinas_repo, consumiveis_repo, mao_obra_repo, artigos_repo, tipos_repo
from app.services.costing import artigo_breakdown, enrich_artigo
from app.services import audit

router = APIRouter()


# ----------------------- Máquinas -----------------------
@router.get("/maquinas", response_model=List[Maquina])
async def list_maquinas():
    return await maquinas_repo.find(sort=("nome", 1))


@router.post("/maquinas", response_model=Maquina)
async def create_maquina(data: MaquinaInput, user: dict = Depends(get_current_user)):
    m = Maquina(**data.model_dump())
    await maquinas_repo.insert(m.model_dump())
    await audit.registar("maquina", m.id, "criado", user, f"Máquina «{m.nome}» criada", m.nome)
    return m


@router.put("/maquinas/{mid}", response_model=Maquina)
async def update_maquina(mid: str, data: MaquinaInput, user: dict = Depends(get_current_user)):
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
async def delete_maquina(mid: str, user: dict = Depends(get_current_user)):
    existing = await maquinas_repo.get(mid)
    await maquinas_repo.delete({"id": mid})
    if existing:
        await audit.registar("maquina", mid, "eliminado", user, f"Máquina «{existing.get('nome')}» eliminada", existing.get("nome"))
    return {"ok": True}


# ----------------------- Consumíveis (Materiais) -----------------------
@router.get("/consumiveis", response_model=List[Consumivel])
async def list_consumiveis():
    return await consumiveis_repo.find(sort=("nome", 1))


@router.post("/consumiveis", response_model=Consumivel)
async def create_consumivel(data: ConsumivelInput, user: dict = Depends(get_current_user)):
    c = Consumivel(**data.model_dump())
    await consumiveis_repo.insert(c.model_dump())
    await audit.registar("consumivel", c.id, "criado", user, f"Material «{c.nome}» criado", c.nome)
    return c


@router.put("/consumiveis/{cid}", response_model=Consumivel)
async def update_consumivel(cid: str, data: ConsumivelInput, user: dict = Depends(get_current_user)):
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
async def delete_consumivel(cid: str, user: dict = Depends(get_current_user)):
    existing = await consumiveis_repo.get(cid)
    await consumiveis_repo.delete({"id": cid})
    if existing:
        await audit.registar("consumivel", cid, "eliminado", user, f"Material «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}


# ----------------------- Mão de Obra -----------------------
@router.get("/mao-obra", response_model=List[MaoObra])
async def list_mao_obra():
    return await mao_obra_repo.find(sort=("nome", 1))


@router.post("/mao-obra", response_model=MaoObra)
async def create_mao_obra(data: MaoObraInput, user: dict = Depends(get_current_user)):
    m = MaoObra(**data.model_dump())
    await mao_obra_repo.insert(m.model_dump())
    await audit.registar("mao_obra", m.id, "criado", user, f"Mão de obra «{m.nome}» criada", m.nome)
    return m


@router.put("/mao-obra/{mid}", response_model=MaoObra)
async def update_mao_obra(mid: str, data: MaoObraInput, user: dict = Depends(get_current_user)):
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
async def delete_mao_obra(mid: str, user: dict = Depends(get_current_user)):
    existing = await mao_obra_repo.get(mid)
    await mao_obra_repo.delete({"id": mid})
    if existing:
        await audit.registar("mao_obra", mid, "eliminado", user, f"Mão de obra «{existing.get('nome')}» eliminada", existing.get("nome"))
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
async def create_artigo(data: ArtigoInput, user: dict = Depends(get_current_user)):
    a = Artigo(**data.model_dump())
    doc = a.model_dump()
    await artigos_repo.insert(doc)
    doc.pop("_id", None)
    await audit.registar("artigo", a.id, "criado", user, f"Artigo «{a.nome}» criado", a.nome)
    return enrich_artigo(doc, await artigo_breakdown(doc))


@router.put("/artigos/{aid}")
async def update_artigo(aid: str, data: ArtigoInput, user: dict = Depends(get_current_user)):
    existing = await artigos_repo.get(aid)
    if not existing:
        raise HTTPException(404, "Artigo não encontrado")
    update = data.model_dump()
    alteracoes = audit.diff_campos(existing, update, ["nome", "descricao", "unidade", "custo_artigo", "margem"])
    await artigos_repo.update(aid, update)
    existing.update(update)
    await audit.registar("artigo", aid, "editado", user, f"Artigo «{update.get('nome')}» editado", update.get("nome"), alteracoes)
    return enrich_artigo(existing, await artigo_breakdown(existing))


@router.delete("/artigos/{aid}")
async def delete_artigo(aid: str, user: dict = Depends(get_current_user)):
    existing = await artigos_repo.get(aid)
    await artigos_repo.delete({"id": aid})
    if existing:
        await audit.registar("artigo", aid, "eliminado", user, f"Artigo «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}


@router.post("/artigos/{aid}/duplicar")
async def duplicar_artigo(aid: str, user: dict = Depends(get_current_user)):
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
    await audit.registar("artigo", novo["id"], "duplicado", user, f"Artigo «{novo['nome']}» criado a partir de «{a.get('nome')}»", novo["nome"])
    return enrich_artigo(novo, await artigo_breakdown(novo))


# ----------------------- Tipos de Personalização -----------------------
@router.get("/tipos-personalizacao", response_model=List[TipoPersonalizacao])
async def list_tipos():
    return await tipos_repo.find(sort=("nome", 1))


@router.post("/tipos-personalizacao", response_model=TipoPersonalizacao)
async def create_tipo(data: TipoPersonalizacaoInput, user: dict = Depends(get_current_user)):
    t = TipoPersonalizacao(**data.model_dump())
    await tipos_repo.insert(t.model_dump())
    await audit.registar("tipo_personalizacao", t.id, "criado", user, f"Tipo «{t.nome}» criado", t.nome)
    return t


@router.put("/tipos-personalizacao/{tid}", response_model=TipoPersonalizacao)
async def update_tipo(tid: str, data: TipoPersonalizacaoInput, user: dict = Depends(get_current_user)):
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
async def delete_tipo(tid: str, user: dict = Depends(get_current_user)):
    existing = await tipos_repo.get(tid)
    await tipos_repo.delete({"id": tid})
    if existing:
        await audit.registar("tipo_personalizacao", tid, "eliminado", user, f"Tipo «{existing.get('nome')}» eliminado", existing.get("nome"))
    return {"ok": True}
