"""Tabelas de preços (Catálogo → Tabelas de preços)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.security import get_current_user, require_admin, require_perm
from app.repositories import tabelas_precos_repo
from app.services import audit
from app.services import precos as svc

router = APIRouter()


@router.get("/tabelas-precos")
async def listar(_u: dict = Depends(require_perm("artigos", "view"))):
    return await tabelas_precos_repo.find({}, sort=("prioridade", 1), limit=500)


@router.post("/tabelas-precos")
async def criar(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    t = svc.normalizar(dados)
    await tabelas_precos_repo.insert(t)
    await audit.registar("tabela_precos", t["id"], "criado", user, f"Tabela de preços «{t['nome']}» criada", t["nome"])
    return t


@router.put("/tabelas-precos/{tid}")
async def editar(tid: str, dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    ex = await tabelas_precos_repo.get(tid)
    if not ex:
        raise HTTPException(404, "Tabela não encontrada")
    t = svc.normalizar(dados, {k: v for k, v in ex.items() if k in ("id", "created_at")})
    await tabelas_precos_repo.update(tid, t)
    await audit.registar("tabela_precos", tid, "editado", user, f"Tabela de preços «{t['nome']}» editada", t["nome"])
    return t


@router.delete("/tabelas-precos/{tid}")
async def apagar(tid: str, user: dict = Depends(require_perm("artigos", "delete"))):
    ex = await tabelas_precos_repo.get(tid)
    if not ex:
        raise HTTPException(404, "Tabela não encontrada")
    await tabelas_precos_repo.delete({"id": tid})
    await audit.registar("tabela_precos", tid, "eliminado", user, f"Tabela de preços «{ex.get('nome')}» eliminada", ex.get("nome"))
    return {"ok": True}


class LinhaPreco(BaseModel):
    artigo_id: Optional[str] = None
    categoria_id: Optional[str] = None
    quantidade: float = 1


class AplicarBody(BaseModel):
    cliente_id: Optional[str] = None
    data: Optional[str] = None
    linhas: List[LinhaPreco]


@router.post("/tabelas-precos/aplicar")
async def aplicar(body: AplicarBody, _u: dict = Depends(get_current_user)):
    return await svc.aplicar(body.cliente_id, [l.model_dump() for l in body.linhas], body.data)


# ---------------------------------------------------------------------------
# Guias de remessa / transporte
# ---------------------------------------------------------------------------
from io import BytesIO  # noqa: E402

from fastapi.responses import StreamingResponse  # noqa: E402

from app.repositories import empresa_repo, guias_repo  # noqa: E402
from app.services import guias as guias_svc  # noqa: E402


@router.get("/encomendas/{eid}/guias/previsao")
async def guias_previsao(eid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    return await guias_svc.previsao(eid)


@router.post("/encomendas/{eid}/guias")
async def criar_guia(eid: str, dados: dict, user: dict = Depends(require_perm("encomendas", "edit"))):
    return await guias_svc.criar(eid, dados, user)


@router.get("/guias/{gid}")
async def obter_guia(gid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    g = await guias_repo.get(gid)
    if not g:
        raise HTTPException(404, "Guia não encontrada")
    return g


@router.post("/guias/{gid}/emitir")
async def emitir_guia(gid: str, user: dict = Depends(require_perm("encomendas", "edit"))):
    return await guias_svc.emitir(gid, user)


@router.post("/guias/{gid}/anular")
async def anular_guia(gid: str, user: dict = Depends(require_perm("encomendas", "edit"))):
    return await guias_svc.anular(gid, user)


@router.get("/guias/{gid}/pdf")
async def pdf_guia(gid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    g = await guias_repo.get(gid)
    if not g:
        raise HTTPException(404, "Guia não encontrada")
    emp = await empresa_repo.find_one({"id": "empresa"}) or {}
    return StreamingResponse(BytesIO(guias_svc.pdf(g, emp)), media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{(g.get("numero") or "guia").replace("/", "-")}.pdf"'})


# ---------------- Calculadora por técnica ----------------
@router.get("/tecnicas-preco")
async def tecnicas_listar(_u: dict = Depends(require_perm("orcamentos", "view"))):
    from app.services import tecnicas_preco
    return await tecnicas_preco.listar()


@router.put("/tecnicas-preco")
async def tecnicas_guardar(dados: dict, _a: dict = Depends(require_admin)):
    from app.services import tecnicas_preco
    return await tecnicas_preco.guardar(dados.get("tecnicas") or [])


# ---------------- Tabelas de preços dos fornecedores ----------------
@router.post("/precos-fornecedor/ler")
async def pf_ler(ficheiro: UploadFile = File(...), _u: dict = Depends(require_perm("artigos", "edit"))):
    from app.services import precos_fornecedor
    dados = await ficheiro.read()
    if len(dados) > 25 * 1024 * 1024:
        raise HTTPException(400, "Ficheiro demasiado grande (máx. 25 MB)")
    return await precos_fornecedor.ler(ficheiro.filename or "tabela.csv", dados)


@router.post("/precos-fornecedor/previsao")
async def pf_previsao(dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    from app.services import precos_fornecedor
    return await precos_fornecedor.previsao(dados)


@router.post("/precos-fornecedor/aplicar")
async def pf_aplicar(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    from app.services import precos_fornecedor
    return await precos_fornecedor.aplicar(dados, user)
