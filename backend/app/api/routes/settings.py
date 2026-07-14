from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user, require_admin
from app.domain.models import EmpresaSettings, PdfTemplate, PdfTemplateInput, PDF_SECOES
from app.repositories import empresa_repo, pdf_templates_repo

router = APIRouter()


# ----------------------- Definições da Empresa -----------------------
@router.get("/settings/empresa")
async def get_empresa(_u: dict = Depends(get_current_user)):
    s = await empresa_repo.find_one({"id": "empresa"})
    return s or {"id": "empresa", **EmpresaSettings().model_dump()}


@router.put("/settings/empresa")
async def update_empresa(data: EmpresaSettings, admin: dict = Depends(require_admin)):
    doc = {"id": "empresa", **data.model_dump()}
    await empresa_repo.update_where({"id": "empresa"}, doc, upsert=True)
    return doc


# ----------------------- Modelos de PDF -----------------------
@router.get("/pdf-secoes")
async def pdf_secoes(_u: dict = Depends(get_current_user)):
    return PDF_SECOES


@router.get("/pdf-templates")
async def list_pdf_templates(modulo: Optional[str] = None, _u: dict = Depends(get_current_user)):
    q = {"modulo": modulo} if modulo else {}
    return await pdf_templates_repo.find(q, sort=("created_at", -1))


@router.post("/pdf-templates")
async def create_pdf_template(data: PdfTemplateInput, admin: dict = Depends(require_admin)):
    t = PdfTemplate(**data.model_dump())
    await pdf_templates_repo.insert(t.model_dump())
    return t.model_dump()


@router.put("/pdf-templates/{tid}")
async def update_pdf_template(tid: str, data: PdfTemplateInput, admin: dict = Depends(require_admin)):
    existing = await pdf_templates_repo.get(tid)
    if not existing:
        raise HTTPException(404, "Modelo não encontrado")
    await pdf_templates_repo.update(tid, data.model_dump())
    return {**existing, **data.model_dump()}


@router.delete("/pdf-templates/{tid}")
async def delete_pdf_template(tid: str, admin: dict = Depends(require_admin)):
    await pdf_templates_repo.delete({"id": tid})
    return {"ok": True}
