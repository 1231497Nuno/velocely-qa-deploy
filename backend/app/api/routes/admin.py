from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import new_id, now_iso
from app.core.security import (
    require_admin, resolve_perfil, user_public, hash_password, get_current_user,
    build_invite_fields, validate_password_strength,
)
from app.domain.models import (
    UserCreate, UserUpdate, PerfilInput, RBAC_MODULES, RBAC_ACTIONS, perms_all,
)
from app.repositories import users_repo, perfis_repo
from app.services.bootstrap import seed_catalogo, seed_demo_negocio

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "Production Costing API"}


# ----------------------- Utilizadores -----------------------
@router.get("/utilizadores-lista")
async def utilizadores_lista(_u: dict = Depends(get_current_user)):
    """Lista simples de utilizadores (id/nome/login) para atribuições. Requer apenas autenticação."""
    users = await users_repo.find(sort=("name", 1), projection={"password_hash": 0, "totp_segredo": 0, "totp_pendente": 0, "push_subs": 0})
    return [
        {
            "id": u.get("id"),
            "nome": u.get("name") or u.get("login") or (u.get("email") or "").split("@")[0],
            "login": u.get("login") or (u.get("email") or "").split("@")[0],
        }
        for u in users
    ]


@router.get("/users")
async def list_users(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    admin: dict = Depends(require_admin),
):
    from app.core.pagination import parse_page, page_payload, text_search
    query = {}
    ts = text_search(["name", "email", "login", "cargo"], q)
    if ts:
        query.update(ts)
    proj = {"password_hash": 0, "invite_code_hash": 0, "totp_segredo": 0, "totp_pendente": 0, "push_subs": 0}
    if page is None:
        users = await users_repo.find(query, sort=("created_at", 1), projection=proj, limit=5000)
        total = len(users)
        p = ps = skip = None
    else:
        p, ps, skip = parse_page(page, page_size)
        total = await users_repo.count(query)
        users = await users_repo.find(query, sort=("created_at", 1), projection=proj, limit=ps, skip=skip)
    out = []
    for u in users:
        perfil = await resolve_perfil(u)
        out.append({
            "id": u.get("id"),
            "login": u.get("login") or (u.get("email") or "").split("@")[0],
            "email": u.get("email"),
            "name": u.get("name", ""),
            "cargo": u.get("cargo", ""),
            "perfil_id": u.get("perfil_id") or perfil.get("id"),
            "perfil_nome": perfil.get("nome"),
            "role": "admin" if perfil.get("admin") else "colaborador",
            "must_set_password": bool(u.get("must_set_password")),
            "status": u.get("status") or ("pending_activation" if u.get("must_set_password") else "active"),
            "invite_expires_at": u.get("invite_expires_at"),
            "created_at": u.get("created_at"),
        })
    if page is None:
        return out
    return page_payload(out, total, p, ps)


async def _resolve_perfil_id(perfil_id: Optional[str], role: Optional[str]) -> str:
    pid = (perfil_id or "").strip()
    if pid:
        p = await perfis_repo.get(pid)
        if not p:
            raise HTTPException(400, "Perfil inválido")
        return pid
    if role == "admin":
        p = await perfis_repo.find_one({"sistema": True, "admin": True})
    else:
        p = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    if not p:
        raise HTTPException(400, "Não há perfis configurados. Recarregue a página.")
    return p["id"]


