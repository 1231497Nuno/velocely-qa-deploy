from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.services import referencias

router = APIRouter()


@router.get("/maquinas/{mid}/utilizacoes")
async def maquina_utilizacoes(mid: str, _u: dict = Depends(get_current_user)):
    return await referencias.maquina_utilizacoes(mid)


@router.get("/mao-obra/{mid}/utilizacoes")
async def mao_obra_utilizacoes(mid: str, _u: dict = Depends(get_current_user)):
    return await referencias.mao_obra_utilizacoes(mid)


@router.get("/consumiveis/{cid}/utilizacoes")
async def consumivel_utilizacoes(cid: str, _u: dict = Depends(get_current_user)):
    return await referencias.consumivel_utilizacoes(cid)


@router.get("/tipos-personalizacao/{tid}/utilizacoes")
async def tipo_pers_utilizacoes(tid: str, _u: dict = Depends(get_current_user)):
    return await referencias.tipo_pers_utilizacoes(tid)


@router.get("/artigos/{aid}/utilizacoes")
async def artigo_utilizacoes(aid: str, _u: dict = Depends(get_current_user)):
    return await referencias.artigo_utilizacoes(aid)
