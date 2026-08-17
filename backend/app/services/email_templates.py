"""Templates de email editáveis (Definições → Emails)."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from app.core.database import now_iso
from app.repositories import email_templates_repo

# Tipos fixos — não se criam/apagam na UI, só se editam
EMAIL_TEMPLATE_TYPES = ("password_reset", "orcamento", "encomenda_pronta", "encomenda_prazo")

EMAIL_TEMPLATE_META: Dict[str, Dict[str, Any]] = {
    "password_reset": {
        "nome": "Recuperação de password",
        "descricao": "Código enviado quando o utilizador pede para redefinir a password.",
        "placeholders": [
            {"key": "nome", "label": "Nome do utilizador"},
            {"key": "codigo", "label": "Código de 6 dígitos (destaque automático)"},
            {"key": "ttl_min", "label": "Validade em minutos"},
        ],
    },
    "orcamento": {
        "nome": "Envio de orçamento",
        "descricao": "Email ao cliente com o PDF do orçamento em anexo.",
        "placeholders": [
            {"key": "nome", "label": "Nome do cliente"},
            {"key": "numero", "label": "Número do orçamento"},
            {"key": "total", "label": "Valor total (ex.: 100,00 €)"},
            {"key": "total_linha", "label": "Linha 'Valor: …' ou vazia"},
            {"key": "mensagem", "label": "Mensagem extra do envio"},
        ],
    },
    "encomenda_pronta": {
        "nome": "Encomenda pronta",
        "descricao": "Notificação ao cliente de que a encomenda está pronta, com valores a faturar (PDF anexo).",
        "placeholders": [
            {"key": "nome", "label": "Nome do cliente"},
            {"key": "numero", "label": "Número da encomenda"},
            {"key": "total", "label": "Valor total da encomenda"},
            {"key": "valor_pago", "label": "Já pago"},
            {"key": "valor_a_faturar", "label": "Valor a faturar (em falta)"},
            {"key": "valor_pendente", "label": "Valor pendente (igual a a faturar)"},
            {"key": "valores_faturar", "label": "Bloco: total, pago e a faturar"},
            {"key": "mensagem", "label": "Mensagem extra do envio"},
        ],
    },
    "encomenda_prazo": {
        "nome": "Data de entrega prevista",
        "descricao": "Notificação ao cliente com a data de entrega prevista e os valores a faturar (PDF anexo).",
        "placeholders": [
            {"key": "nome", "label": "Nome do cliente"},
            {"key": "numero", "label": "Número da encomenda"},
            {"key": "prazo_entrega", "label": "Data de entrega prevista (ex.: 17/08/2026)"},
            {"key": "total", "label": "Valor total da encomenda"},
            {"key": "valor_pago", "label": "Já pago"},
            {"key": "valor_a_faturar", "label": "Valor a faturar (em falta)"},
            {"key": "valor_pendente", "label": "Valor pendente (igual a a faturar)"},
            {"key": "valores_faturar", "label": "Bloco: total, pago e a faturar"},
            {"key": "mensagem", "label": "Mensagem extra do envio"},
        ],
    },
}

EMAIL_TEMPLATE_DEFAULTS: Dict[str, Dict[str, str]] = {
    "password_reset": {
        "subject": "Velocely — código para alterar a sua password",
        "body": (
            "Olá {nome},\n\n"
            "A Velocely envia-lhe este email com um código para alterar a sua password no sistema.\n\n"
            "{codigo}\n\n"
            "Introduza este código na página de recuperação de password.\n"
            "É válido durante {ttl_min} minutos.\n\n"
            "Se não pediu esta alteração, ignore este email.\n\n"
            "— Equipa Velocely\n"
        ),
    },
    "orcamento": {
        "subject": "Velocely — Orçamento {numero}",
        "body": (
            "Olá {nome},\n\n"
            "Segue em anexo o orçamento {numero} da Velocely.\n"
            "{total_linha}\n"
            "{mensagem}\n\n"
            "Qualquer dúvida, estamos ao dispor.\n\n"
            "— Equipa Velocely\n"
        ),
    },
    "encomenda_pronta": {
        "subject": "Velocely — Encomenda {numero} pronta",
        "body": (
            "Olá {nome},\n\n"
            "A sua encomenda {numero} está pronta.\n\n"
            "{valores_faturar}\n\n"
            "{mensagem}\n\n"
            "Segue em anexo o documento da encomenda.\n"
            "Qualquer dúvida, estamos ao dispor.\n\n"
            "— Equipa Velocely\n"
        ),
    },
    "encomenda_prazo": {
        "subject": "Velocely — Encomenda {numero}: data de entrega prevista",
        "body": (
            "Olá {nome},\n\n"
            "A data de entrega prevista da sua encomenda {numero} é {prazo_entrega}.\n\n"
            "{valores_faturar}\n\n"
            "{mensagem}\n\n"
            "Segue em anexo o documento da encomenda.\n"
            "Qualquer dúvida, estamos ao dispor.\n\n"
            "— Equipa Velocely\n"
        ),
    },
}


def _default_doc(tipo: str) -> dict:
    d = EMAIL_TEMPLATE_DEFAULTS[tipo]
    meta = EMAIL_TEMPLATE_META[tipo]
    return {
        "id": tipo,
        "tipo": tipo,
        "nome": meta["nome"],
        "descricao": meta["descricao"],
        "subject": d["subject"],
        "body": d["body"],
        "placeholders": meta["placeholders"],
        "updated_at": None,
    }


def apply_vars(template: str, variables: Dict[str, Any]) -> str:
    out = template or ""
    for key, value in variables.items():
        out = out.replace("{" + key + "}", "" if value is None else str(value))
    # Remover placeholders desconhecidos vazios
    out = re.sub(r"\{[a-zA-Z0-9_]+\}", "", out)
    while "\n\n\n" in out:
        out = out.replace("\n\n\n", "\n\n")
    return out.strip() + "\n"


def _esc(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def text_to_html_fragments(text: str) -> str:
    """Converte texto com newlines em HTML; linhas só com dígitos ficam em destaque."""
    chunks: List[str] = []
    paragraphs = (text or "").strip().split("\n\n")
    for i, para in enumerate(paragraphs):
        lines = para.split("\n")
        parts: List[str] = []
        for line in lines:
            stripped = line.strip()
            if re.fullmatch(r"\d{4,8}", stripped):
                parts.append(
                    f'<span style="display:block;margin:8px 0 12px;font-size:32px;letter-spacing:0.25em;'
                    f'font-weight:700;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">'
                    f"{_esc(stripped)}</span>"
                )
            else:
                parts.append(_esc(line))
        margin = "0 0 14px" if i < len(paragraphs) - 1 else "0"
        chunks.append(
            f'<p style="margin:{margin};font-size:14px;line-height:1.5;color:#4b5563;">{ "<br/>".join(parts) }</p>'
        )
    return "\n".join(chunks)


_LEGACY_BODIES = {
    "encomenda_pronta": (
        "Olá {nome},\n\n"
        "A sua encomenda {numero} está pronta.\n\n"
        "{mensagem}\n\n"
        "Segue em anexo o documento da encomenda.\n"
        "Qualquer dúvida, estamos ao dispor.\n\n"
        "— Equipa Velocely\n"
    ),
    "encomenda_prazo": (
        "Olá {nome},\n\n"
        "A data de entrega prevista da sua encomenda {numero} é {prazo_entrega}.\n\n"
        "{mensagem}\n\n"
        "Segue em anexo o documento da encomenda.\n"
        "Qualquer dúvida, estamos ao dispor.\n\n"
        "— Equipa Velocely\n"
    ),
}


async def get_template(tipo: str) -> dict:
    if tipo not in EMAIL_TEMPLATE_TYPES:
        raise ValueError(f"Tipo de template inválido: {tipo}")
    doc = await email_templates_repo.get(tipo)
    base = _default_doc(tipo)
    if not doc:
        return base
    body = doc.get("body") if doc.get("body") is not None else base["body"]
    legacy = _LEGACY_BODIES.get(tipo)
    if legacy and (body or "").strip() == legacy.strip():
        body = base["body"]
    return {
        **base,
        "subject": doc.get("subject") or base["subject"],
        "body": body,
        "updated_at": doc.get("updated_at"),
    }


async def list_templates() -> List[dict]:
    return [await get_template(t) for t in EMAIL_TEMPLATE_TYPES]


async def save_template(tipo: str, subject: str, body: str) -> dict:
    if tipo not in EMAIL_TEMPLATE_TYPES:
        raise ValueError(f"Tipo de template inválido: {tipo}")
    subject = (subject or "").strip()
    body = body if body is not None else ""
    if not subject:
        raise ValueError("O assunto é obrigatório")
    if not body.strip():
        raise ValueError("O corpo do email é obrigatório")
    meta = EMAIL_TEMPLATE_META[tipo]
    doc = {
        "id": tipo,
        "tipo": tipo,
        "nome": meta["nome"],
        "descricao": meta["descricao"],
        "subject": subject,
        "body": body,
        "updated_at": now_iso(),
    }
    await email_templates_repo.update_where({"id": tipo}, doc, upsert=True)
    return await get_template(tipo)


async def reset_template(tipo: str) -> dict:
    if tipo not in EMAIL_TEMPLATE_TYPES:
        raise ValueError(f"Tipo de template inválido: {tipo}")
    await email_templates_repo.delete({"id": tipo})
    return await get_template(tipo)


async def render_email(tipo: str, variables: Dict[str, Any]) -> Tuple[str, str, str]:
    """Devolve (subject, text, html_body_inner) — o caller envolve com branding."""
    tpl = await get_template(tipo)
    subject = apply_vars(tpl["subject"], variables).strip()
    text = apply_vars(tpl["body"], variables)
    html_inner = text_to_html_fragments(text)
    return subject, text, html_inner
