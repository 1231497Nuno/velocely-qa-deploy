#!/usr/bin/env python3
"""Importa fornecedores a partir de data/Fornecedores.csv para a MongoDB.

Uso (a partir da pasta backend/, com o venv ativo):

  python scripts/import_fornecedores_csv.py --dry-run
  python scripts/import_fornecedores_csv.py --reset-fornecedores
  python scripts/import_fornecedores_csv.py --env-file ../.env.shared --reset-fornecedores

O CSV CRM não tem NIF: os registos entram como tipo «particular» (nome obrigatório;
podem ser promovidos a empresa na UI quando tiverem NIF e morada completos).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.chdir(BACKEND_ROOT)

DEFAULT_CSV = REPO_ROOT / "data" / "Fornecedores.csv"
RESET_COLLECTIONS = ("fornecedores",)


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


def _parse_created_at(raw: str) -> str:
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
    return p


def map_row(row: dict) -> dict:
    nome = _s(row, "Nome Fornecedor")
    if not nome:
        raise ValueError("linha sem Nome Fornecedor")
    return {
        "id": str(uuid.uuid4()),
        "codigo_origem": _s(row, "Cod. Fornecedor"),
        "nome": nome,
        # CSV sem NIF → particular (mesma lógica “sem NIF” dos clientes finais)
        "tipo": "particular",
        "email": _s(row, "Email"),
        "contacto": _s(row, "Telefone"),
        "website": _s(row, "Website"),
        "categoria": _s(row, "Categoria"),
        "morada": _s(row, "Rua"),
        "codigo_postal": _s(row, "Cód Postal"),
        "cidade": _s(row, "Cidade"),
        "pais": _normalize_pais(_s(row, "País")),
        "nif": "",
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
        "com_email": sum(1 for d in docs if d.get("email")),
        "com_contacto": sum(1 for d in docs if d.get("contacto")),
        "com_morada": sum(1 for d in docs if d.get("morada")),
        "com_website": sum(1 for d in docs if d.get("website")),
        "com_codigo_origem": sum(1 for d in docs if d.get("codigo_origem")),
    }


async def run(*, csv_path: Path, reset: bool, dry_run: bool) -> dict:
    docs = read_csv(csv_path)
    docs = sorted(docs, key=lambda d: (d.get("created_at") or "", d.get("nome") or ""))
    for i, d in enumerate(docs, start=1):
        d["codigo"] = f"FOR-{i:04d}"
    stats = _stats(docs)

    if dry_run:
        sample = [
            {k: docs[0][k] for k in ("codigo", "codigo_origem", "nome", "email", "contacto", "website", "tipo", "created_at")}
        ] if docs else []
        return {
            "dry_run": True,
            "csv": str(csv_path),
            "stats": stats,
            "sample": sample,
            "reset_would": list(RESET_COLLECTIONS) if reset else [],
        }

    from app.core.database import db, client

    wiped = {}
    if reset:
        for name in RESET_COLLECTIONS:
            res = await db[name].delete_many({})
            wiped[name] = res.deleted_count
            print(f"Limpeza {name}: {res.deleted_count}")

    if docs:
        await db["fornecedores"].insert_many(docs)
        await db.counters.update_one({"_id": "FOR"}, {"$set": {"seq": len(docs)}}, upsert=True)
    count = await db["fornecedores"].count_documents({})
    client.close()
    return {
        "dry_run": False,
        "csv": str(csv_path),
        "inserted": len(docs),
        "fornecedores_na_bd": count,
        "wiped": wiped,
        "stats": stats,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa fornecedores do CSV CRM para a BD.")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help=f"Caminho do CSV (default: {DEFAULT_CSV})")
    parser.add_argument(
        "--reset-fornecedores",
        action="store_true",
        help="Apaga a coleção fornecedores antes de importar",
    )
    parser.add_argument("--dry-run", action="store_true", help="Só estatísticas, sem escrever")
    parser.add_argument("--env-file", default="", help="Ficheiro .env (ex.: ../.env.shared)")
    args = parser.parse_args()

    if args.env_file:
        _load_dotenv(Path(args.env_file).expanduser().resolve())
    else:
        shared = REPO_ROOT / ".env.shared"
        if shared.exists():
            _load_dotenv(shared)
        _load_dotenv()

    try:
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    except ImportError:
        pass

    csv_path = Path(args.csv).expanduser().resolve()
    if not csv_path.exists():
        raise SystemExit(f"CSV não encontrado: {csv_path}")

    result = asyncio.run(run(csv_path=csv_path, reset=args.reset_fornecedores, dry_run=args.dry_run))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("\nDry-run — nada foi escrito.")
    else:
        print(f"\nOK — {result['inserted']} fornecedores importados (BD: {result['fornecedores_na_bd']}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
