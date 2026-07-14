from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user
from app.domain.models import Cliente, ClienteInput
from app.repositories import clientes_repo

router = APIRouter()


@router.get("/clientes")
async def list_clientes(_u: dict = Depends(get_current_user)):
    return await clientes_repo.find(sort=("nome", 1), limit=5000)


@router.post("/clientes")
async def create_cliente(data: ClienteInput, _u: dict = Depends(get_current_user)):
    c = Cliente(**data.model_dump())
    await clientes_repo.insert(c.model_dump())
    return c.model_dump()


@router.put("/clientes/{cid}")
async def update_cliente(cid: str, data: ClienteInput, _u: dict = Depends(get_current_user)):
    existing = await clientes_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Cliente não encontrado")
    await clientes_repo.update(cid, data.model_dump())
    return {**existing, **data.model_dump()}


@router.delete("/clientes/{cid}")
async def delete_cliente(cid: str, _u: dict = Depends(get_current_user)):
    await clientes_repo.delete({"id": cid})
    return {"ok": True}
