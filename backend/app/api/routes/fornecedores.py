from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload, text_search_nome_prefix
from app.core.database import round2
from app.domain.models import Fornecedor, FornecedorInput
from app.repositories import fornecedores_repo, ordens_compra_repo
from app.services.numeracao import next_codigo
from app.services import audit

_FORNECEDOR_CAMPOS = [
    "nome", "tipo", "morada", "codigo_postal", "cidade", "pais",
    "contacto", "email", "nif", "website", "categoria", "notas", "responsavel",
]

router = APIRouter()


@router.get("/fornecedores")
async def list_fornecedores(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    sort: str = Query("nome", description="Campo: nome | codigo"),
    order: str = Query("asc", description="asc | desc"),
    _u: dict = Depends(require_perm("fornecedores", "view")),
):
    query = {}
    ts = text_search_nome_prefix(q)
    if ts:
        query.update(ts)
    sort_field = sort if sort in ("nome", "codigo") else "nome"
    sort_dir = -1 if (order or "").lower() == "desc" else 1
    sort_spec = (sort_field, sort_dir)
    if page is None:
        return await fornecedores_repo.find(query, sort=sort_spec, limit=5000)
    import asyncio
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        fornecedores_repo.count(query),
        fornecedores_repo.find(query, sort=sort_spec, limit=ps, skip=skip),
    )
    return page_payload(items, total, p, ps)


@router.get("/fornecedores/{fid}/resumo")
async def fornecedor_resumo(fid: str, _u: dict = Depends(require_perm("fornecedores", "view"))):
    f = await fornecedores_repo.get(fid)
    if not f:
        raise HTTPException(404, "Fornecedor não encontrado")
    nome = f.get("nome") or ""

    ocs = await ordens_compra_repo.find({"fornecedor_id": fid}, sort=("data", -1), limit=5000)
    if not ocs and nome:
        ocs = await ordens_compra_repo.find(
            {
                "$or": [
                    {"fornecedor_id": {"$in": [None, ""]}},
                    {"fornecedor_id": {"$exists": False}},
                ],
                "fornecedor_nome": nome,
            },
            sort=("data", -1),
            limit=5000,
        )

    def _sum(tipo: str) -> float:
        return round2(sum((o.get("total") or 0) for o in ocs if o.get("tipo_despesa") == tipo))

    ordens = [
        {
            "id": o["id"],
            "codigo": o.get("codigo"),
            "codigo_origem": o.get("codigo_origem"),
            "assunto": o.get("assunto"),
            "tipo_compra": o.get("tipo_compra"),
            "tipo_despesa": o.get("tipo_despesa"),
            "estado": o.get("estado"),
            "total": o.get("total"),
            "valor_pago": o.get("valor_pago"),
            "data": o.get("data"),
            "vencimento": o.get("vencimento"),
        }
        for o in ocs
    ]

    total = round2(sum((o.get("total") or 0) for o in ocs))
    pago = round2(sum((o.get("valor_pago") or 0) for o in ocs))
    stats = {
        "num_ordens": len(ocs),
        "total": total,
        "valor_pago": pago,
        "pendente": round2(max(0, total - pago)),
        "compra": _sum("compra"),
        "despesa_normal": _sum("despesa_normal"),
        "despesa_diversa": _sum("despesa_diversa"),
        "recebidas": sum(1 for o in ocs if o.get("estado") == "recebida"),
    }
    return {"fornecedor": f, "ordens_compra": ordens, "stats": stats}


@router.get("/fornecedores/{fid}")
async def get_fornecedor(fid: str, _u: dict = Depends(require_perm("fornecedores", "view"))):
    f = await fornecedores_repo.get(fid)
    if not f:
        raise HTTPException(404, "Fornecedor não encontrado")
    return f


@router.post("/fornecedores")
async def create_fornecedor(data: FornecedorInput, user: dict = Depends(require_perm("fornecedores", "create"))):
    f = Fornecedor(**data.model_dump())
    f.codigo = await next_codigo("fornecedor")
    await fornecedores_repo.insert(f.model_dump())
    await audit.registar("fornecedor", f.id, "criado", user, f"Fornecedor «{f.nome}» criado", f.codigo or f.nome)
    return f.model_dump()


@router.put("/fornecedores/{fid}")
async def update_fornecedor(fid: str, data: FornecedorInput, user: dict = Depends(require_perm("fornecedores", "edit"))):
    existing = await fornecedores_repo.get(fid)
    if not existing:
        raise HTTPException(404, "Fornecedor não encontrado")
    novo = data.model_dump()
    alteracoes = audit.diff_campos(existing, novo, _FORNECEDOR_CAMPOS)
    await fornecedores_repo.update(fid, novo)
    if alteracoes:
        await audit.registar(
            "fornecedor", fid, "editado", user,
            f"Fornecedor «{novo.get('nome')}» editado", novo.get("nome"), alteracoes,
        )
    return {**existing, **novo}


@router.delete("/fornecedores/{fid}")
async def delete_fornecedor(fid: str, user: dict = Depends(require_perm("fornecedores", "delete"))):
    existing = await fornecedores_repo.get(fid)
    await fornecedores_repo.delete({"id": fid})
    if existing:
        await audit.registar(
            "fornecedor", fid, "eliminado", user,
            f"Fornecedor «{existing.get('nome')}» eliminado", existing.get("nome"),
        )
    return {"ok": True}
