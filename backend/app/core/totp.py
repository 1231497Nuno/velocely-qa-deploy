"""Códigos de verificação temporários (TOTP, RFC 6238) — compatíveis com Google Authenticator,
Microsoft Authenticator, 1Password, etc. Só biblioteca padrão."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

PERIODO = 30
DIGITOS = 6


def gerar_segredo() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _chave(segredo: str) -> bytes:
    s = segredo.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def codigo(segredo: str, instante: float | None = None) -> str:
    contador = int((time.time() if instante is None else instante) // PERIODO)
    h = hmac.new(_chave(segredo), struct.pack(">Q", contador), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    n = (struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % (10 ** DIGITOS)
    return str(n).zfill(DIGITOS)


def verificar(segredo: str, valor: str, janela: int = 1, instante: float | None = None) -> bool:
    v = "".join(c for c in str(valor or "") if c.isdigit())
    if len(v) != DIGITOS or not segredo:
        return False
    t = time.time() if instante is None else instante
    return any(hmac.compare_digest(codigo(segredo, t + d * PERIODO), v) for d in range(-janela, janela + 1))


def uri(segredo: str, conta: str, emissor: str = "Velocely") -> str:
    return (f"otpauth://totp/{quote(emissor)}:{quote(conta)}?secret={segredo}&issuer={quote(emissor)}"
            f"&algorithm=SHA1&digits={DIGITOS}&period={PERIODO}")


def qr_svg(texto: str) -> str:
    from reportlab.graphics import renderSVG
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    w = QrCodeWidget(texto)
    b = w.getBounds()
    tam = 200
    d = Drawing(tam, tam, transform=[tam / (b[2] - b[0]), 0, 0, tam / (b[3] - b[1]), 0, 0])
    d.add(w)
    return renderSVG.drawToString(d)
