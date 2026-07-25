import bcrypt
import jwt
import logging
import secrets
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import config
from app.core.database import now_iso
from app.domain.models import (
    LoginInput, SetPasswordInput, ProfileUpdate,
    ForgotPasswordRequest, PasswordCodeVerify, PasswordResetSet,
    perms_all, perms_colaborador,
)
from app.repositories import users_repo, perfis_repo
from app.services import email as email_service

logger = logging.getLogger(__name__)

# Esquema Bearer JWT — aparece no botão Authorize do Swagger (/docs)
bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="BearerAuth",
    description=(
        "JWT obtido em `POST /api/auth/login` ou após definir a password. "
        "No Swagger: Authorize → cola só o token (sem a palavra Bearer)."
    ),
)

INVITE_TTL_HOURS = 72
ACTIVATE_TOKEN_TTL_MIN = 30
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem 0/O/1/I
PASSWORD_MIN_LEN = 8

# Rate limit simples em memória (por processo)
_attempts: dict = defaultdict(list)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def generate_invite_code() -> str:
    raw = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def validate_password_strength(password: str) -> Optional[str]:
    if not password or len(password) < PASSWORD_MIN_LEN:
        return f"A password deve ter pelo menos {PASSWORD_MIN_LEN} caracteres"
    if not re.search(r"[A-Za-z]", password):
        return "A password deve incluir pelo menos uma letra"
    if not re.search(r"[0-9]", password):
        return "A password deve incluir pelo menos um número"
    return None


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def create_activation_token(user_id: str) -> str:
    """Token de curta duração — só permite definir a password."""
    payload = {
        "sub": user_id,
        "type": "activate",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACTIVATE_TOKEN_TTL_MIN),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def build_invite_fields(ttl_hours: int = INVITE_TTL_HOURS) -> Tuple[str, dict]:
    """Devolve (código em claro, campos a gravar). O código só é mostrado uma vez."""
    code = generate_invite_code()
    expires = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    return code, {
        "must_set_password": True,
        "invite_code_hash": hash_password(code.replace("-", "").upper()),
        "invite_expires_at": expires.isoformat(),
        "invite_used_at": None,
        "status": "pending_activation",
        # placeholder hash — login normal falha até definir password
        "password_hash": hash_password(secrets.token_urlsafe(32)),
    }


def _normalize_invite(code: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (code or "")).upper()


def verify_invite_code(plain: str, hashed: str) -> bool:
    return verify_password(_normalize_invite(plain), hashed or "")


def _rate_limited(key: str, max_attempts: int = 8, window_sec: int = 900) -> bool:
    now = datetime.now(timezone.utc).timestamp()
    bucket = [t for t in _attempts[key] if now - t < window_sec]
    _attempts[key] = bucket
    if len(bucket) >= max_attempts:
        return True
    _attempts[key].append(now)
    return False


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
        "telefone": u.get("telefone", ""),
        "role": "admin" if perfil.get("admin") else "colaborador",
        "perfil_id": u.get("perfil_id"),
        "perfil": {
            "id": perfil.get("id"),
            "nome": perfil.get("nome"),
            "admin": bool(perfil.get("admin")),
            "permissoes": perfil.get("permissoes") or perms_all(False),
        },
        "must_set_password": bool(u.get("must_set_password")),
        "status": u.get("status") or ("pending_activation" if u.get("must_set_password") else "active"),
        "invite_expires_at": u.get("invite_expires_at"),
        "avatar": u.get("avatar") or "",
        "created_at": u.get("created_at"),
    }


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Não autenticado")
    payload = _decode_token(credentials.credentials)
    if payload.get("type") == "activate":
        raise HTTPException(status_code=401, detail="Conclua a definição da password")
    if payload.get("type") not in (None, "access"):
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await users_repo.get(payload.get("sub"))
    if not user:
        raise HTTPException(status_code=401, detail="Utilizador não encontrado")
    if user.get("must_set_password"):
        raise HTTPException(status_code=403, detail="É necessário definir a password")
    if user.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="Conta desactivada")
    return user


