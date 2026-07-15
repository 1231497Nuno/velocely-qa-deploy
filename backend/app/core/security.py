import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core import config
from app.domain.models import LoginInput, perms_all, perms_colaborador
from app.repositories import users_repo, perfis_repo


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


async def resolve_perfil(user: dict) -> dict:
    perfil = None
    if user.get("perfil_id"):
        perfil = await perfis_repo.get(user["perfil_id"])
    if not perfil:
        if user.get("role") == "admin":
            perfil = await perfis_repo.find_one({"sistema": True, "admin": True})
        else:
            perfil = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    return perfil or {"nome": "Colaborador", "admin": False, "permissoes": perms_colaborador()}


async def user_public(u: dict) -> dict:
    perfil = await resolve_perfil(u)
    return {
        "id": u.get("id"),
        "login": u.get("login") or (u.get("email") or "").split("@")[0],
        "email": u.get("email"),
        "name": u.get("name", ""),
        "cargo": u.get("cargo", ""),
        "role": "admin" if perfil.get("admin") else "colaborador",
        "perfil_id": u.get("perfil_id"),
        "perfil": {
            "id": perfil.get("id"),
            "nome": perfil.get("nome"),
            "admin": bool(perfil.get("admin")),
            "permissoes": perfil.get("permissoes") or perms_all(False),
        },
        "created_at": u.get("created_at"),
    }


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await users_repo.get(payload.get("sub"))
    if not user:
        raise HTTPException(status_code=401, detail="Utilizador não encontrado")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    perfil = await resolve_perfil(user)
    can = perfil.get("admin") or (perfil.get("permissoes") or {}).get("utilizadores", {}).get("edit")
    if not can:
        raise HTTPException(status_code=403, detail="Sem permissão de gestão de utilizadores")
    return user


auth_router = APIRouter(prefix="/api/auth")


@auth_router.post("/login")
async def login(data: LoginInput):
    identifier = (data.login or data.email or "").strip().lower()
    user = await users_repo.find_one({"login": identifier})
    if not user:
        user = await users_repo.find_one({"email": identifier})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Utilizador ou password incorretos")
    perfil = await resolve_perfil(user)
    role = "admin" if perfil.get("admin") else "colaborador"
    token = create_access_token(user["id"], user.get("email") or user.get("login"), role)
    return {"token": token, "user": await user_public(user)}


@auth_router.get("/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return await user_public(user)
