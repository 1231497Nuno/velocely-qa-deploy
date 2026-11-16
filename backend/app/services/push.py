"""Alertas no telemóvel (Web Push). Cada utilizador ativa no(s) seu(s) aparelho(s); os alertas do
workflow (tarefas) são também enviados como notificação. Sem a biblioteca `pywebpush` instalada,
fica simplesmente desligado (os alertas continuam na app e por email)."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import List

from app.core.database import now_iso
from app.repositories import empresa_repo, users_repo

logger = logging.getLogger(__name__)
VAPID_ID = "push_vapid"
MAX_SUBS = 6


def disponivel() -> bool:
    try:
        import pywebpush  # noqa: F401
        from cryptography.hazmat.primitives.asymmetric import ec  # noqa: F401
        return True
    except Exception:
        return False


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


async def chaves() -> dict:
    """Par de chaves VAPID da instalação (gerado na primeira utilização e guardado)."""
    doc = await empresa_repo.find_one({"id": VAPID_ID}) or {}
    if doc.get("privada_pem") and doc.get("publica"):
        return doc
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    k = ec.generate_private_key(ec.SECP256R1())
    pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    pub = k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    doc = {"id": VAPID_ID, "privada_pem": pem, "publica": _b64url(pub), "created_at": now_iso()}
    await empresa_repo.update_where({"id": VAPID_ID}, doc, upsert=True)
    return doc


def validar_subscricao(sub: dict) -> dict:
    from fastapi import HTTPException
    ep = str((sub or {}).get("endpoint") or "")
    keys = (sub or {}).get("keys") or {}
    if not ep.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(400, "Subscrição inválida")
    return {"endpoint": ep, "keys": {"p256dh": str(keys["p256dh"]), "auth": str(keys["auth"])}}


async def subscrever(user: dict, sub: dict, aparelho: str = "") -> dict:
    s = validar_subscricao(sub)
    u = await users_repo.get(user["id"]) or {}
    subs = [x for x in u.get("push_subs") or [] if x.get("endpoint") != s["endpoint"]]
    subs.append({**s, "aparelho": (aparelho or "")[:80], "at": now_iso()})
    await users_repo.update(user["id"], {"push_subs": subs[-MAX_SUBS:]})
    return {"ok": True, "n": len(subs[-MAX_SUBS:])}


async def cancelar(user: dict, endpoint: str) -> dict:
    u = await users_repo.get(user["id"]) or {}
    subs = [x for x in u.get("push_subs") or [] if x.get("endpoint") != endpoint]
    await users_repo.update(user["id"], {"push_subs": subs})
    return {"ok": True, "n": len(subs)}


def _enviar_um(sub: dict, payload: str, pem: str, contacto: str) -> int:
    """Devolve o código HTTP (0 = erro sem resposta)."""
    from pywebpush import WebPushException, webpush
    from py_vapid import Vapid
    try:
        r = webpush(subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]}, data=payload,
                    vapid_private_key=Vapid.from_pem(pem.encode()), vapid_claims={"sub": contacto}, ttl=86400)
        return getattr(r, "status_code", 201) or 201
    except WebPushException as e:
        return getattr(getattr(e, "response", None), "status_code", 0) or 0
    except Exception:
        logger.exception("Falha no envio push")
        return 0


async def enviar(user_ids: List[str], titulo: str, texto: str = "", link: str = "") -> int:
    """Notifica os aparelhos dos utilizadores; remove subscrições expiradas (404/410)."""
    if not user_ids or not disponivel():
        return 0
    k = await chaves()
    emp = await empresa_repo.find_one({"id": "empresa"}) or {}
    contacto = f"mailto:{emp.get('email') or 'geral@exemplo.pt'}"
    payload = json.dumps({"titulo": titulo[:120], "texto": (texto or "")[:300], "link": link or "/tarefas"})
    n = 0
    for uid in user_ids:
        u = await users_repo.get(uid) or {}
        subs = u.get("push_subs") or []
        if not subs:
            continue
        vivas = []
        for s in subs:
            code = await asyncio.to_thread(_enviar_um, s, payload, k["privada_pem"], contacto)
            if code in (404, 410):
                continue
            vivas.append(s)
            n += 1 if 200 <= code < 300 else 0
        if len(vivas) != len(subs):
            await users_repo.update(uid, {"push_subs": vivas})
    return n
