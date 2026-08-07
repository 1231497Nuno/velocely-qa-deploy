from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload
from app.services import audit
from app.repositories import historico_repo

router = APIRouter()


@router.get("/historico")
async def historico_global(
    tipo: Optional[str] = None,
    limit: int = 300,
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    _u: dict = Depends(require_perm("historico", "view")),
):
    if page is None:
        return await audit.historico(entidade_tipo=tipo, limit=limit)
    query = {}
    if tipo:
        query["entidade_tipo"] = tipo
    ql = (q or "").strip()
    if ql:
        import re
        rx = {"$regex": re.escape(ql), "$options": "i"}
        query["$or"] = [
            {"descricao": rx}, {"entidade_numero": rx}, {"acao_label": rx},
            {"utilizador_nome": rx}, {"utilizador_login": rx}, {"tipo_label": rx},
        ]
    p, ps, skip = parse_page(page, page_size)
    total = await historico_repo.count(query)
    items = await historico_repo.find(query, sort=("timestamp", -1), limit=ps, skip=skip)
    return page_payload(items, total, p, ps)


@router.get("/historico/{entidade_tipo}/{entidade_id}")
async def historico_entidade(
    entidade_tipo: str,
    entidade_id: str,
    _u: dict = Depends(require_perm("historico", "view")),
):
    return await audit.historico(entidade_tipo=entidade_tipo, entidade_id=entidade_id)
