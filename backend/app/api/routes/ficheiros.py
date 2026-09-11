"""Ficheiros e fotos associados a artigos e documentos."""
from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.core.security import require_perm, get_current_user
from app.services import ficheiros as fic

router = APIRouter()


async def _check(tipo: str, acao: str, user: dict):
    meta = fic.cfg(tipo)
    return await require_perm(meta["perm"], acao)(user)


@router.get("/ficheiros/{tipo}/{eid}")
async def get_ficheiros(tipo: str, eid: str, user: dict = Depends(get_current_user)):
    await _check(tipo, "view", user)
    return await fic.listar(tipo, eid)


@router.post("/ficheiros/{tipo}/{eid}")
async def post_ficheiro(
    tipo: str,
    eid: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    await _check(tipo, "edit", user)
    return await fic.adicionar(tipo, eid, file, user)


@router.delete("/ficheiros/{tipo}/{eid}")
async def delete_ficheiro(
    tipo: str,
    eid: str,
    item: str = Query(..., description="id do anexo ou img:<path>"),
    user: dict = Depends(get_current_user),
):
    await _check(tipo, "edit", user)
    return await fic.remover(tipo, eid, item, user)
