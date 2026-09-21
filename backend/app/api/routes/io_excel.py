"""Importação / exportação Excel (.xlsx)."""
from datetime import date
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.security import get_current_user, resolve_perfil
from app.services import excel_io

router = APIRouter(prefix="/io", tags=["Import/Export"])


class ExportRequest(BaseModel):
    entities: List[str] = Field(default_factory=list)
    ids: Optional[Dict[str, List[str]]] = None


async def _ensure_perm(user: dict, modulo: str, acao: str = "view") -> None:
    perfil = await resolve_perfil(user)
    if perfil.get("admin"):
        return
    perms = perfil.get("permissoes") or {}
    if not (perms.get(modulo) or {}).get(acao):
        raise HTTPException(403, f"Sem permissão ({modulo}.{acao})")


@router.get("/entities")
async def list_io_entities(user: dict = Depends(get_current_user)):
    """Lista entidades disponíveis para export/import."""
    items = []
    for key, meta in excel_io.SHEETS.items():
        if key in ("subcategorias", "encomenda_linhas"):
            continue  # agrupado em categorias / encomendas no hub
        items.append({
            "key": key,
            "label": meta["title"].replace("_", " "),
            "importable": key in excel_io.IMPORTABLE or key == "categorias",
            "exportable": True,
            "columns": meta["columns"],
            "perm": excel_io.ENTITY_PERM.get(key),
        })
    # categorias covers subcategorias; encomendas covers linhas
    for it in items:
        if it["key"] == "categorias":
            it["label"] = "Categorias / Subcategorias"
            it["importable"] = True
        if it["key"] == "encomendas":
            it["label"] = "Encomendas / Linhas"
            it["importable"] = True
    return {"entities": items, "max_rows": excel_io.MAX_ROWS}


@router.post("/export/xlsx")
async def export_xlsx(body: ExportRequest, user: dict = Depends(get_current_user)):
    entities = [e.strip() for e in (body.entities or []) if e and e.strip()]
    if not entities:
        raise HTTPException(400, "Seleccione pelo menos uma entidade")

    for e in entities:
        if e not in excel_io.EXPORTABLE and e not in excel_io.EXPORT_EXPAND:
            raise HTTPException(400, f"Entidade desconhecida: {e}")
        modulo = excel_io.ENTITY_PERM.get(e) or excel_io.ENTITY_PERM.get(
            excel_io.EXPORT_EXPAND.get(e, [e])[0]
        )
        if modulo:
            await _ensure_perm(user, modulo, "view")

    try:
        data = await excel_io.build_export_xlsx(entities, body.ids)
    except ValueError as ex:
        raise HTTPException(400, str(ex))

    fname = f"velocely-export-{date.today().isoformat()}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/import/template/{entity}")
async def import_template(entity: str, user: dict = Depends(get_current_user)):
    if entity not in excel_io.IMPORTABLE:
        raise HTTPException(400, "Entidade não suportada para template de importação")
    modulo = excel_io.ENTITY_PERM.get(entity, "artigos")
    await _ensure_perm(user, modulo, "view")
    try:
        data = excel_io.build_template_xlsx(entity)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    fname = f"velocely-template-{entity}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/import/xlsx")
async def import_xlsx(
    entity: str = Query(..., description="Entidade mestre a importar"),
    dry_run: bool = Query(True),
    mode: str = Query(
        "create",
        description="create = só novos (predefinição); update = permite actualizar existentes",
    ),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if entity not in excel_io.IMPORTABLE:
        raise HTTPException(400, "Entidade não suportada para importação")
    modulo = excel_io.ENTITY_PERM.get(entity, "artigos")
    await _ensure_perm(user, modulo, "create")

    mode_norm = (mode or "create").strip().lower()
    if mode_norm not in excel_io.IMPORT_MODES:
        raise HTTPException(400, "mode deve ser 'create' ou 'update'")
    if mode_norm == "update":
        await _ensure_perm(user, modulo, "edit")

    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Envie um ficheiro .xlsx")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Ficheiro vazio")
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(400, "Ficheiro demasiado grande (máx. 15 MB)")

    try:
        result = await excel_io.import_rows(entity, raw, dry_run=dry_run, mode=mode_norm)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    except Exception as ex:
        raise HTTPException(400, f"Não foi possível ler o Excel: {ex}")

    return result
