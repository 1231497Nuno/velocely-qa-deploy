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
    _u: dict = Depends(require_perm("relatorios", "view")),
):
    p = svc.normalizar(de, ate, agrupar, comparar, cliente_id, limite)
    if (svc.RELATORIOS.get(rid) or {}).get("custos"):
        from app.core.security import pode_ver_custos
        if not await pode_ver_custos(_u):
            raise HTTPException(403, "O seu perfil não tem acesso a custos e margens")
    rel = await svc.gerar(rid, p)
    if formato not in ("xlsx", "pdf"):
        return rel
    empresa = await svc.nome_empresa()
    nome = f"{rel['titulo']} {p.de} a {p.ate}".replace("/", "-")
    if formato == "xlsx":
        dados, tipo, ext = svc.exportar_xlsx(rel, empresa), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    else:
        dados, tipo, ext = svc.exportar_pdf(rel, empresa), "application/pdf", "pdf"
    from urllib.parse import quote
    return StreamingResponse(BytesIO(dados), media_type=tipo, headers={
        "Content-Disposition": f"attachment; filename=\"relatorio.{ext}\"; filename*=UTF-8''{quote(nome)}.{ext}",
    })

