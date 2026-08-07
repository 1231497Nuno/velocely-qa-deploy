#!/usr/bin/env python3
"""Reclassifica tipo_despesa das ordens de compra já importadas.

  python scripts/reclassificar_ordens_compra.py --dry-run
  python scripts/reclassificar_ordens_compra.py --env-file ../.env.shared
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import Counter
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
os.chdir(BACKEND_ROOT)


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


async def run(*, dry_run: bool) -> dict:
    from app.core.database import db, client
    from app.services.oc_classificacao import classificar_doc

    docs = await db["ordens_compra"].find({}, {"_id": 0}).to_list(10000)
    changes = []
    after = Counter()
    before = Counter()

    for d in docs:
        old = d.get("tipo_despesa") or ""
        new = classificar_doc(d)
        before[old] += 1
        after[new] += 1
        if old != new:
            changes.append({
                "id": d.get("id"),
                "codigo": d.get("codigo"),
                "assunto": (d.get("assunto") or "")[:60],
                "tipo_compra": d.get("tipo_compra"),
                "fornecedor_nome": d.get("fornecedor_nome"),
                "de": old,
                "para": new,
            })
            if not dry_run:
                await db["ordens_compra"].update_one(
                    {"id": d["id"]},
                    {"$set": {"tipo_despesa": new}},
                )

    client.close()
    return {
        "dry_run": dry_run,
        "total": len(docs),
        "alteradas": len(changes),
        "antes": dict(before),
        "depois": dict(after),
        "transicoes": {f"{a}→{b}": n for (a, b), n in Counter((c["de"], c["para"]) for c in changes).items()},
        "amostra": changes[:25],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    _load_dotenv()
    if args.env_file:
        _load_dotenv(args.env_file)
    result = asyncio.run(run(dry_run=args.dry_run))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