@router.post("/users")
async def create_user(data: UserCreate, admin: dict = Depends(require_admin)):
    """Cria utilizador. Sem password → código de convite (mostrado uma vez)."""
    email = (data.email or "").strip().lower()
    login = (data.login or "").strip().lower() or (email.split("@")[0] if email else "")
    if not login:
        raise HTTPException(400, "Login obrigatório")
    if await users_repo.find_one({"login": login}):
        raise HTTPException(400, "Já existe um utilizador com este login")
    if email and await users_repo.find_one({"email": email}):
        raise HTTPException(400, "Já existe um utilizador com este email")
    perfil_id = await _resolve_perfil_id(data.perfil_id, data.role)

    doc = {
        "id": new_id(),
        "login": login,
        "email": email,
        "name": data.name or "",
        "cargo": data.cargo or "",
        "perfil_id": perfil_id,
        "created_at": now_iso(),
    }
    invite_code = None
    if data.password:
        err = validate_password_strength(data.password)
        if err:
            raise HTTPException(400, err)
        doc.update({
            "password_hash": hash_password(data.password),
            "must_set_password": False,
            "status": "active",
            "invite_code_hash": None,
            "invite_expires_at": None,
        })
    else:
        invite_code, invite_fields = build_invite_fields()
        doc.update(invite_fields)

    await users_repo.insert(doc)
    public = await user_public(doc)
    if invite_code:
        public["invite_code"] = invite_code
        public["invite_message"] = (
            "Envie o login e este código ao utilizador. "
            "O código expira em 72h e só é mostrado uma vez."
        )
    return public


@router.post("/users/{uid}/reinvitar")
async def reinvitar_user(uid: str, admin: dict = Depends(require_admin)):
    """Gera novo código de convite (invalida o anterior)."""
    user = await users_repo.get(uid)
    if not user:
        raise HTTPException(404, "Utilizador não encontrado")
    if user.get("status") == "disabled":
        raise HTTPException(400, "Conta desactivada")
    invite_code, invite_fields = build_invite_fields()
    await users_repo.update(uid, invite_fields)
    user = await users_repo.get(uid)
    public = await user_public(user)
    public["invite_code"] = invite_code
    public["invite_message"] = (
        "Novo código gerado. Envie o login e este código ao utilizador. "
        "Expira em 72h e só é mostrado uma vez."
    )
    return public


@router.post("/users/{uid}/2fa/repor")
async def repor_2fa(uid: str, admin: dict = Depends(require_admin)):
    """Desliga a verificação em dois passos (ex.: o utilizador perdeu o telemóvel)."""
    user = await users_repo.get(uid)
    if not user:
        raise HTTPException(404, "Utilizador não encontrado")
    await users_repo.update(uid, {"totp_segredo": None, "totp_pendente": None, "totp_ativo": False})
    from app.services import audit
    await audit.registar("utilizador", uid, "editado", admin, "Verificação em dois passos reposta pelo administrador", user.get("name"))
    return await user_public(await users_repo.get(uid))


@router.put("/users/{uid}")
async def update_user(uid: str, data: UserUpdate, admin: dict = Depends(require_admin)):
    user = await users_repo.get(uid)
    if not user:
        raise HTTPException(404, "Utilizador não encontrado")
    patch = {}
    if data.login is not None:
        login = data.login.strip().lower()
        if login and login != user.get("login"):
            if await users_repo.find_one({"login": login, "id": {"$ne": uid}}):
                raise HTTPException(400, "Já existe um utilizador com este login")
            patch["login"] = login
    if data.email is not None:
        patch["email"] = data.email.strip().lower()
    if data.name is not None:
        patch["name"] = data.name
    if data.cargo is not None:
        patch["cargo"] = data.cargo
    if data.perfil_id is not None or data.role is not None:
        patch["perfil_id"] = await _resolve_perfil_id(data.perfil_id, data.role)
    if data.password:
        err = validate_password_strength(data.password)
        if err:
            raise HTTPException(400, err)
        patch["password_hash"] = hash_password(data.password)
        patch["must_set_password"] = False
        patch["invite_code_hash"] = None
        patch["invite_expires_at"] = None
        patch["status"] = "active"
    if patch:
        await users_repo.update(uid, patch)
        user.update(patch)
    return await user_public(user)


@router.delete("/users/{uid}")
async def delete_user(uid: str, admin: dict = Depends(require_admin)):
    if uid == admin.get("id"):
        raise HTTPException(400, "Não pode eliminar a própria conta")
    await users_repo.delete({"id": uid})
    return {"ok": True}


