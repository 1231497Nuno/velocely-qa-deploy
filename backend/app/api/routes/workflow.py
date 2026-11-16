"""Tarefas (aprovações + alertas) e configuração das aprovações e alertas."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.security import get_current_user, require_admin, resolve_perfil
from app.repositories import ordens_compra_repo, orcamentos_repo
from app.services import workflow as wf
from app.services.costing import compute_orcamento_totais

router = APIRouter()


@router.get("/tarefas")
async def listar_tarefas(filtro: str = Query("pendentes"), todas: bool = Query(False), user: dict = Depends(get_current_user)):
    if todas and not (await resolve_perfil(user)).get("admin"):
        todas = False
    return await wf.listar(user, filtro=filtro, todas=todas)


@router.get("/tarefas/contagem")
async def contagem_tarefas(user: dict = Depends(get_current_user)):
    await wf.verificar_prazos()
    return await wf.contagem(user)


@router.post("/tarefas/lidas")
async def marcar_todas_lidas(user: dict = Depends(get_current_user)):
    await wf.marcar_lida(None, user)
    return {"ok": True}


@router.post("/tarefas/{tid}/lida")
async def marcar_lida(tid: str, user: dict = Depends(get_current_user)):
    await wf.marcar_lida(tid, user)
    return {"ok": True}


class DecisaoBody(BaseModel):
    aprovar: bool
    motivo: str = ""


@router.post("/tarefas/{tid}/decidir")
async def decidir(tid: str, body: DecisaoBody, user: dict = Depends(get_current_user)):
    return await wf.decidir(tid, body.aprovar, body.motivo, user)


@router.get("/aprovacoes/estado")
async def estado_aprovacao(entidade: str, entidade_id: str, user: dict = Depends(get_current_user)):
    t = await wf.estado_aprovacao(entidade, entidade_id)
    if not t:
        return {"estado": None}
    return {**{k: v for k, v in t.items() if k not in ("_id", "lida_por")},
            "posso_decidir": t.get("estado") == "pendente" and await wf.pode_decidir(t, user)}


class PedirBody(BaseModel):
    entidade: str
    entidade_id: str


@router.post("/aprovacoes/pedir")
async def pedir_aprovacao(body: PedirBody, user: dict = Depends(get_current_user)):
    """Pede aprovação antecipadamente (antes de criar/enviar o orçamento ou receber a OC)."""
    try:
        if body.entidade == "orcamento":
            o = await orcamentos_repo.get(body.entidade_id)
            if not o:
                raise HTTPException(404, "Orçamento não encontrado")
            await wf.exigir_aprovacao_orcamento(compute_orcamento_totais(o), user, "avançar com o orçamento")
        elif body.entidade == "ordem_compra":
            o = await ordens_compra_repo.get(body.entidade_id)
            if not o:
                raise HTTPException(404, "Ordem de compra não encontrada")
            await wf.exigir_aprovacao_oc(o, user, "avançar com a ordem de compra")
        else:
            raise HTTPException(400, "Tipo de documento sem aprovações")
    except HTTPException as ex:
        if isinstance(ex.detail, dict) and ex.detail.get("codigo", "").startswith("aprovacao"):
            return {"precisa": True, **ex.detail}
        raise
    return {"precisa": False, "mensagem": "Não precisa de aprovação (ou já está aprovado)."}


@router.get("/definicoes/workflow")
async def get_workflow(_u: dict = Depends(get_current_user)):
    return {"config": await wf.get_config(), **wf.catalogo()}


class WorkflowBody(BaseModel):
    aprovacoes: Optional[dict] = None
    alertas: Optional[dict] = None
    credito_modo: Optional[str] = None


@router.put("/definicoes/workflow")
async def put_workflow(body: WorkflowBody, _a: dict = Depends(require_admin)):
    return {"config": await wf.guardar(body.model_dump(exclude_unset=True)), **wf.catalogo()}
