"""Helpers partilhados pelos testes de integração da API."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping, Optional

ORC_PUT_KEYS = (
    "cliente",
    "cliente_id",
    "descricao",
    "numero_encomenda",
    "data",
    "validade",
    "status",
    "notas",
    "linhas",
    "materiais",
    "desconto_total",
    "desconto_total_tipo",
    "imagens",
)


def orc_put_body(orc: Mapping[str, Any], **overrides: Any) -> dict:
    body = {k: orc[k] for k in ORC_PUT_KEYS if k in orc}
    body.update(overrides)
    return body


def first_orcamento_numerado(items) -> Optional[dict]:
    if isinstance(items, dict):
        items = items.get("items") or []
    for o in items or []:
        if str(o.get("numero") or "").strip():
            return o
    return None


def finalizar_orcamento(http, url: str, **kwargs):
    r = http.post(url, **kwargs)
    assert r.status_code == 200, r.text
    return r.json()


def finalizar_e_aceitar(http, api_prefix: str, oid: str, **kwargs):
    """Atribui número (finalizar) e passa a Aceite — pré-requisito de converter."""
    orc = finalizar_orcamento(http, f"{api_prefix}/orcamentos/{oid}/finalizar", **kwargs)
    r = http.put(f"{api_prefix}/orcamentos/{oid}", json=orc_put_body(orc, status="aceite"), **kwargs)
    assert r.status_code == 200, r.text
    return r.json()


DEFAULT_BASE_URL = "http://localhost:8000"


def get_base_url() -> str:
    """URL base da API (sem barra final).

    Ordem: BACKEND_URL → REACT_APP_BACKEND_URL → frontend/.env → localhost.
    """
    for key in ("BACKEND_URL", "REACT_APP_BACKEND_URL"):
        value = os.environ.get(key)
        if value:
            return value.rstrip("/")

    candidates = [
        Path(__file__).resolve().parents[2] / "frontend" / ".env",
        Path(__file__).resolve().parents[1].parent / "frontend" / ".env",
    ]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")

    return DEFAULT_BASE_URL


def get_admin_credentials() -> tuple[str, str]:
    email = os.environ.get("TEST_ADMIN_EMAIL") or os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_PASSWORD")
    if email and password:
        return email, password
    return "admin@velocely.local", "Admin123!"
