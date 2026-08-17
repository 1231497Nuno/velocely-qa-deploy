"""Envio de emails (SMTP). Sem SMTP configurado, faz log do código (dev)."""
from __future__ import annotations

import logging
import smtplib
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from app.core import config

logger = logging.getLogger(__name__)

_STATIC = Path(__file__).resolve().parent.parent / "static"
_EMAIL_MARK = _STATIC / "email-logo-on-white.png"
_EMAIL_MARK_FALLBACK = _STATIC / "email-mark.png"
_EMAIL_WORDMARK = _STATIC / "email-logo-wordmark.png"

# (filename, bytes, mime)
Attachment = Tuple[str, bytes, str]


def smtp_configured() -> bool:
    return bool(getattr(config, "SMTP_HOST", None) and getattr(config, "SMTP_FROM", None))


def logo_url() -> str:
    return (getattr(config, "EMAIL_LOGO_URL", "") or "").strip()


def email_logo_path() -> Optional[Path]:
    custom = (getattr(config, "EMAIL_LOGO_PATH", "") or "").strip()
    if custom and Path(custom).is_file():
        return Path(custom)
    for p in (_EMAIL_WORDMARK, _EMAIL_MARK, _EMAIL_MARK_FALLBACK):
        if p.is_file():
            return p
    return None


def email_logo_bytes() -> Optional[bytes]:
    p = email_logo_path()
    if not p:
        return None
    try:
        return p.read_bytes()
    except Exception:
        logger.exception("Não foi possível ler o logótipo para email")
        return None


def mask_email(email: str) -> str:
    try:
        local, domain = email.split("@", 1)
        if len(local) <= 2:
            masked = local[0] + "*"
        else:
            masked = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{masked}@{domain}"
    except Exception:
        return "***"