# ----------------------- Perfis (RBAC) -----------------------
@router.get("/perfis")
async def list_perfis(admin: dict = Depends(require_admin)):
    return await perfis_repo.find(sort=("created_at", 1))


@router.get("/rbac/modulos")
async def rbac_modulos(admin: dict = Depends(require_admin)):
    from app.domain.modules import SYSTEM_MODULES
    return {
        "modulos": [{"key": m["key"], "label": m["label"], "pack": m["pack"], "core": m["core"]} for m in SYSTEM_MODULES],
        "acoes": RBAC_ACTIONS,
    }


def _normalize_perms(permissoes: dict, admin_flag: bool) -> dict:
    base = perms_all(True) if admin_flag else perms_all(False)
    for m in RBAC_MODULES:
        for a in RBAC_ACTIONS:
            v = (permissoes or {}).get(m, {}).get(a)
            if v is not None:
                base[m][a] = bool(v)
            elif admin_flag:
                base[m][a] = True
    return base


def _restricoes(data: PerfilInput) -> dict:
    from app.domain.models import MODULOS_SO_PROPRIOS
    pagina = (data.pagina_inicial or "").strip()
    if pagina and not pagina.startswith("/"):
        pagina = "/" + pagina
    from app.domain.models import APP_MOVEL_OPS
    from app.services.utilidades import _limpar_menu
    return {
        "ver_custos": True if data.admin else bool(data.ver_custos),
        "so_proprios": [] if data.admin else [m for m in data.so_proprios if m in MODULOS_SO_PROPRIOS],
        "pagina_inicial": pagina[:120],
        "app_movel": None if (data.admin or data.app_movel is None) else [o for o in data.app_movel if o in APP_MOVEL_OPS],
        "menu": _limpar_menu(data.menu) if data.menu else None,
        "painel_ocultos": [str(x)[:40] for x in data.painel_ocultos][:30] if data.painel_ocultos is not None else None,
        "painel_ordem": [str(x)[:40] for x in data.painel_ordem][:30] if data.painel_ordem is not None else None,
    }


# Modelos de perfil (os "perfis de cargo" do Sage): criar num clique e ajustar depois
def _perms_de(view: list, edit: list) -> dict:
    p = perms_all(False)
    for m in view + edit:
        if m in p:
            p[m]["view"] = True
    for m in edit:
        if m in p:
            p[m]["create"] = p[m]["edit"] = True
    return p


MODELOS_PERFIL = {
    "comercial": {"nome": "Comercial", "ver_custos": True, "pagina_inicial": "/crm", "so_proprios": [],
                  "perms": (["dashboard", "artigos", "categorias", "personalizacao", "ordens_fabrico", "calendario", "relatorios"],
                            ["crm", "clientes", "orcamentos", "encomendas", "financeiro"])},
    "producao": {"nome": "Produção", "ver_custos": False, "pagina_inicial": "/ordens-fabrico", "so_proprios": [],
                 "perms": (["encomendas", "artigos", "categorias", "materiais", "maquinas", "calendario"],
                           ["ordens_fabrico", "nao_conformidades"])},
    "financeiro": {"nome": "Financeiro", "ver_custos": True, "pagina_inicial": "/pagamentos", "so_proprios": [],
                   "perms": (["dashboard", "clientes", "orcamentos", "fornecedores", "rentabilidade", "relatorios"],
                             ["encomendas", "financeiro", "contas", "ordens_compra"])},
    "compras": {"nome": "Compras", "ver_custos": True, "pagina_inicial": "/ordens-compra", "so_proprios": [],
                "perms": (["dashboard", "encomendas", "ordens_fabrico", "artigos", "relatorios"],
                          ["fornecedores", "pedidos_cotacao", "ordens_compra", "materiais", "categorias"])},
    "loja": {"nome": "Atendimento / loja", "ver_custos": False, "pagina_inicial": "/encomendas", "so_proprios": ["orcamentos", "crm"],
             "perms": (["artigos", "categorias", "personalizacao", "calendario"], ["clientes", "orcamentos", "encomendas", "crm"])},
}


