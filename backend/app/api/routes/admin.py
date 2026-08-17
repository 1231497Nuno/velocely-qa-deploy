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
    users = await users_repo.find(sort=("name", 1), projection={"password_hash": 0})
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
    proj = {"password_hash": 0, "invite_code_hash": 0}
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
