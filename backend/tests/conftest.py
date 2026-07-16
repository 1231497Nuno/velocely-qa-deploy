"""Helpers partilhados pelos testes de integração da API."""
from __future__ import annotations

import os
from pathlib import Path


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
