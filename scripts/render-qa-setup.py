#!/usr/bin/env python3
"""Cria os serviços QA no Render (API + static) a partir de .env.qa.

Uso:
  1) Render → Account Settings → API Keys → Create API Key
  2) Guarda a key em .render-api-key (na raiz) OU:
       export RENDER_API_KEY=rnd_...
  3) python3 scripts/render-qa-setup.py

Requisitos: GitHub já ligado à conta Render, repo famarte23/or-amentos acessível.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.render.com/v1"
REPO = os.environ.get("RENDER_REPO", "1231497Nuno/velocely-qa-deploy")
BRANCH = os.environ.get("RENDER_BRANCH", "QA")
REGION = os.environ.get("RENDER_REGION", "frankfurt")


def load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def api_key() -> str:
    key = (os.environ.get("RENDER_API_KEY") or "").strip()
    if not key:
        f = ROOT / ".render-api-key"
        if f.is_file():
            key = f.read_text(encoding="utf-8").strip()
    if not key:
        sys.exit(
            "ERRO: falta RENDER_API_KEY.\n"
            "Cria em Render → Account Settings → API Keys\n"
            "e guarda em .render-api-key na raiz do projeto."
        )
    return key


def req(method: str, path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"HTTP {e.code} {method} {path}\n{err}", file=sys.stderr)
        raise SystemExit(1) from e


def owner_id() -> str:
    _, data = req("GET", "/owners?limit=20")
    items = data if isinstance(data, list) else []
    if not items:
        sys.exit("Sem owners/workspaces na conta Render.")
    o = items[0].get("owner") or items[0]
    return o["id"]


def list_services(owner: str) -> list[dict]:
    _, data = req("GET", f"/services?limit=50&ownerId={urllib.parse.quote(owner)}")
    items = data if isinstance(data, list) else []
    out = []
    for it in items:
        s = it.get("service") or it
        out.append(s)
    return out


def find(services: list[dict], name: str) -> dict | None:
    for s in services:
        if s.get("name") == name:
            return s
    return None


def service_url(s: dict) -> str:
    details = s.get("serviceDetails") or {}
    return (details.get("url") or s.get("url") or "").rstrip("/")


def ensure_api(owner: str, services: list[dict], env: dict) -> dict:
    existing = find(services, "velocely-qa-api")
    if existing:
        print(f"✓ API já existe: {existing['id']}  {service_url(existing)}")
        return existing

    body = {
        "type": "web_service",
        "name": "velocely-qa-api",
        "ownerId": owner,
        "repo": f"https://github.com/{REPO}",
        "branch": BRANCH,
        "autoDeploy": "yes",
        "rootDir": "backend",
        "serviceDetails": {
            "runtime": "python",
            "plan": "free",
            "region": REGION,
            "healthCheckPath": "/docs",
            "envSpecificDetails": {
                "buildCommand": "pip install -r requirements.txt",
                "startCommand": "uvicorn server:app --host 0.0.0.0 --port $PORT",
            },
        },
        "envVars": [
            {"key": "PYTHON_VERSION", "value": "3.12.8"},
            {"key": "DB_NAME", "value": "velocely_qa"},
            {"key": "UPLOAD_DIR", "value": "uploads"},
            {"key": "MONGO_URL", "value": env["MONGO_URL"]},
            {"key": "JWT_SECRET", "value": env["JWT_SECRET"]},
            {"key": "ADMIN_EMAIL", "value": env.get("ADMIN_EMAIL", "admin@velocely.local")},
            {"key": "ADMIN_PASSWORD", "value": env["ADMIN_PASSWORD"]},
            {"key": "CORS_ORIGINS", "value": "*"},
        ],
    }
    print("→ A criar velocely-qa-api…")
    _, data = req("POST", "/services", body)
    s = (data or {}).get("service") or data
    print(f"✓ API criada: {s['id']}  {service_url(s)}")
    return s


SPA_ROUTES = [{"type": "rewrite", "source": "/*", "destination": "/index.html"}]


def ensure_spa_routes(service_id: str) -> None:
    """SPA: refresh em /login, /encomendas/…, etc. tem de servir index.html."""
    _, data = req("GET", f"/services/{service_id}/routes")
    items = data if isinstance(data, list) else []
    routes = [(it.get("route") or it) for it in items]
    has_spa = any(
        r.get("type") == "rewrite"
        and r.get("source") in ("/*", "*")
        and r.get("destination") == "/index.html"
        for r in routes
    )
    if has_spa:
        print(f"✓ SPA rewrite já existe em {service_id}")
        return
    print(f"→ A aplicar SPA rewrite /* → /index.html em {service_id}…")
    req("PUT", f"/services/{service_id}/routes", SPA_ROUTES)
    print("✓ SPA rewrite aplicado")


def ensure_web(owner: str, services: list[dict], api_url: str) -> dict:
    existing = find(services, "velocely-qa-web")
    if existing:
        print(f"✓ Web já existe: {existing['id']}  {service_url(existing)}")
        ensure_spa_routes(existing["id"])
        return existing

    if not api_url:
        print("⚠ API ainda sem URL pública — cria o static depois do 1.º deploy.")
        return {}

    body = {
        "type": "static_site",
        "name": "velocely-qa-web",
        "ownerId": owner,
        "repo": f"https://github.com/{REPO}",
        "branch": BRANCH,
        "autoDeploy": "yes",
        "rootDir": "frontend",
        "serviceDetails": {
            "buildCommand": "npm run build",
            "publishPath": "build",
            "pullRequestPreviewsEnabled": "no",
            "routes": list(SPA_ROUTES),
        },
        "envVars": [
            {"key": "REACT_APP_BACKEND_URL", "value": api_url},
        ],
    }
    print("→ A criar velocely-qa-web…")
    _, data = req("POST", "/services", body)
    s = (data or {}).get("service") or data
    print(f"✓ Web criado: {s['id']}  {service_url(s)}")
    ensure_spa_routes(s["id"])
    return s


def main() -> None:
    env = load_dotenv(ROOT / ".env.qa")
    for k in ("MONGO_URL", "JWT_SECRET", "ADMIN_PASSWORD"):
        if not env.get(k):
            sys.exit(f"ERRO: falta {k} em .env.qa")

    owner = owner_id()
    print(f"Workspace: {owner}")
    services = list_services(owner)
    for s in services:
        print(f"  - {s.get('name')} ({s.get('type')}) {service_url(s)}")

    api = ensure_api(owner, services, env)
    url = service_url(api)
    # refresh list after create
    services = list_services(owner)
    web = ensure_web(owner, services, url)

    print()
    print("Pronto.")
    if url:
        print(f"  API:  {url}/docs")
    if web:
        wurl = service_url(web)
        if wurl:
            print(f"  App:  {wurl}")
    print("Espera 5–15 min pelo 1.º build (plano free).")
    print("Depois: Custom Domain testes.famart.pt no serviço web.")


if __name__ == "__main__":
    main()
