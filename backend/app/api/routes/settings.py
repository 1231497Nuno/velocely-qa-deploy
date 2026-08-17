from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException

from app.domain.models import EmpresaSettings, PdfTemplate, PdfTemplateInput, PDF_SECOES
from app.domain.modules import PACKS, SYSTEM_MODULES, CORE_MODULE_KEYS, resolve_modulos_ativos
from app.core.security import get_current_user, require_admin, require_perm, invalidate_modulos_cache
from app.repositories import empresa_repo, pdf_templates_repo
from app.services import numeracao as numeracao_svc
from app.services import email_templates as email_tpl_svc
from pydantic import BaseModel, Field

router = APIRouter()


# ----------------------- Definições da Empresa -----------------------
@router.get("/settings/empresa")
async def get_empresa(_u: dict = Depends(require_perm("definicoes", "view"))):
    s = await empresa_repo.find_one({"id": "empresa"})
    return s or {"id": "empresa", **EmpresaSettings().model_dump()}


class ModulosBody(BaseModel):
    modulos: List[str] = Field(default_factory=list)


@router.get("/settings/modulos")
async def get_modulos(_u: dict = Depends(get_current_user)):
    s = await empresa_repo.find_one({"id": "empresa"}) or {}
    return {
        "packs": PACKS,
        "modulos": SYSTEM_MODULES,
        "ativos": resolve_modulos_ativos(s.get("modulos_ativos")),
    }


@router.put("/settings/modulos")
async def update_modulos(body: ModulosBody, admin: dict = Depends(require_admin)):
    ativos = resolve_modulos_ativos(list(body.modulos or []) + list(CORE_MODULE_KEYS))
    await empresa_repo.update_where({"id": "empresa"}, {"id": "empresa", "modulos_ativos": ativos}, upsert=True)
    invalidate_modulos_cache()
    return {"packs": PACKS, "modulos": SYSTEM_MODULES, "ativos": ativos}


@router.put("/settings/empresa")
async def update_empresa(data: EmpresaSettings, admin: dict = Depends(require_admin)):
    doc = {"id": "empresa", **data.model_dump()}
    await empresa_repo.update_where({"id": "empresa"}, doc, upsert=True)
    return doc


# ----------------------- Referências / numeração -----------------------
@router.get("/settings/numeracao")
async def get_numeracao(_u: dict = Depends(require_perm("definicoes", "view"))):
    return await numeracao_svc.get_numeracao()


@router.put("/settings/numeracao")
async def update_numeracao(data: dict, admin: dict = Depends(require_admin)):
    return await numeracao_svc.save_numeracao(data)


@router.post("/settings/numeracao/backfill")
async def backfill_numeracao(admin: dict = Depends(require_admin)):
    """Atribui códigos a registos antigos sem código."""
    stats = await numeracao_svc.backfill_codigos()
    return {"ok": True, "atribuidos": stats}


@router.get("/branding")
async def get_branding():
    """Branding público (sem autenticação) para o ecrã de login."""
    s = await empresa_repo.find_one({"id": "empresa"}) or {}
    return {
        "nome": s.get("nome") or "Velocely",
        "login_bg_base64": s.get("login_bg_base64") or "",
    }


# ----------------------- Modelos de PDF -----------------------
@router.get("/pdf-secoes")
async def pdf_secoes(_u: dict = Depends(require_perm("definicoes", "view"))):
    return PDF_SECOES


@router.get("/pdf-templates")
async def list_pdf_templates(modulo: Optional[str] = None, _u: dict = Depends(require_perm("definicoes", "view"))):
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


# ----------------------- Templates de email -----------------------
class EmailTemplateUpdate(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=20000)


@router.get("/settings/email-templates")
async def list_email_templates(_u: dict = Depends(require_perm("definicoes", "view"))):
    return await email_tpl_svc.list_templates()


@router.get("/settings/email-templates/{tipo}")
async def get_email_template(tipo: str, _u: dict = Depends(require_perm("definicoes", "view"))):
    if tipo not in email_tpl_svc.EMAIL_TEMPLATE_TYPES:
        raise HTTPException(404, "Template não encontrado")
    return await email_tpl_svc.get_template(tipo)


@router.put("/settings/email-templates/{tipo}")
async def update_email_template(tipo: str, data: EmailTemplateUpdate, admin: dict = Depends(require_admin)):
    if tipo not in email_tpl_svc.EMAIL_TEMPLATE_TYPES:
        raise HTTPException(404, "Template não encontrado")
    try:
        return await email_tpl_svc.save_template(tipo, data.subject, data.body)
    except ValueError as ex:
        raise HTTPException(400, str(ex))


@router.post("/settings/email-templates/{tipo}/repor")
async def reset_email_template(tipo: str, admin: dict = Depends(require_admin)):
    if tipo not in email_tpl_svc.EMAIL_TEMPLATE_TYPES:
        raise HTTPException(404, "Template não encontrado")
    return await email_tpl_svc.reset_template(tipo)
