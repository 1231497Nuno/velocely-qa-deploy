"""Seed de arranque: perfis de sistema e admin de recuperação."""
from app.core import config
from app.core.database import new_id, now_iso
from app.core.security import hash_password, verify_password
from app.domain.models import RBAC_MODULES, RBAC_ACTIONS, perms_all, perms_colaborador
from app.repositories import perfis_repo, users_repo


async def seed_perfis() -> None:
    admin_p = await perfis_repo.find_one({"sistema": True, "admin": True})
    if not admin_p:
        await perfis_repo.insert({
            "id": new_id(), "nome": "Administrador", "sistema": True, "admin": True,
            "permissoes": perms_all(True), "created_at": now_iso(),
        })
    colab_p = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    if not colab_p:
        await perfis_repo.insert({
            "id": new_id(), "nome": "Colaborador", "sistema": True, "admin": False,
            "permissoes": perms_colaborador(), "created_at": now_iso(),
        })
    # migrar perfis existentes: garantir que todos os módulos existem nas permissões
    async for p in perfis_repo.cursor():
        perms = p.get("permissoes") or {}
        changed = False
        col_defaults = perms_colaborador()
        for m in RBAC_MODULES:
            if m not in perms:
                if p.get("nome") == "Colaborador" and p.get("sistema"):
                    perms[m] = col_defaults[m]
                else:
                    perms[m] = {a: bool(p.get("admin")) for a in RBAC_ACTIONS}
                changed = True
            else:
                for a in RBAC_ACTIONS:
                    if a not in perms[m]:
                        perms[m][a] = bool(p.get("admin"))
                        changed = True
        if changed:
            await perfis_repo.update(p["id"], {"permissoes": perms})


async def seed_admin():
    email = (config.ADMIN_EMAIL or "admin@prodcost.pt").strip().lower()
    password = config.ADMIN_PASSWORD or "Admin123!"
    admin_p = await perfis_repo.find_one({"sistema": True, "admin": True})
    colab_p = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    existing = await users_repo.find_one({"email": email})
    if not existing:
        await users_repo.insert({
            "id": new_id(),
            "login": email.split("@")[0],
            "email": email,
            "name": "Admin Geral",
            "cargo": "Administrador",
            "perfil_id": admin_p["id"] if admin_p else None,
            "password_hash": hash_password(password),
            "created_at": now_iso(),
        })
    else:
        patch = {}
        if not verify_password(password, existing.get("password_hash", "")):
            patch["password_hash"] = hash_password(password)
        if existing.get("name") == "Administrador":
            patch["name"] = "Admin Geral"
        if not existing.get("perfil_id") and admin_p:
            patch["perfil_id"] = admin_p["id"]
        if not existing.get("login"):
            patch["login"] = email.split("@")[0]
        if patch:
            await users_repo.update_where({"email": email}, patch)
    if colab_p:
        await users_repo.update_many(
            {"perfil_id": {"$in": [None, ""]}, "role": {"$ne": "admin"}},
            {"perfil_id": colab_p["id"]},
        )


async def seed_user_logins() -> None:
    """Backfill do campo 'login' para utilizadores legado (derivado do email)."""
    usados = set()
    async for u in users_repo.cursor():
        if u.get("login"):
            usados.add((u["login"] or "").lower())
    async for u in users_repo.cursor():
        if u.get("login"):
            continue
        base = ((u.get("email") or "").split("@")[0] or f"user{u.get('id', '')[:6]}").lower()
        cand = base or "user"
        n = 1
        while cand in usados:
            n += 1
            cand = f"{base}{n}"
        usados.add(cand)
        await users_repo.update(u["id"], {"login": cand})