async def get_activation_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Utilizador a partir de token de activação (só set-password)."""
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Não autenticado")
    payload = _decode_token(credentials.credentials)
    if payload.get("type") != "activate":
        raise HTTPException(status_code=401, detail="Token de activação inválido")
    user = await users_repo.get(payload.get("sub"))
    if not user or not user.get("must_set_password"):
        raise HTTPException(status_code=400, detail="Conta já activada ou inválida")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    perfil = await resolve_perfil(user)
    can = perfil.get("admin") or (perfil.get("permissoes") or {}).get("utilizadores", {}).get("edit")
    if not can:
        raise HTTPException(status_code=403, detail="Sem permissão de gestão de utilizadores")
    return user


def require_perm(modulo: str, acao: str = "view") -> Callable:
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        perfil = await resolve_perfil(user)
        if perfil.get("admin"):
            return user
        perms = perfil.get("permissoes") or {}
        if not (perms.get(modulo) or {}).get(acao):
            raise HTTPException(
                status_code=403,
                detail=f"Sem permissão ({modulo}.{acao})",
            )
        return user

    return _dep


auth_router = APIRouter(prefix="/api/auth", tags=["Auth"])


@auth_router.post(
    "/login",
    summary="Login",
    description=(
        "Autentica com **password** (conta activa) ou **código de convite** "
        "(primeira activação). No segundo caso devolve `activation_token` para "
        "`POST /api/auth/set-password`."
    ),
)
async def login(data: LoginInput, request: Request):
    identifier = (data.login or data.email or "").strip().lower()
    secret = (data.password or "").strip()
    client = (request.client.host if request.client else "unknown")
    rk = f"login:{client}:{identifier}"

    if _rate_limited(rk):
        raise HTTPException(status_code=429, detail="Demasiadas tentativas. Aguarde alguns minutos.")

    user = await users_repo.find_one({"login": identifier})
    if not user:
        user = await users_repo.find_one({"email": identifier})

    # Resposta genérica para não revelar se o user existe
    bad = HTTPException(status_code=401, detail="Utilizador ou credenciais incorretos")

    if not user or user.get("status") == "disabled":
        raise bad

    # --- Primeira activação: código de convite ---
    if user.get("must_set_password"):
        if not user.get("invite_code_hash"):
            raise HTTPException(status_code=400, detail="Pedido um novo código ao administrador")
        exp = user.get("invite_expires_at")
        if exp:
            try:
                if datetime.fromisoformat(exp.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    raise HTTPException(status_code=401, detail="Código de convite expirado. Peça um novo ao administrador.")
            except HTTPException:
                raise
            except Exception:
                pass
        if not verify_invite_code(secret, user.get("invite_code_hash", "")):
            raise bad
        token = create_activation_token(user["id"])
        return {
            "must_set_password": True,
            "activation_token": token,
            "token": None,
            "user": await user_public(user),
            "message": "Defina a sua password para concluir o acesso.",
        }

    # --- Login normal ---
    if not verify_password(secret, user.get("password_hash", "")):
        raise bad
    perfil = await resolve_perfil(user)
    role = "admin" if perfil.get("admin") else "colaborador"
    token = create_access_token(user["id"], user.get("email") or user.get("login"), role)
    return {
        "must_set_password": False,
        "activation_token": None,
        "token": token,
        "user": await user_public(user),
    }


@auth_router.post("/set-password", summary="Definir password (activação)")
async def set_password(data: SetPasswordInput, user: dict = Depends(get_activation_user)):
    if data.password_confirm and data.password != data.password_confirm:
        raise HTTPException(400, "As passwords não coincidem")
    err = validate_password_strength(data.password)
    if err:
        raise HTTPException(400, err)
    await users_repo.update(user["id"], {
        "password_hash": hash_password(data.password),
        "must_set_password": False,
        "invite_code_hash": None,
        "invite_expires_at": None,
        "invite_used_at": now_iso(),
        "status": "active",
    })
    user = await users_repo.get(user["id"])
    perfil = await resolve_perfil(user)
    role = "admin" if perfil.get("admin") else "colaborador"
    token = create_access_token(user["id"], user.get("email") or user.get("login"), role)
    return {"token": token, "user": await user_public(user), "must_set_password": False}


@auth_router.get("/me", summary="Utilizador atual")
async def auth_me(user: dict = Depends(get_current_user)):
    return await user_public(user)


@auth_router.put("/me", summary="Actualizar conta")
async def update_me(data: ProfileUpdate, user: dict = Depends(get_current_user)):
    patch = {}
    if data.login is not None:
        login = data.login.strip().lower()
        if not login:
            raise HTTPException(400, "Login obrigatório")
        if login != (user.get("login") or ""):
            if await users_repo.find_one({"login": login, "id": {"$ne": user["id"]}}):
                raise HTTPException(400, "Já existe um utilizador com este login")
            patch["login"] = login
    if data.name is not None:
        patch["name"] = data.name.strip()
    if data.email is not None:
        email = data.email.strip().lower()
        if email and email != (user.get("email") or ""):
            if await users_repo.find_one({"email": email, "id": {"$ne": user["id"]}}):
                raise HTTPException(400, "Já existe um utilizador com este email")
        patch["email"] = email
    if data.cargo is not None:
        patch["cargo"] = data.cargo.strip()
    if data.telefone is not None:
        patch["telefone"] = data.telefone.strip()
    if data.avatar is not None:
        patch["avatar"] = (data.avatar or "").strip()
    if not patch:
        return await user_public(user)
    await users_repo.update(user["id"], patch)
    user = await users_repo.get(user["id"])
    return await user_public(user)


PASSWORD_CODE_TTL_MIN = 15
PASSWORD_RESEND_COOLDOWN_SEC = 60


def create_password_reset_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "password_reset",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_CODE_TTL_MIN),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def _mask_email(email: str) -> str:
    try:
        local, domain = email.split("@", 1)
        if len(local) <= 2:
            masked = local[0] + "*"
        else:
            masked = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{masked}@{domain}"
    except Exception:
        return "***"


async def _find_user_by_identifier(login: Optional[str], email: Optional[str]) -> Optional[dict]:
    identifier = (login or email or "").strip().lower()
    if not identifier:
        return None
    user = await users_repo.find_one({"login": identifier})
    if not user:
        user = await users_repo.find_one({"email": identifier})
    return user


async def _issue_password_code(user: dict) -> dict:
    email = (user.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Esta conta não tem email válido para receber o código")

    last = user.get("password_change_sent_at")
    if last:
        try:
            sent = datetime.fromisoformat(last.replace("Z", "+00:00"))
            elapsed = (datetime.now(timezone.utc) - sent).total_seconds()
            if elapsed < PASSWORD_RESEND_COOLDOWN_SEC:
                wait = int(PASSWORD_RESEND_COOLDOWN_SEC - elapsed)
                raise HTTPException(
                    status_code=429,
                    detail={"message": f"Aguarde {wait}s para reenviar o código", "resend_after_sec": wait},
                )
        except HTTPException:
            raise
        except Exception:
            pass

    code = "".join(secrets.choice("0123456789") for _ in range(6))
    expires = datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_CODE_TTL_MIN)
    await users_repo.update(user["id"], {
        "password_change_code_hash": hash_password(code),
        "password_change_expires_at": expires.isoformat(),
        "password_change_sent_at": datetime.now(timezone.utc).isoformat(),
        "password_change_pending_hash": None,
    })

    subject, body, html = await email_service.password_reset_email(
        user.get("name") or user.get("login") or "",
        code,
        PASSWORD_CODE_TTL_MIN,
    )
    ok, reason = email_service.send_email(email, subject, body, html=html, attach_logo=True)

    resp = {
        "ok": True,
        "message": f"Enviámos um código para {_mask_email(email)}" if ok else "Código gerado",
        "email_masked": _mask_email(email),
        "email_sent": ok,
        "resend_after_sec": PASSWORD_RESEND_COOLDOWN_SEC,
    }
    if not ok and reason == "no_smtp":
        # Código só no log do servidor — nunca na resposta da API
        logger.warning("SMTP não configurado — código para %s: %s", email, code)
        raise HTTPException(503, "Envio de email não está configurado. Contacte o administrador.")
    if not ok:
        raise HTTPException(500, f"Não foi possível enviar o email: {reason}")
    return resp


async def _verify_password_code(user: dict, code: str) -> str:
    code_hash = user.get("password_change_code_hash")
    exp = user.get("password_change_expires_at")
    if not code_hash:
        raise HTTPException(400, "Peça primeiro um código de verificação")
    if exp:
        try:
            if datetime.fromisoformat(exp.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                raise HTTPException(400, "Código expirado. Peça um novo.")
        except HTTPException:
            raise
        except Exception:
            pass
    if not verify_password((code or "").strip(), code_hash):
        raise HTTPException(400, "Código incorrecto")
    # Invalidar código (uso único) e emitir token de reset
    await users_repo.update(user["id"], {
        "password_change_code_hash": None,
        "password_change_expires_at": None,
    })
    return create_password_reset_token(user["id"])


@auth_router.post("/me/password/request-code", summary="Enviar código (conta autenticada)")
async def me_request_password_code(user: dict = Depends(get_current_user)):
    return await _issue_password_code(user)


@auth_router.post("/me/password/verify-code", summary="Validar código (conta autenticada)")
async def me_verify_password_code(data: PasswordCodeVerify, user: dict = Depends(get_current_user)):
    token = await _verify_password_code(user, data.code)
    return {"ok": True, "reset_token": token, "message": "Código validado. Defina a nova password."}


@auth_router.post("/password/forgot/request", summary="Esqueci a password — enviar código")
async def forgot_password_request(data: ForgotPasswordRequest):
    """Só envia se existir utilizador com esse login/email e email válido."""
    user = await _find_user_by_identifier(data.login, data.email)
    if not user:
        raise HTTPException(404, "Não existe nenhum utilizador com esse email ou login")
    if user.get("status") == "disabled":
        raise HTTPException(400, "Esta conta está desactivada")
    if user.get("must_set_password"):
        raise HTTPException(400, "Esta conta ainda não activou a password. Use o código de convite no login.")
    email = (user.get("email") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(400, "Esta conta não tem um email válido associado")
    result = await _issue_password_code(user)
    return {
        "ok": True,
        "message": f"Enviámos um código para {result['email_masked']}.",
        "email_masked": result.get("email_masked"),
        "resend_after_sec": result.get("resend_after_sec", PASSWORD_RESEND_COOLDOWN_SEC),
        "email_sent": True,
    }


@auth_router.post("/password/forgot/verify-code", summary="Esqueci a password — validar código")
async def forgot_password_verify(data: PasswordCodeVerify):
    user = await _find_user_by_identifier(data.login, data.email)
    if not user:
        raise HTTPException(400, "Código incorrecto ou utilizador inválido")
    token = await _verify_password_code(user, data.code)
    return {"ok": True, "reset_token": token, "message": "Código validado. Defina a nova password."}


@auth_router.post("/password/reset", summary="Definir nova password após código")
async def password_reset_set(data: PasswordResetSet):
    if data.password_confirm and data.password != data.password_confirm:
        raise HTTPException(400, "As passwords não coincidem")
    err = validate_password_strength(data.password)
    if err:
        raise HTTPException(400, err)
    try:
        payload = jwt.decode(data.reset_token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sessão de redefinição expirada. Peça um novo código.")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    if payload.get("type") != "password_reset":
        raise HTTPException(401, "Token inválido")
    user = await users_repo.get(payload.get("sub"))
    if not user or user.get("status") == "disabled":
        raise HTTPException(400, "Utilizador inválido")
    await users_repo.update(user["id"], {
        "password_hash": hash_password(data.password),
        "password_change_code_hash": None,
        "password_change_expires_at": None,
        "password_change_pending_hash": None,
        "must_set_password": False,
        "status": "active",
    })
    return {"ok": True, "message": "Password actualizada. Já pode iniciar sessão."}


class AvatarInput(BaseModel):
    avatar: str = ""


@auth_router.put("/me/avatar", summary="Actualizar fotografia de perfil")
async def update_avatar(data: AvatarInput, user: dict = Depends(get_current_user)):
    path = (data.avatar or "").strip()
    await users_repo.update(user["id"], {"avatar": path})
    user = await users_repo.get(user["id"])
    return await user_public(user)
