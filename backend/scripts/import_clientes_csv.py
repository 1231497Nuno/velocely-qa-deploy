#!/usr/bin/env python3
"""Importa clientes a partir de data/Clientes.csv para a MongoDB.

Uso (a partir da pasta backend/, com o venv ativo):

  python scripts/import_clientes_csv.py --dry-run
  python scripts/import_clientes_csv.py --reset-clientes
  python scripts/import_clientes_csv.py --env-file ../.env.shared --reset-clientes

Com --reset-clientes apaga clientes e dados transacionais demo ligados
(orçamentos, encomendas, OFs, documentos financeiros, histórico).
Não altera utilizadores nem catálogo.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.chdir(BACKEND_ROOT)

DEFAULT_CSV = REPO_ROOT / "data" / "Clientes.csv"

RESET_COLLECTIONS = (
    "clientes",
    "orcamentos",
    "encomendas",
    "ordens_fabrico",
    "documentos_financeiros",
    "historico",
)


def _load_dotenv(path: Path | None = None) -> None:
    env_path = path or (BACKEND_ROOT / ".env")
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if path is not None:
            os.environ[key] = val
        else:
            os.environ.setdefault(key, val)


def _s(row: dict, *keys: str) -> str:
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        t = str(v).strip()
        if t:
            return t
    return ""


def _normalize_nif(raw: str) -> str:
    return re.sub(r"\s+", "", raw or "")


def _parse_created_at(raw: str) -> str:
    """CRM: 22-01-2024 15:15:59 → ISO UTC (assume local sem TZ → UTC naive as-is)."""
    raw = (raw or "").strip()
    if not raw:
        return datetime.now(timezone.utc).isoformat()
    for fmt in ("%d-%m-%Y %H:%M:%S", "%d-%m-%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    return datetime.now(timezone.utc).isoformat()


def _normalize_pais(raw: str) -> str:
    p = (raw or "").strip()
    if not p:
        return "Portugal"
    if p.upper() == "PORTUGAL":
        return "Portugal"
    if p.lower() in ("suisse", "suiça", "suíça"):
        return "Suíça"
    return p


def map_row(row: dict) -> dict:
    nome = _s(row, "Nome Cliente")
    if not nome:
        raise ValueError("linha sem Nome Cliente")

    return {
        "id": str(uuid.uuid4()),
        "codigo_origem": _s(row, "Nº Cliente"),
        "nome": nome,
        "email": _s(row, "Email"),
        "contacto": _s(row, "Telemóvel"),
        "morada": _s(row, "Nome da Rua"),
        "codigo_postal": _s(row, "Cód Postal"),
        "cidade": _s(row, "Cidade"),
        "pais": _normalize_pais(_s(row, "País")),
        "nif": _normalize_nif(_s(row, "Contribuinte")),
        "tipo": "empresa" if _normalize_nif(_s(row, "Contribuinte")) else "particular",
        "notas": _s(row, "Descrição"),
        "responsavel": _s(row, "Responsável"),
        "created_at": _parse_created_at(_s(row, "Data Criação")),
    }


def read_csv(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(text.splitlines(), delimiter=";")
    if not reader.fieldnames:
        raise SystemExit(f"CSV sem cabeçalho: {path}")
    rows = []
    for i, row in enumerate(reader, start=2):
        try:
            rows.append(map_row(row))
        except ValueError as e:
            print(f"Aviso linha {i}: {e} — ignorada", file=sys.stderr)
    return rows


def _stats(docs: list[dict]) -> dict:
    return {
        "total": len(docs),
        "com_nif": sum(1 for d in docs if d.get("nif")),
        "sem_email": sum(1 for d in docs if not d.get("email")),
        "sem_morada": sum(1 for d in docs if not d.get("morada")),
        "sem_contacto": sum(1 for d in docs if not d.get("contacto")),
        "com_codigo_origem": sum(1 for d in docs if d.get("codigo_origem")),
        "responsaveis": sorted({d.get("responsavel") for d in docs if d.get("responsavel")}),
    }


async def run(*, csv_path: Path, reset: bool, dry_run: bool) -> dict:
    docs = read_csv(csv_path)
    # Códigos Velocely CLI-0001… (CRM fica em codigo_origem)
    docs = sorted(docs, key=lambda d: (d.get("created_at") or "", d.get("nome") or ""))
    for i, d in enumerate(docs, start=1):
        d["codigo"] = f"CLI-{i:04d}"
    stats = _stats(docs)

    if dry_run:
        sample = [{k: docs[0][k] for k in ("codigo", "codigo_origem", "nome", "email", "contacto", "nif", "responsavel", "created_at")}] if docs else []
        return {"dry_run": True, "csv": str(csv_path), "stats": stats, "sample": sample, "reset_would": list(RESET_COLLECTIONS) if reset else []}

    from app.core.database import db, client

    wiped = {}
    if reset:
        for name in RESET_COLLECTIONS:
            res = await db[name].delete_many({})
            wiped[name] = res.deleted_count
            print(f"Limpeza {name}: {res.deleted_count}")

    if docs:
        await db["clientes"].insert_many(docs)
        await db.counters.update_one({"_id": "CLI"}, {"$set": {"seq": len(docs)}}, upsert=True)
    count = await db["clientes"].count_documents({})
    client.close()
    return {"dry_run": False, "csv": str(csv_path), "inserted": len(docs), "clientes_na_bd": count, "wiped": wiped, "stats": stats}


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa clientes do CSV CRM para a BD.")
    parser.add_argument(
        "--csv",
        default=str(DEFAULT_CSV),
        help=f"Caminho do CSV (default: {DEFAULT_CSV})",
    )
    parser.add_argument(
        "--reset-clientes",
        action="store_true",
        help="Apaga clientes + orçamentos/encomendas/OFs/financeiro/histórico antes de importar",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Só mostra mapeamento/estatísticas, sem escrever na BD",
    )
    parser.add_argument(
        "--env-file",
        default="",
        help="Ficheiro .env a carregar (ex.: ../.env.shared). Sobrescreve variáveis.",
    )
    args = parser.parse_args()

    if args.env_file:
        _load_dotenv(Path(args.env_file).expanduser().resolve())
    else:
        shared = REPO_ROOT / ".env.shared"
        if shared.exists():
            _load_dotenv(shared)
        _load_dotenv()

    # TLS Atlas no macOS
    try:
        import certifi

        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    except ImportError:
        pass

    csv_path = Path(args.csv).expanduser().resolve()
    if not csv_path.exists():
        raise SystemExit(f"CSV não encontrado: {csv_path}")

    result = asyncio.run(run(csv_path=csv_path, reset=args.reset_clientes, dry_run=args.dry_run))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("\nDry-run — nada foi escrito.")
    else:
        print(f"\nOK — {result['inserted']} clientes importados (BD: {result['clientes_na_bd']}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