@router.get("/perfis/app-movel-ops")
async def app_movel_ops(admin: dict = Depends(require_admin)):
    from app.domain.models import APP_MOVEL_OPS
    return APP_MOVEL_OPS


MODELOS_PERFIL["armazem"] = {"nome": "Armazém", "ver_custos": False, "pagina_inicial": "/m", "so_proprios": [],
                             "app_movel": ["rececoes", "inventario", "localizacoes", "transferir", "movimento", "stock_baixo", "movimentos", "consultar", "picking"],
                             "perms": (["dashboard", "fornecedores", "encomendas", "calendario", "ordens_fabrico"], ["artigos", "ordens_compra"])}
MODELOS_PERFIL["oficina"] = {"nome": "Oficina", "ver_custos": False, "pagina_inicial": "/oficina", "so_proprios": [],
                             "app_movel": ["oficina", "consultar", "localizacoes", "movimento"],
                             "perms": (["artigos", "encomendas", "calendario"], ["ordens_fabrico", "nao_conformidades"])}


@router.get("/perfis/modelos")
async def modelos_perfil(admin: dict = Depends(require_admin)):
    return [{"id": k, "nome": v["nome"], "pagina_inicial": v["pagina_inicial"], "ver_custos": v["ver_custos"],
             "so_proprios": v["so_proprios"]} for k, v in MODELOS_PERFIL.items()]


