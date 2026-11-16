from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException

from app.domain.models import EmpresaSettings, PdfTemplate, PdfTemplateInput, PDF_SECOES
from app.domain.modules import PACKS, SYSTEM_MODULES, CORE_MODULE_KEYS, resolve_modulos_ativos
from app.core.security import get_current_user, require_admin, require_perm, invalidate_modulos_cache
from app.repositories import empresa_repo, pdf_templates_repo
from app.services import numeracao as numeracao_svc
from app.services import email_templates as email_tpl_svc
from app.domain.campos import MODULOS_CAMPOS, CamposConfigInput
from app.services import campos as campos_svc
from app.domain.tema import TEMA_DEFAULT, TEMA_PRESETS, TemaInput, normalizar_tema
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
    """Branding público (sem autenticação): login, cores e logótipo da barra lateral."""
    s = await empresa_repo.find_one({"id": "empresa"}) or {}
    tema = normalizar_tema(s.get("tema"))
    return {
        "nome": s.get("nome") or "Velocely",
        "login_bg_base64": s.get("login_bg_base64") or "",
        "tema": tema,
        "logo_base64": (s.get("logo_base64") or "") if tema.get("usar_logo_empresa") else "",
    }


# ----------------------- Campos por módulo -----------------------
@router.get("/settings/campos")
async def get_campos(_u: dict = Depends(get_current_user)):
    """Campos obrigatórios, personalizados e cores das linhas de todos os módulos."""
    return await campos_svc.catalogo_completo()


@router.put("/settings/campos/{modulo}")
async def update_campos(modulo: str, data: CamposConfigInput, admin: dict = Depends(require_admin)):
    if modulo not in MODULOS_CAMPOS:
        raise HTTPException(404, "Módulo desconhecido")
    return await campos_svc.guardar_config(modulo, data)


# ----------------------- Aparência (tema) -----------------------
@router.get("/settings/aparencia")
async def get_aparencia(_u: dict = Depends(require_perm("definicoes", "view"))):
    s = await empresa_repo.find_one({"id": "empresa"}) or {}
    return {"tema": normalizar_tema(s.get("tema")), "predefinido": TEMA_DEFAULT, "presets": TEMA_PRESETS}


@router.put("/settings/aparencia")
async def update_aparencia(data: TemaInput, admin: dict = Depends(require_admin)):
    tema = normalizar_tema(data.model_dump())
    await empresa_repo.update_where({"id": "empresa"}, {"id": "empresa", "tema": tema}, upsert=True)
    return {"tema": tema, "predefinido": TEMA_DEFAULT, "presets": TEMA_PRESETS}


# ----------------------- Modelos de PDF -----------------------
@router.get("/pdf-secoes")
async def pdf_secoes(_u: dict = Depends(require_perm("definicoes", "view"))):
    return PDF_SECOES


@router.get("/pdf-templates")
async def list_pdf_templates(modulo: Optional[str] = None, _u: dict = Depends(require_perm("definicoes", "view"))):
    q = {"modulo": modulo} if modulo else {}
    return await pdf_templates_repo.find(q, sort=("created_at", -1))


async def _so_um_padrao(modulo: str, tid: str):
    await pdf_templates_repo.col.update_many({"modulo": modulo, "id": {"$ne": tid}}, {"$set": {"padrao": False}})


@router.post("/pdf-templates")
async def create_pdf_template(data: PdfTemplateInput, admin: dict = Depends(require_admin)):
    t = PdfTemplate(**data.model_dump())
    await pdf_templates_repo.insert(t.model_dump())
    if t.padrao:
        await _so_um_padrao(t.modulo, t.id)
    return t.model_dump()


@router.get("/pdf-textos-padrao")
async def pdf_textos_padrao(_u: dict = Depends(require_perm("definicoes", "view"))):
    """Textos por defeito da proposta (para mostrar/editar no modelo)."""
    from app.services.pdf_proposta import DEFAULT_TEXTOS
    return {k: v for k, v in DEFAULT_TEXTOS.items()}


@router.post("/pdf-templates/pre-visualizar")
async def pre_visualizar_pdf(data: PdfTemplateInput, _u: dict = Depends(require_perm("definicoes", "view"))):
    """PDF de exemplo com o modelo em edição (último orçamento finalizado, ou um exemplo)."""
    from io import BytesIO
    from fastapi.responses import StreamingResponse
    from app.repositories import orcamentos_repo
    from app.services.costing import compute_orcamento_totais
    from app.core.database import now_iso
    from app.services.pdf import build_orcamento_pdf, fetch_cliente, modelo_de
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    fields = {**(data.campos or {}), "_modelo": modelo_de(data.model_dump())}
    if data.modulo == "orcamento":
        o = None
        for c in await orcamentos_repo.find({"numero": {"$nin": [None, ""]}}, sort=("created_at", -1), limit=5):
            o = c
            break
        if not o:
            o = {"numero": "ORC-EXEMPLO", "cliente": "Cliente de exemplo", "data": now_iso()[:10], "descricao": "Decoração de montra",
                 "linhas": [{"artigo_nome": "Vinil de corte dourado (design, material e aplicação)", "quantidade": 1, "preco_unit": 170}]}
        o = compute_orcamento_totais(o)
        pdf = build_orcamento_pdf(o, settings, fields, data.mostrar_branding, await fetch_cliente(o.get("cliente_id")))
    else:
        raise HTTPException(400, "Pré-visualização disponível para modelos de orçamento")
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="pre-visualizacao.pdf"'})


@router.put("/pdf-templates/{tid}")
async def update_pdf_template(tid: str, data: PdfTemplateInput, admin: dict = Depends(require_admin)):
    existing = await pdf_templates_repo.get(tid)
    if not existing:
        raise HTTPException(404, "Modelo não encontrado")
    await pdf_templates_repo.update(tid, data.model_dump())
    if data.padrao:
        await _so_um_padrao(data.modulo, tid)
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