def _esc(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _branded_html(body_html: str) -> str:
    img_src = logo_url() or "cid:velocely_logo"
    return f"""\
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;">
          <tr>
            <td align="center" style="padding:24px 28px 12px;background:#ffffff;">
              <img src="{_esc(img_src)}" alt="Velocely" width="240" height="59"
                   style="display:block;margin:0 auto;width:240px;height:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 28px 12px;">
              <div style="height:1px;background:#d1d5db;line-height:1px;font-size:1px;width:100%;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              {body_html}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">Velocely · Gestão de Produção</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


async def password_reset_email(name: str, code: str, ttl_min: int = 15) -> Tuple[str, str, str]:
    from app.services import email_templates as tpl

    nome = (name or "").strip() or "utilizador"
    subject, text, inner = await tpl.render_email(
        "password_reset",
        {"nome": nome, "codigo": code, "ttl_min": str(ttl_min)},
    )
    return subject, text, _branded_html(inner)


async def orcamento_email(
    cliente_nome: str,
    numero: str,
    *,
    total: Optional[str] = None,
    mensagem: str = "",
) -> Tuple[str, str, str]:
    from app.services import email_templates as tpl

    nome = (cliente_nome or "").strip() or "Cliente"
    num = (numero or "").strip() or "—"
    total_linha = f"Valor: {total}" if total else ""
    subject, text, inner = await tpl.render_email(
        "orcamento",
        {
            "nome": nome,
            "numero": num,
            "total": total or "",
            "total_linha": total_linha,
            "mensagem": (mensagem or "").strip(),
        },
    )
    return subject, text, _branded_html(inner)


def fmt_date_pt(iso: Optional[str]) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(str(iso)[:10]).strftime("%d/%m/%Y")
    except Exception:
        return str(iso)


def fmt_money(v, simbolo: str = "€") -> str:
    n = float(v or 0)
    s = f"{n:,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} {simbolo}".replace("  ", " ").strip()


def valores_encomenda_email(enc: dict, simbolo: str = "€") -> dict:
    """Totais a comunicar ao cliente (total, pago, a faturar)."""
    total = enc.get("total_com_iva")
    if total is None:
        total = enc.get("valor_total") or 0
    pago = enc.get("valor_pago") or 0
    pendente = enc.get("valor_pendente")
    if pendente is None:
        pendente = max(0.0, float(total or 0) - float(pago or 0))
    total_s = fmt_money(total, simbolo)
    pago_s = fmt_money(pago, simbolo)
    pend_s = fmt_money(pendente, simbolo)
    block = (
        f"Valor da encomenda: {total_s}\n"
        f"Já pago: {pago_s}\n"
        f"Valor a faturar: {pend_s}"
    )
    return {
        "total": total_s,
        "valor_pago": pago_s,
        "valor_pendente": pend_s,
        "valor_a_faturar": pend_s,
        "valores_faturar": block,
    }


async def _render_encomenda_cliente_email(tipo: str, variables: dict) -> Tuple[str, str, str]:
    from app.services import email_templates as tpl

    doc = await tpl.get_template(tipo)
    subject, text, inner = await tpl.render_email(tipo, variables)
    block = (variables.get("valores_faturar") or "").strip()
    body_src = doc.get("body") or ""
    if block and "{valores_faturar}" not in body_src and block not in (text or ""):
        text = (text or "").rstrip() + "\n\n" + block + "\n"
        inner = tpl.text_to_html_fragments(text)
    return subject, text, _branded_html(inner)


async def encomenda_pronta_email(
    cliente_nome: str,
    numero: str,
    *,
    mensagem: str = "",
    valores: Optional[dict] = None,
) -> Tuple[str, str, str]:
    nome = (cliente_nome or "").strip() or "Cliente"
    num = (numero or "").strip() or "—"
    vars_ = {
        "nome": nome,
        "numero": num,
        "mensagem": (mensagem or "").strip(),
        **(valores or {}),
    }
    return await _render_encomenda_cliente_email("encomenda_pronta", vars_)


async def encomenda_prazo_email(
    cliente_nome: str,
    numero: str,
    prazo_entrega: str,
    *,
    mensagem: str = "",
    valores: Optional[dict] = None,
) -> Tuple[str, str, str]:
    nome = (cliente_nome or "").strip() or "Cliente"
    num = (numero or "").strip() or "—"
    prazo = fmt_date_pt(prazo_entrega) or (prazo_entrega or "—")
    vars_ = {
        "nome": nome,
        "numero": num,
        "prazo_entrega": prazo,
        "mensagem": (mensagem or "").strip(),
        **(valores or {}),
    }
    return await _render_encomenda_cliente_email("encomenda_prazo", vars_)


def send_email(
    to: str,
    subject: str,
    body: str,
    *,
    html: Optional[str] = None,
    attach_logo: bool = True,
    attachments: Optional[Sequence[Attachment]] = None,
) -> Tuple[bool, Optional[str]]:
    to = (to or "").strip()
    if not to or "@" not in to:
        return False, "Email do utilizador em falta ou inválido"

    if not smtp_configured():
        logger.warning("SMTP não configurado — email não enviado para %s | %s | %s", to, subject, body)
        return False, "no_smtp"

    use_cid = bool(html and attach_logo and not logo_url() and "cid:velocely_logo" in html)
    logo_data = email_logo_bytes() if use_cid else None
    files: List[Attachment] = list(attachments or [])

    # mixed → related/alternative + attachments
    if files or (use_cid and logo_data):
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = config.SMTP_FROM
        msg["To"] = to

        if use_cid and logo_data:
            related = MIMEMultipart("related")
            alt = MIMEMultipart("alternative")
            related.attach(alt)
            alt.attach(MIMEText(body, "plain", "utf-8"))
            if html:
                alt.attach(MIMEText(html, "html", "utf-8"))
            img = MIMEImage(logo_data, _subtype="png")
            img.add_header("Content-ID", "<velocely_logo>")
            img.add_header("Content-Disposition", "inline")
            related.attach(img)
            msg.attach(related)
        else:
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(body, "plain", "utf-8"))
            if html:
                alt.attach(MIMEText(html, "html", "utf-8"))
            msg.attach(alt)

        for filename, content, mime in files:
            maintype, _, subtype = (mime or "application/octet-stream").partition("/")
            if maintype == "application" and subtype == "pdf":
                part = MIMEApplication(content, _subtype="pdf")
            else:
                part = MIMEApplication(content)
            part.add_header("Content-Disposition", "attachment", filename=filename)
            msg.attach(part)
    else:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = config.SMTP_FROM
        msg["To"] = to
        msg.attach(MIMEText(body, "plain", "utf-8"))
        if html:
            msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if getattr(config, "SMTP_TLS", True):
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
                s.starttls()
                if config.SMTP_USER:
                    s.login(config.SMTP_USER, config.SMTP_PASSWORD or "")
                s.send_message(msg)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
                if config.SMTP_USER:
                    s.login(config.SMTP_USER, config.SMTP_PASSWORD or "")
                s.send_message(msg)
        return True, None
    except Exception as ex:
        logger.exception("Falha ao enviar email para %s", to)
        return False, str(ex)
