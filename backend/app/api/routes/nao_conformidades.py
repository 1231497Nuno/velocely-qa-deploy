"""Não conformidades ligadas a referências (artigos) de encomendas."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import require_perm
from app.core.pagination import parse_page, page_payload, text_search
from app.domain.models import (
    NaoConformidade, NaoConformidadeInput, NC_ESTADO_PT, NC_TIPO_PT,
)
from app.repositories import (
    nao_conformidades_repo, encomendas_repo, artigos_repo,
)
from app.services.numeracao import next_codigo
from app.services import audit

router = APIRouter()

_NC_CAMPOS = ["tipo", "descricao", "acao_corretiva", "estado", "quantidade", "notas"]
_ESTADOS = set(NC_ESTADO_PT)
_TIPOS = set(NC_TIPO_PT)


def _user_nome(user: dict) -> str:
    return (user or {}).get("name") or (user or {}).get("login") or (user or {}).get("email") or ""


async def _fill_referencia(enc: dict, data: NaoConformidadeInput) -> NaoConformidadeInput:
    linha = None
    if data.encomenda_artigo_id:
        linha = next(
            (a for a in (enc.get("artigos") or []) if a.get("id") == data.encomenda_artigo_id),
            None,
        )
        if not linha:
            raise HTTPException(400, "A referência não pertence a esta encomenda")
    elif data.artigo_id:
        linha = next(
            (a for a in (enc.get("artigos") or []) if a.get("artigo_id") == data.artigo_id),
            None,
        )
    if not linha:
        raise HTTPException(400, "Indique a referência (artigo da encomenda) da não conformidade")

    data.encomenda_artigo_id = linha.get("id") or data.encomenda_artigo_id
    data.artigo_id = linha.get("artigo_id") or data.artigo_id
    data.artigo_nome = data.artigo_nome or linha.get("artigo_nome") or ""
    if not data.artigo_codigo and data.artigo_id:
        art = await artigos_repo.get(data.artigo_id)
        data.artigo_codigo = (art or {}).get("codigo") or ""
    if (data.quantidade or 0) <= 0:
        data.quantidade = float(linha.get("quantidade") or 0) or 1
    return data


@router.get("/nao-conformidades")
async def list_nao_conformidades(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    estado: str = Query(""),
    encomenda_id: str = Query(""),
    _u: dict = Depends(require_perm("nao_conformidades", "view")),
):
    query: dict = {}
    ts = text_search(
        ["numero", "encomenda_numero", "artigo_nome", "artigo_codigo", "cliente", "descricao"],
        q,
    )
    if ts:
        query.update(ts)
    if estado in _ESTADOS:
        query["estado"] = estado
    if encomenda_id:
        query["encomenda_id"] = encomenda_id
    if page is None:
        return await nao_conformidades_repo.find(query, sort=("created_at", -1), limit=5000)
    import asyncio
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        nao_conformidades_repo.count(query),
        nao_conformidades_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip),
    )
    return page_payload(items, total, p, ps)


@router.get("/nao-conformidades/{nid}")
async def get_nao_conformidade(nid: str, _u: dict = Depends(require_perm("nao_conformidades", "view"))):
    nc = await nao_conformidades_repo.get(nid)
    if not nc:
        raise HTTPException(404, "Não conformidade não encontrada")
    return nc


@router.get("/encomendas/{eid}/nao-conformidades")
async def list_nc_encomenda(eid: str, _u: dict = Depends(require_perm("nao_conformidades", "view"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    return await nao_conformidades_repo.find({"encomenda_id": eid}, sort=("created_at", -1), limit=500)


@router.post("/encomendas/{eid}/nao-conformidades")
async def create_nc_encomenda(
    eid: str,
    data: NaoConformidadeInput,
    user: dict = Depends(require_perm("nao_conformidades", "create")),
):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    if enc.get("estado") == "cancelada":
        raise HTTPException(400, "Não é possível abrir não conformidades numa encomenda cancelada")
    if not enc.get("entregue"):
        raise HTTPException(400, "Só é possível abrir não conformidades sobre material já entregue.")
    if data.tipo not in _TIPOS:
        raise HTTPException(400, f"Tipo inválido. Use: {', '.join(NC_TIPO_PT)}")
    if not (data.descricao or "").strip():
        raise HTTPException(400, "Descreva a não conformidade")
    data = await _fill_referencia(enc, data)
    payload = data.model_dump()
    payload.update({
        "encomenda_id": eid,
        "encomenda_numero": enc.get("numero") or "",
        "cliente": enc.get("cliente") or "",
        "cliente_id": enc.get("cliente_id"),
        "created_by": user.get("id"),
        "created_by_nome": _user_nome(user),
    })
    nc = NaoConformidade(**payload)
    nc.numero = await next_codigo("nao_conformidade")
    dumped = nc.model_dump()
    await nao_conformidades_repo.insert(dumped)
    ref = nc.artigo_codigo or nc.artigo_nome or "referência"
    await audit.registar(
        "nao_conformidade", nc.id, "criado", user,
        f"Não conformidade {nc.numero} aberta na encomenda {nc.encomenda_numero} · {ref}",
        nc.numero,
    )
    await audit.registar(
        "encomenda", eid, "nao_conformidade", user,
        f"Não conformidade {nc.numero} aberta na referência {ref}",
        enc.get("numero"),
    )
    return dumped


@router.put("/nao-conformidades/{nid}")
async def update_nao_conformidade(
    nid: str,
    data: NaoConformidadeInput,
    user: dict = Depends(require_perm("nao_conformidades", "edit")),
):
    existing = await nao_conformidades_repo.get(nid)
    if not existing:
        raise HTTPException(404, "Não conformidade não encontrada")
    if data.tipo and data.tipo not in _TIPOS:
        raise HTTPException(400, f"Tipo inválido. Use: {', '.join(NC_TIPO_PT)}")
    if data.estado and data.estado not in _ESTADOS:
        raise HTTPException(400, f"Estado inválido. Use: {', '.join(NC_ESTADO_PT)}")
    patch = data.model_dump(exclude_unset=True)
    patch = {k: patch[k] for k in _NC_CAMPOS if k in patch}
    if not patch:
        return existing
    await nao_conformidades_repo.update(nid, patch)
    merged = {**existing, **patch}
    alteracoes = audit.diff_campos(existing, merged, _NC_CAMPOS)
    if existing.get("estado") != merged.get("estado"):
        await audit.registar(
            "nao_conformidade", nid, "estado_alterado", user,
            f"Não conformidade {existing.get('numero')} → {NC_ESTADO_PT.get(merged.get('estado'), merged.get('estado'))}",
            existing.get("numero"),
        )
    elif alteracoes:
        await audit.registar(
            "nao_conformidade", nid, "editado", user,
            f"Não conformidade {existing.get('numero')} editada",
            existing.get("numero"),
            alteracoes,
        )
    return merged


@router.delete("/nao-conformidades/{nid}")
async def delete_nao_conformidade(
    nid: str,
    user: dict = Depends(require_perm("nao_conformidades", "delete")),
):
    existing = await nao_conformidades_repo.get(nid)
    await nao_conformidades_repo.delete({"id": nid})
    if existing:
        await audit.registar(
            "nao_conformidade", nid, "eliminado", user,
            f"Não conformidade {existing.get('numero')} eliminada",
            existing.get("numero"),
        )
    return {"ok": True}
