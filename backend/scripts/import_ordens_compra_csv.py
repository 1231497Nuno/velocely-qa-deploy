#!/usr/bin/env python3
"""Importa ordens de compra a partir de data/Ordens_de_Compra.csv.

Agrupa linhas pelo «Nº Ordem de Compra» e classifica tipo_despesa:

  compra           — matéria-prima / stock para vender (Produtos, Consumíveis, …)
  despesa_normal   — operacional (água, luz, renda, SS, manutenção, …)
  despesa_diversa  — extraordinário (anúncios, rifas, portes, hotéis, …)

Uso (a partir de backend/, com venv):

  python scripts/import_ordens_compra_csv.py --dry-run
  python scripts/import_ordens_compra_csv.py --reset-ordens-compra
  python scripts/import_ordens_compra_csv.py --env-file ../.env.shared --reset-ordens-compra
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
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.chdir(BACKEND_ROOT)

DEFAULT_CSV = REPO_ROOT / "data" / "Ordens_de_Compra.csv"
RESET_COLLECTIONS = ("ordens_compra",)

ESTADO_MAP = {
    "received shipment": "recebida",
    "created": "criada",
    "cancelled": "cancelada",
    "canceled": "cancelada",
}


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


def _clean_ref(raw: str) -> str:
    t = (raw or "").strip()
    if "::::" in t:
        t = t.split("::::", 1)[-1].strip()
    return t


def _f(raw: str, default: float = 0.0) -> float:
    t = (raw or "").strip().replace(" ", "").replace(",", ".")
    if not t or t in ("'-", "-", "—"):
        return default
    if t.startswith("'"):
        t = t[1:]
    try:
        return float(t)
    except ValueError:
        return default


def _parse_date(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    date_part = raw.split()[0] if " " in raw else raw
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(date_part, fmt).date().isoformat()
        except ValueError:
            continue
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


def _estado(raw: str) -> str:
    return ESTADO_MAP.get((raw or "").strip().lower(), "criada")


def _strip_html(raw: str) -> str:
    t = (raw or "").strip()
    if not t:
        return ""
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def read_grouped(path: Path) -> list[dict]:
    from app.services.oc_classificacao import classificar_tipo_despesa

    groups: OrderedDict[str, dict] = OrderedDict()
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=";")
        if not reader.fieldnames:
            raise SystemExit(f"CSV sem cabeçalho: {path}")
        for i, row in enumerate(reader, start=2):
            codigo_origem = _s(row, "Nº Ordem de Compra")
            if not codigo_origem:
                print(f"Aviso linha {i}: sem Nº Ordem de Compra — ignorada", file=sys.stderr)
                continue

            item_nome = _clean_ref(_s(row, "Nome do Item"))
            linha = {
                "id": str(uuid.uuid4()),
                "nome": item_nome,
                "quantidade": _f(_s(row, "Qtd"), 1.0) or 1.0,
                "preco_unit": _f(_s(row, "Lista de Preços")),
                "desconto": _f(_s(row, "Desconto")),
                "comentario": _strip_html(_s(row, "Comentário do Item", "Descrição")),
                "artigo_id": None,
                "artigo_nome": "",
            }

            if codigo_origem not in groups:
                tipo_compra = _s(row, "Tipo Compra")
                fornecedor_nome = _clean_ref(_s(row, "Fornecedor"))
                fatura_paga = _f(_s(row, "Fatura Paga"))
                total = _f(_s(row, "Total"))
                estado = _estado(_s(row, "Estado"))
                rastreio = _s(row, "Nº Rastreio")
                req = _s(row, "Nº Requisição")
                bits = []
                if rastreio:
                    bits.append(f"Rastreio: {rastreio}")
                if req:
                    bits.append(f"Requisição: {req}")
                notas = _s(row, "Prazos & Condições")
                if bits:
                    notas = (notas + ("\n" if notas else "") + " · ".join(bits)).strip()
                groups[codigo_origem] = {
                    "id": str(uuid.uuid4()),
                    "codigo_origem": codigo_origem,
                    "assunto": _s(row, "Assunto"),
                    "fornecedor_id": None,
                    "fornecedor_nome": fornecedor_nome,
                    "tipo_compra": tipo_compra,
                    "tipo_despesa": "despesa_diversa",  # preenchido no fim
                    "estado": estado,
                    "data": _parse_date(_s(row, "Data Criação")) or _parse_date(_s(row, "Data Pagamento")),
                    "vencimento": _parse_date(_s(row, "Vencimento")),
                    "data_pagamento": _parse_date(_s(row, "Data Pagamento")),
                    "subtotal": _f(_s(row, "Sub Total")),
                    "total": total,
                    "valor_pago": fatura_paga if fatura_paga else (total if estado == "recebida" else 0.0),
                    "desconto_percentual": _f(_s(row, "Desconto Percentual")),
                    "valor_desconto": _f(_s(row, "Valor Desconto")),
                    "valor_taxa": _f(_s(row, "Valor Taxa")),
                    "moeda": "EUR",
                    "responsavel": _s(row, "Responsável"),
                    "tipologia": _s(row, "Tipologia"),
                    "transportadora": _s(row, "Transportadora"),
                    "notas": notas,
                    "linhas": [],
                    "created_at": _parse_created_at(_s(row, "Data Criação")),
                }

            if item_nome or linha["preco_unit"] or abs(linha["quantidade"] - 1.0) > 1e-9:
                groups[codigo_origem]["linhas"].append(linha)

    docs = list(groups.values())
    for d in docs:
        d["tipo_despesa"] = classificar_tipo_despesa(
            tipo_compra=d.get("tipo_compra") or "",
            assunto=d.get("assunto") or "",
            fornecedor_nome=d.get("fornecedor_nome") or "",
            itens=[l.get("nome") or "" for l in (d.get("linhas") or [])],
            tipologia=d.get("tipologia") or "",
        )
    return docs


def _stats(docs: list[dict]) -> dict:
    from collections import Counter
    return {
        "total_ocs": len(docs),
        "com_fornecedor": sum(1 for d in docs if d.get("fornecedor_nome")),
        "sem_fornecedor": sum(1 for d in docs if not d.get("fornecedor_nome")),
        "por_tipo_despesa": dict(Counter(d.get("tipo_despesa") for d in docs)),
        "por_tipo_compra": dict(Counter(d.get("tipo_compra") or "(vazio)" for d in docs)),
        "por_estado": dict(Counter(d.get("estado") for d in docs)),
        "linhas_totais": sum(len(d.get("linhas") or []) for d in docs),
        "total_valor": round(sum(d.get("total") or 0 for d in docs), 2),
    }


async def _match_fornecedores(docs: list[dict]) -> int:
    from app.core.database import db

    fornecedores = await db["fornecedores"].find({}, {"_id": 0, "id": 1, "nome": 1}).to_list(5000)
    by_nome = {((f.get("nome") or "").strip().lower()): f for f in fornecedores if f.get("nome")}
    matched = 0
    for d in docs:
        nome = (d.get("fornecedor_nome") or "").strip()
        if not nome:
            continue
        f = by_nome.get(nome.lower())
        if f:
            d["fornecedor_id"] = f["id"]
            d["fornecedor_nome"] = f.get("nome") or nome
            matched += 1
    return matched


async def run(*, csv_path: Path, reset: bool, dry_run: bool) -> dict:
    docs = read_grouped(csv_path)
    docs = sorted(docs, key=lambda d: (d.get("created_at") or "", d.get("codigo_origem") or ""))
    seq_por_ano: dict[str, int] = {}
    for d in docs:
        year = (d.get("data") or d.get("created_at") or "")[:4] or "0000"
        seq_por_ano[year] = seq_por_ano.get(year, 0) + 1
        d["codigo"] = f"OC-{year}-{seq_por_ano[year]:04d}"

    if dry_run:
        # Match preview without write: load fornecedores if env allows
        matched = 0
        try:
            from app.core.database import db, client
            matched = await _match_fornecedores(docs)
            client.close()
        except Exception as e:
            print(f"Aviso: não foi possível ligar fornecedores em dry-run: {e}", file=sys.stderr)

        stats = _stats(docs)
        stats["fornecedores_ligados"] = matched
        sample = []
        for d in docs[:3]:
            sample.append({
                "codigo": d["codigo"],
                "codigo_origem": d["codigo_origem"],
                "assunto": d["assunto"],
                "fornecedor_nome": d["fornecedor_nome"],
                "tipo_compra": d["tipo_compra"],
                "tipo_despesa": d["tipo_despesa"],
                "estado": d["estado"],
                "total": d["total"],
                "n_linhas": len(d["linhas"]),
            })
        return {
            "dry_run": True,
            "csv": str(csv_path),
            "stats": stats,
            "sample": sample,
            "reset_would": list(RESET_COLLECTIONS) if reset else [],
        }

    from app.core.database import db, client

    matched = await _match_fornecedores(docs)
    stats = _stats(docs)
    stats["fornecedores_ligados"] = matched

    wiped = {}
    if reset:
        for name in RESET_COLLECTIONS:
            res = await db[name].delete_many({})
            wiped[name] = res.deleted_count
            print(f"Limpeza {name}: {res.deleted_count}")

    if docs:
        await db["ordens_compra"].insert_many(docs)
        await db.counters.delete_one({"_id": "OC"})
        for year, seq in seq_por_ano.items():
            if year == "0000":
                continue
            await db.counters.update_one({"_id": f"OC-{year}"}, {"$set": {"seq": seq}}, upsert=True)

    # Indexes
    await db["ordens_compra"].create_index("codigo", unique=True, sparse=True)
    await db["ordens_compra"].create_index("codigo_origem")
    await db["ordens_compra"].create_index("fornecedor_id")
    await db["ordens_compra"].create_index("tipo_despesa")
    await db["ordens_compra"].create_index([("data", -1)])

    count = await db["ordens_compra"].count_documents({})
    client.close()
    return {
        "dry_run": False,
        "csv": str(csv_path),
        "inserted": len(docs),
        "ordens_na_bd": count,
        "wiped": wiped,
        "stats": stats,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Importa Ordens_de_Compra.csv")
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--reset-ordens-compra", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    _load_dotenv()
    if args.env_file:
        _load_dotenv(args.env_file)

    if not args.csv.exists():
        raise SystemExit(f"CSV não encontrado: {args.csv}")

    result = asyncio.run(run(csv_path=args.csv, reset=args.reset_ordens_compra, dry_run=args.dry_run))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
