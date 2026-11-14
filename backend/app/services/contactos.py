"""Helpers para contactos da empresa e destinatários de email."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.domain.models import PAPEL_CONTACTO_PT, PAPEIS_CONTACTO
from app.repositories import clientes_repo


def contactos_activos(cliente: Optional[dict]) -> List[dict]:
    if not cliente:
        return []
    out = []
    for c in cliente.get("contactos") or []:
        if not isinstance(c, dict):
            continue
        if c.get("ativo") is False:
            continue
        if not (c.get("nome") or "").strip():
            continue
        out.append(c)
    return out


def find_contacto(cliente: Optional[dict], contacto_id: Optional[str]) -> Optional[dict]:
    if not cliente or not contacto_id:
        return None
    for c in cliente.get("contactos") or []:
        if isinstance(c, dict) and c.get("id") == contacto_id:
            return c
    return None


def contacto_papeis(contacto: Optional[dict]) -> List[str]:
    if not contacto:
        return []
    raw = contacto.get("papeis")
    if isinstance(raw, str):
        raw = [raw]
    out = []
    for p in raw or []:
        key = str(p or "").strip().lower()
        if key in PAPEIS_CONTACTO and key not in out:
            out.append(key)
    # Legado: cargo livre com palavras-chave
    if not out:
        cargo = (contacto.get("cargo") or "").strip().lower()
        if any(x in cargo for x in ("financ", "conta", "tesour")):
            out.append("financeiro")
        if any(x in cargo for x in ("compra", "decisor", "aprov", "diretor", "director", "gestor")):
            out.append("decisor")
        if any(x in cargo for x in ("tecnic", "design", "arte", "pre-press", "prepress", "graf")):
            out.append("tecnico")
    return out


def label_papeis(contacto: Optional[dict]) -> str:
    return " · ".join(PAPEL_CONTACTO_PT.get(p, p) for p in contacto_papeis(contacto))


def find_contacto_por_papel(cliente: Optional[dict], papel: str) -> Optional[dict]:
    papel = (papel or "").strip().lower()
    if papel not in PAPEIS_CONTACTO:
        return None
    for c in contactos_activos(cliente):
        if papel in contacto_papeis(c) and (c.get("email") or "").strip():
            return c
    return None


def denorm_contacto(contacto: Optional[dict]) -> Dict[str, Any]:
    if not contacto:
        return {
            "contacto_id": None,
            "contacto_nome": "",
            "contacto_email": "",
            "contacto_telefone": "",
            "contacto_cargo": "",
            "contacto_departamento": "",
            "contacto_papeis": [],
        }
    return {
        "contacto_id": contacto.get("id"),
        "contacto_nome": (contacto.get("nome") or "").strip(),
        "contacto_email": (contacto.get("email") or "").strip(),
        "contacto_telefone": (contacto.get("telefone") or "").strip(),
        "contacto_cargo": (contacto.get("cargo") or "").strip(),
        "contacto_departamento": (contacto.get("departamento") or "").strip(),
        "contacto_papeis": contacto_papeis(contacto),
    }


def resolve_email_destinatario(
    doc: Optional[dict],
    cliente: Optional[dict],
    *,
    explicit_to: str = "",
    prefer_papel: str = "",
) -> str:
    """
    Destinatário por ordem:
    1. explicit_to (body do pedido)
    2. contacto «à atenção de» do documento
    3. contacto activo com o papel preferido (ex.: financeiro para faturas)
    4. email geral da empresa/cliente
    """
    to = (explicit_to or "").strip()
    if to and "@" in to:
        return to

    if doc:
        cemail = (doc.get("contacto_email") or "").strip()
        if cemail and "@" in cemail:
            return cemail

    papel = (prefer_papel or "").strip().lower()
    if papel:
        c = find_contacto_por_papel(cliente, papel)
        if c:
            email = (c.get("email") or "").strip()
            if email and "@" in email:
                return email

    fallback = ((cliente or {}).get("email") or "").strip()
    return fallback if fallback and "@" in fallback else ""


async def apply_contacto_denorm(payload: dict) -> dict:
    """Valida contacto_id contra a empresa e preenche campos denormalizados."""
    cid = payload.get("cliente_id")
    contacto_id = payload.get("contacto_id") or None
    if not cid or not contacto_id:
        payload.update(denorm_contacto(None))
        return payload

    cliente = await clientes_repo.get(cid)
    contacto = find_contacto(cliente, contacto_id)
    if not contacto or contacto.get("ativo") is False:
        payload.update(denorm_contacto(None))
        return payload

    payload.update(denorm_contacto(contacto))
    return payload


def copy_contacto_fields(src: dict) -> Dict[str, Any]:
    return {
        "contacto_id": src.get("contacto_id"),
        "contacto_nome": src.get("contacto_nome") or "",
        "contacto_email": src.get("contacto_email") or "",
        "contacto_telefone": src.get("contacto_telefone") or "",
        "contacto_cargo": src.get("contacto_cargo") or "",
        "contacto_departamento": src.get("contacto_departamento") or "",
        "contacto_papeis": list(src.get("contacto_papeis") or []),
    }
