#!/usr/bin/env python3
"""Carrega dados de teste na base de desenvolvimento.

Uso (a partir da pasta backend/, com o venv ativo):

  python scripts/seed_dev.py
  python scripts/seed_dev.py --reset          # apaga catálogo + negócio e volta a criar
  python scripts/seed_dev.py --api            # via HTTP (API a correr em :8000)
  python scripts/seed_dev.py --api --url http://localhost:8000

O que cria (idempotente, salvo com --reset):
  - Catálogo: máquinas, mão de obra, materiais, tipos, artigos
  - Negócio: clientes, orçamentos (vários estados), encomendas, OFs

Não altera utilizadores nem perfis.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Garante que `app` e `server` resolvem quando corrido como script
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.chdir(BACKEND_ROOT)


def _load_dotenv() -> None:
    env_path = BACKEND_ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


COLLECTIONS_RESET = (
    "maquinas",
    "mao_obra",
    "consumiveis",
    "tipos_personalizacao",
    "artigos",
    "categorias",
    "subcategorias",
    "clientes",
    "orcamentos",
    "encomendas",
    "ordens_fabrico",
    "historico",
)


async def seed_direct(*, reset: bool) -> dict:
    from app.core.database import db, client
    from app.services.bootstrap import seed_catalogo, seed_demo_negocio, seed_perfis, seed_admin

    if reset:
        for name in COLLECTIONS_RESET:
            await db[name].delete_many({})
        print(f"Limpeza: {', '.join(COLLECTIONS_RESET)}")

    await seed_perfis()
    await seed_admin()
    cat = await seed_catalogo()
    demo = await seed_demo_negocio()
    client.close()
    return {"catalogo": cat, "negocio": demo, "reset": reset}


def seed_via_api(*, base_url: str, reset: bool) -> dict:
    try:
        import urllib.request
        import urllib.error
    except ImportError as e:
        raise SystemExit(f"urllib indisponível: {e}") from e

    if reset:
        raise SystemExit(
            "--reset via --api não é suportado (segurança).\n"
            "Usa: python scripts/seed_dev.py --reset   (acesso directo à BD)"
        )

    _load_dotenv()
    email = os.environ.get("ADMIN_EMAIL", "admin@velocely.local")
    password = os.environ.get("ADMIN_PASSWORD", "Admin123!")
    base = base_url.rstrip("/")

    def post(path: str, body: dict | None = None, token: str | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{base}{path}",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise SystemExit(f"HTTP {e.code} em {path}: {detail}") from e
        except urllib.error.URLError as e:
            raise SystemExit(
                f"API inacessível em {base} ({e.reason}).\n"
                "Arranca o backend ou corre sem --api."
            ) from e

    login = post("/api/auth/login", {"email": email, "password": password})
    token = login.get("token")
    if not token:
        raise SystemExit(f"Login falhou: {login}")
    result = post("/api/seed", {}, token)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Carrega dados de teste (desenvolvimento).")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Apaga catálogo/negócio/histórico e volta a seedar (só modo directo)",
    )
    parser.add_argument(
        "--api",
        action="store_true",
        help="Chama POST /api/seed na API (requer backend a correr)",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("SEED_API_URL", "http://localhost:8000"),
        help="Base URL da API (com --api). Default: http://localhost:8000",
    )
    args = parser.parse_args()

    _load_dotenv()

    if args.api:
        result = seed_via_api(base_url=args.url, reset=args.reset)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result = asyncio.run(seed_direct(reset=args.reset))
        if result["catalogo"] or result["negocio"] or result["reset"]:
            print("OK — dados de teste carregados.")
        else:
            print("OK — dados já existiam (nada a criar). Usa --reset para recriar.")
        print(json.dumps(result, ensure_ascii=False, indent=2))

    print(
        "\nResumo típico após seed:\n"
        "  · 4 clientes  · orçamentos em rascunho/enviado/aceite/rejeitado\n"
        "  · encomendas + OFs (pendente / em produção / concluída)\n"
        "Login: valor de ADMIN_EMAIL / ADMIN_PASSWORD no backend/.env"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
