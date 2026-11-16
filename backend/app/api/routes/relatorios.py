"""Área Relatórios: catálogo, geração e exportação (Excel / PDF)."""
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.security import require_perm
from app.services import relatorios as svc

router = APIRouter()


@router.get("/relatorios/catalogo")
async def catalogo(_u: dict = Depends(require_perm("relatorios", "view"))):
    from app.core.security import pode_ver_custos
    cat = svc.catalogo()
    if not await pode_ver_custos(_u):
        cat["relatorios"] = [r for r in cat["relatorios"] if not r.get("custos")]
    return cat


@router.get("/relatorios/gerar/{rid}")
async def gerar(
    rid: str,
    de: str = Query(""),
    ate: str = Query(""),
    agrupar: str = Query("mes"),
    comparar: str = Query(""),
    cliente_id: str = Query(""),
    limite: int = Query(0, ge=0, le=1000),
    formato: str = Query("json", description="json | xlsx | pdf"),
    colunas: str = Query("", description="chaves das colunas a mostrar, separadas por vírgula"),
    _u: dict = Depends(require_perm("relatorios", "view")),
):
    p = svc.normalizar(de, ate, agrupar, comparar, cliente_id, limite)
    if (svc.RELATORIOS.get(rid) or {}).get("custos"):
        from app.core.security import pode_ver_custos
        if not await pode_ver_custos(_u):
            raise HTTPException(403, "O seu perfil não tem acesso a custos e margens")
    rel = await svc.gerar(rid, p)
    if colunas:
        from app.services.relatorios_guardados import aplicar_colunas
        rel = aplicar_colunas(rel, [c for c in colunas.split(",") if c])
    return await _responder(rel, formato)


async def _responder(rel: dict, formato: str):
    if formato not in ("xlsx", "pdf"):
        return rel
    p = rel["parametros"]
    empresa = await svc.nome_empresa()
    nome = f"{(rel.get('guardado') or {}).get('nome') or rel['titulo']} {p['de']} a {p['ate']}".replace("/", "-")
    if formato == "xlsx":
        dados, tipo, ext = svc.exportar_xlsx(rel, empresa), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    else:
        dados, tipo, ext = svc.exportar_pdf(rel, empresa), "application/pdf", "pdf"
    from urllib.parse import quote
    return StreamingResponse(BytesIO(dados), media_type=tipo, headers={
        "Content-Disposition": f"attachment; filename=\"relatorio.{ext}\"; filename*=UTF-8''{quote(nome)}.{ext}",
    })



# ---------------------------------------------------------------------------
# Relatórios guardados e envio automático
# ---------------------------------------------------------------------------
from app.repositories import relatorios_guardados_repo as guardados_repo  # noqa: E402
from app.services import relatorios_guardados as gsvc  # noqa: E402


async def _e_admin(user: dict) -> bool:
    from app.core.security import resolve_perfil
    return bool((await resolve_perfil(user)).get("admin"))


async def _obter(gid: str, user: dict, editar: bool = False) -> dict:
    g = await guardados_repo.get(gid)
    if not g:
        raise HTTPException(404, "Relatório guardado não encontrado")
    dono = (g.get("dono") or {}).get("id") == user.get("id")
    if not (dono or await _e_admin(user) or (g.get("partilhado") and not editar)):
        raise HTTPException(403, "Este relatório é de outro utilizador")
    return g


async def _assert_custos(rid: str, user: dict) -> None:
    if (svc.RELATORIOS.get(rid) or {}).get("custos"):
        from app.core.security import pode_ver_custos
        if not await pode_ver_custos(user):
            raise HTTPException(403, "O seu perfil não tem acesso a custos e margens")


@router.get("/relatorios/guardados")
async def listar_guardados(user: dict = Depends(require_perm("relatorios", "view"))):
    admin = await _e_admin(user)
    out = []
    for g in await guardados_repo.find({}, sort=("nome", 1), limit=1000):
        meu = (g.get("dono") or {}).get("id") == user.get("id")
        if meu or admin or g.get("partilhado"):
            out.append({**g, "meu": meu, "pode_editar": meu or admin,
                        "relatorio_titulo": (svc.RELATORIOS.get(g["relatorio_id"]) or {}).get("titulo", ""),
                        "periodo_label": gsvc.PERIODOS.get(g.get("periodo"), "")})
    return {"guardados": out, "periodos": gsvc.PERIODOS}


@router.post("/relatorios/guardados")
async def criar_guardado(dados: dict, user: dict = Depends(require_perm("relatorios", "view"))):
    await _assert_custos(dados.get("relatorio_id") or "", user)
    doc = gsvc.normalizar(dados, user)
    await guardados_repo.insert(doc)
    return doc


@router.put("/relatorios/guardados/{gid}")
async def editar_guardado(gid: str, dados: dict, user: dict = Depends(require_perm("relatorios", "view"))):
    g = await _obter(gid, user, editar=True)
    await _assert_custos(dados.get("relatorio_id") or g["relatorio_id"], user)
    doc = gsvc.normalizar({**dados, "relatorio_id": dados.get("relatorio_id") or g["relatorio_id"]}, user, g)
    await guardados_repo.update(gid, doc)
    return {**g, **doc}


@router.delete("/relatorios/guardados/{gid}")
async def apagar_guardado(gid: str, user: dict = Depends(require_perm("relatorios", "view"))):
    await _obter(gid, user, editar=True)
    await guardados_repo.delete({"id": gid})
    return {"ok": True}


@router.get("/relatorios/guardados/{gid}/gerar")
async def gerar_guardado(gid: str, formato: str = Query("json"), user: dict = Depends(require_perm("relatorios", "view"))):
    g = await _obter(gid, user)
    await _assert_custos(g["relatorio_id"], user)
    return await _responder(await gsvc.gerar(g), formato)


@router.post("/relatorios/guardados/{gid}/enviar")
async def enviar_guardado(gid: str, user: dict = Depends(require_perm("relatorios", "view"))):
    g = await _obter(gid, user, editar=True)
    ok, erro = await gsvc.enviar(g)
    await guardados_repo.update(gid, {"ultimo_envio": {"at": gsvc.now_iso(), "ok": ok, "erro": erro, "manual": True}})
    if not ok:
        raise HTTPException(400, f"Não foi possível enviar: {erro}")
    return {"ok": True}


@router.get("/fecho-mes")
async def fecho_mes(mes: str = Query(...), user: dict = Depends(require_perm("relatorios", "view"))):
    """Resumo do mês para o fecho: faturado, recebido, a receber, compras, margem vs objetivo e pendentes."""
    from app.core.security import pode_ver_custos
    from app.services import fecho_mes as fm
    return await fm.resumo(mes, await pode_ver_custos(user))


# ---------------------------------------------------------------------------
# Objetivos anuais e centros de custo
# ---------------------------------------------------------------------------
@router.get("/objetivos/{ano}")
async def objetivos_get(ano: int, user: dict = Depends(require_perm("relatorios", "view"))):
    from app.services import objetivos
    return await objetivos.obter(ano)


@router.put("/objetivos/{ano}")
async def objetivos_put(ano: int, dados: dict, _a: dict = Depends(require_perm("relatorios", "edit"))):
    from app.services import objetivos
    return await objetivos.guardar(ano, dados)


@router.put("/categorias/{cid}/centro-custo")
async def categoria_centro(cid: str, dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    from app.repositories import categorias_repo
    if not await categorias_repo.get(cid):
        raise HTTPException(404, "Categoria não encontrada")
    await categorias_repo.update(cid, {"centro_custo": (dados.get("centro_custo") or "").strip()})
    return {"ok": True}
