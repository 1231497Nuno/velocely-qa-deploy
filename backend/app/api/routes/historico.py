from typing import Optional

from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.services import audit

router = APIRouter()


@router.get("/historico")
async def historico_global(
    tipo: Optional[str] = None,
    limit: int = 300,
    _u: dict = Depends(get_current_user),
):
    return await audit.historico(entidade_tipo=tipo, limit=limit)


@router.get("/historico/{entidade_tipo}/{entidade_id}")
async def historico_entidade(
    entidade_tipo: str,
    entidade_id: str,
    _u: dict = Depends(get_current_user),
):
    return await audit.historico(entidade_tipo=entidade_tipo, entidade_id=entidade_id)