@router.post("/perfis/modelos/{mid}")
async def criar_de_modelo(mid: str, admin: dict = Depends(require_admin)):
    m = MODELOS_PERFIL.get(mid)
    if not m:
        raise HTTPException(404, "Modelo desconhecido")
    nome = m["nome"]
    i = 2
    while await perfis_repo.find_one({"nome": nome}):
        nome = f"{m['nome']} {i}"
        i += 1
    doc = {"id": new_id(), "nome": nome, "sistema": False, "admin": False,
           "permissoes": _perms_de(*m["perms"]), "ver_custos": m["ver_custos"], "so_proprios": list(m["so_proprios"]),
           "pagina_inicial": m["pagina_inicial"], "app_movel": m.get("app_movel"), "created_at": now_iso()}
    await perfis_repo.insert(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/perfis")
async def create_perfil(data: PerfilInput, admin: dict = Depends(require_admin)):
    nome = (data.nome or "").strip()
    if not nome:
        raise HTTPException(400, "Nome obrigatório")
    if await perfis_repo.find_one({"nome": nome}):
        raise HTTPException(400, "Já existe um perfil com este nome")
    doc = {
        "id": new_id(),
        "nome": nome,
        "sistema": False,
        "admin": bool(data.admin),
        "permissoes": _normalize_perms(data.permissoes, data.admin),
        **_restricoes(data),
        "created_at": now_iso(),
    }
    await perfis_repo.insert(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/perfis/{pid}")
async def update_perfil(pid: str, data: PerfilInput, admin: dict = Depends(require_admin)):
    perfil = await perfis_repo.get(pid)
    if not perfil:
        raise HTTPException(404, "Perfil não encontrado")
    if perfil.get("sistema") and perfil.get("admin"):
        raise HTTPException(400, "O perfil de Administrador não pode ser alterado")
    patch = {
        "nome": (data.nome or perfil["nome"]).strip(),
        "admin": bool(data.admin),
        "permissoes": _normalize_perms(data.permissoes, data.admin),
        **_restricoes(data),
    }
    await perfis_repo.update(pid, patch)
    perfil.update(patch)
    return perfil


@router.delete("/perfis/{pid}")
async def delete_perfil(pid: str, admin: dict = Depends(require_admin)):
    perfil = await perfis_repo.get(pid)
    if not perfil:
        raise HTTPException(404, "Perfil não encontrado")
    if perfil.get("sistema"):
        raise HTTPException(400, "Perfis de sistema não podem ser eliminados")
    in_use = await users_repo.find_one({"perfil_id": pid})
    if in_use:
        raise HTTPException(400, "Perfil em uso por utilizadores")
    await perfis_repo.delete({"id": pid})
    return {"ok": True}


# ----------------------- Seed demo data -----------------------
@router.post("/seed")
async def seed(_admin: dict = Depends(require_admin)):
    """Catálogo + dados de negócio de desenvolvimento (idempotente)."""
    cat = await seed_catalogo()
    demo = await seed_demo_negocio()
    if not cat and not demo:
        return {"ok": True, "message": "Dados já existem", "catalogo": False, "negocio": False}
    parts = []
    if cat:
        parts.append("catálogo")
    if demo:
        parts.append("clientes/orçamentos/encomendas/OFs")
    return {
        "ok": True,
        "message": "Dados de demonstração criados: " + " + ".join(parts),
        "catalogo": cat,
        "negocio": demo,
    }


# ----------------------- Dados de simulação (testes) -----------------------
@router.get("/simulacao")
async def simulacao_estado(_admin: dict = Depends(require_admin)):
    from app.services import simulacao
    return await simulacao.estado()


@router.post("/simulacao")
async def simulacao_criar(admin: dict = Depends(require_admin)):
    from app.services import simulacao
    return await simulacao.criar(admin)


@router.delete("/simulacao")
async def simulacao_apagar(admin: dict = Depends(require_admin)):
    from app.services import simulacao
    return await simulacao.apagar(admin)



@router.get("/admin/estado-configuracao")
async def estado_configuracao(_a: dict = Depends(require_admin)):
    """Lista do que está (e não está) configurado no servidor, com o que fazer em cada caso."""
    import os
    from app.core import config as cfg
    from app.services import email as email_svc
    from app.services import push, storage
    fe = (os.environ.get("FRONTEND_URL") or os.environ.get("APP_URL") or "").strip()
    itens = [
        {"chave": "smtp", "titulo": "Envio de emails (SMTP)", "ok": email_svc.smtp_configured(),
         "detalhe": f"{cfg.SMTP_HOST}:{cfg.SMTP_PORT} · remetente {email_svc.mask_email(cfg.SMTP_FROM)}" if email_svc.smtp_configured() else "",
         "variaveis": ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TLS"],
         "porque": "Orçamentos, faturas, lembretes a clientes, notas de encomenda a fornecedores e alertas por email."},
        {"chave": "frontend_url", "titulo": "Endereço público da app (FRONTEND_URL)", "ok": bool(fe), "detalhe": fe,
         "variaveis": ["FRONTEND_URL"],
         "porque": "Links nos emails (portal do cliente para aceitar orçamentos, alertas, recuperação de password)."},
        {"chave": "jwt", "titulo": "Chave secreta das sessões (JWT_SECRET)", "ok": cfg.JWT_SECRET != getattr(cfg, "_JWT_DEFAULT", None),
         "variaveis": ["JWT_SECRET"], "porque": "Segurança das sessões: tem de ser um valor longo e aleatório só vosso."},
        {"chave": "storage", "titulo": "Armazenamento de ficheiros", "ok": storage.backend() == "gridfs" or not cfg.IS_RENDER,
         "detalhe": "base de dados (GridFS)" if storage.backend() == "gridfs" else "disco local", "variaveis": ["STORAGE_BACKEND"],
         "porque": "No Render o disco é apagado em cada deploy: os ficheiros (artes, fotos, PDFs) devem ir para a base de dados ou um bucket."},
        {"chave": "push", "titulo": "Alertas no telemóvel (push)", "ok": push.disponivel(), "variaveis": [],
         "porque": "Notificações dos alertas e aprovações no telemóvel. Fica ativo depois do deploy com as dependências novas."},
    ]
    return {"ambiente": cfg.APP_ENV, "render": cfg.IS_RENDER, "itens": itens,
            "pendentes": sum(1 for i in itens if not i["ok"])}
