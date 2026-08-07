#!/usr/bin/env python3
"""Importa produtos a partir de data/Produtos.csv para a coleção artigos.

Cria/substitui categorias e subcategorias a partir do CSV, mapeia preços para
custo_artigo + margem, e associa fornecedores existentes pelo nome.

Uso (a partir da pasta backend/, com o venv ativo):

  python scripts/import_produtos_csv.py --dry-run
  python scripts/import_produtos_csv.py --reset-artigos
  python scripts/import_produtos_csv.py --env-file ../.env.shared --reset-artigos
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

DEFAULT_CSV = REPO_ROOT / "data" / "Produtos.csv"
RESET_COLLECTIONS = ("artigos", "categorias", "subcategorias")

UNIT_MAP = {
    "each": "un",
    "m": "m",
    "minuto": "un",
    "sq ft": "m²",
    "sqft": "m²",
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


def _parse_float(raw: str, default: float = 0.0) -> float:
    t = (raw or "").strip().replace("'", "").replace(" ", "").replace(",", ".")
    if not t:
        return default
    try:
        return float(t)
    except ValueError:
        return default


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


def _normalize_unidade(raw: str) -> str:
    key = (raw or "").strip().lower()
    return UNIT_MAP.get(key, "un")


def _clean_fornecedor(raw: str) -> str:
    t = (raw or "").strip()
    if t.startswith("Vendors::::"):
        t = t.split("::::", 1)[1].strip()
    return t


def _descricao(row: dict) -> str:
    desc = _s(row, "Descrição")
    detalhe = _s(row, "Detalhe ", "Detalhe")
    if desc and detalhe and desc != detalhe:
        return f"{desc}\n\n{detalhe}"
    return detalhe or desc


def _custo_e_margem(preco_unit: float, preco_custo: float) -> tuple[float, float]:
    """Adapta Preço Custo / Preço Unitário ao modelo custo_artigo + margem.

    - Ambos > 0 → custo = custo CRM; margem = (unitário/custo − 1) × 100
    - Só custo → margem default 30%
    - Só unitário → custo = unitário, margem 0% (preço de catálogo preservado)
    - Nenhum → custo 0, margem 30%
    """
    if preco_custo > 0 and preco_unit > 0:
        return preco_custo, round((preco_unit / preco_custo - 1.0) * 100.0, 2)
    if preco_custo > 0:
        return preco_custo, 30.0
    if preco_unit > 0:
        return preco_unit, 0.0
    return 0.0, 30.0


def map_row(row: dict) -> dict:
    nome = _s(row, "Nome Produto")
    if not nome:
        raise ValueError("linha sem Nome Produto")
    codigo_origem = _s(row, "Nº Produto", "Cód. Produto")

    preco_unit = _parse_float(_s(row, "Preço Unitário"))
    preco_custo = _parse_float(_s(row, "Preço Custo"))
    custo, margem = _custo_e_margem(preco_unit, preco_custo)

    ativo_raw = _s(row, "Produto Ativo")
    ativo = ativo_raw in ("", "1", "true", "True", "sim", "Sim", "yes", "Yes")

    return {
        "codigo_origem": codigo_origem,
        "nome": nome,
        "descricao": _descricao(row),
        "unidade": _normalize_unidade(_s(row, "Unidade Utilizada")),
        "imagem": _s(row, "Imagem Produto"),
        "categoria_nome": _s(row, "Categoria de Produto") or "Outros",
        "subcategoria_nome": _s(row, "Sub Categoria") or "Diversos",
        "custo_artigo": custo,
        "margem": margem,
        "ativo": ativo,
        "fabricante": _s(row, "Fabricante"),
        "cod_fabricante": _s(row, "Cód. Fabricante"),
        "fornecedor_nome": _clean_fornecedor(_s(row, "Fornecedor")),
        "cod_fornecedor": _s(row, "Cód. Fornecedor"),
        "website": _s(row, "Website"),
        "comprimento_mm": _parse_float(_s(row, "Comprimento (mm)")),
        "largura_mm": _parse_float(_s(row, "Largura (mm)")),
        "espessura_mm": _parse_float(_s(row, "Espessura (mm)")),
        "responsavel": _s(row, "Responsável"),
        "materiais": [],
        "roteiro": [],
        "created_at": _parse_created_at(_s(row, "Data Criação")),
        # metadados só para stats do dry-run
        "_preco_unitario_csv": preco_unit,
        "_preco_custo_csv": preco_custo,
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
        "categorias": len({d["categoria_nome"] for d in docs}),
        "subcategorias": len({(d["categoria_nome"], d["subcategoria_nome"]) for d in docs}),
        "com_custo_csv": sum(1 for d in docs if d.get("_preco_custo_csv")),
        "com_preco_unit_csv": sum(1 for d in docs if d.get("_preco_unitario_csv")),
        "com_fornecedor": sum(1 for d in docs if d.get("fornecedor_nome")),
        "com_imagem": sum(1 for d in docs if d.get("imagem")),
        "unidades": sorted({d["unidade"] for d in docs}),
    }


async def _ensure_counters(n_cats: int, n_subs: int, n_artigos: int = 0) -> None:
    """Garante que counters CAT/SUB/ART ficam acima dos códigos gerados."""
    from app.core.database import db

    for counter_id, n in (("CAT", n_cats), ("SUB", n_subs), ("ART", n_artigos)):
        if n <= 0:
            continue
        existing = await db.counters.find_one({"_id": counter_id})
        current = int((existing or {}).get("seq") or 0)
        if current < n:
            await db.counters.update_one(
                {"_id": counter_id},
                {"$set": {"seq": n}},
                upsert=True,
            )


async def run(*, csv_path: Path, reset: bool, dry_run: bool) -> dict:
    mapped = read_csv(csv_path)
    stats = _stats(mapped)

    if dry_run:
        sample_keys = (
            "codigo_origem", "nome", "unidade", "categoria_nome", "subcategoria_nome",
            "custo_artigo", "margem", "fabricante", "fornecedor_nome", "created_at",
        )
        sample = [{k: mapped[0][k] for k in sample_keys}] if mapped else []
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

    # Índice de fornecedores por nome (casefold)
    fornecedores = await db.fornecedores.find({}, {"_id": 0, "id": 1, "nome": 1}).to_list(5000)
    fornecedor_by_nome = {(f.get("nome") or "").strip().casefold(): f for f in fornecedores if f.get("nome")}

    # Categorias / subcategorias
    cat_order: list[str] = []
    seen_cats: set[str] = set()
    for d in mapped:
        cn = d["categoria_nome"]
        if cn not in seen_cats:
            seen_cats.add(cn)
            cat_order.append(cn)

    cat_docs = []
    cat_id_by_nome: dict[str, str] = {}
    for i, nome in enumerate(cat_order, start=1):
        cid = str(uuid.uuid4())
        cat_id_by_nome[nome] = cid
        cat_docs.append({
            "id": cid,
            "codigo": f"CAT-{i:04d}",
            "nome": nome,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    sub_keys: list[tuple[str, str]] = []
    seen_subs: set[tuple[str, str]] = set()
    for d in mapped:
        key = (d["categoria_nome"], d["subcategoria_nome"])
        if key not in seen_subs:
            seen_subs.add(key)
            sub_keys.append(key)

    sub_docs = []
    sub_id_by_key: dict[tuple[str, str], str] = {}
    for i, (cat_nome, sub_nome) in enumerate(sub_keys, start=1):
        sid = str(uuid.uuid4())
        sub_id_by_key[(cat_nome, sub_nome)] = sid
        sub_docs.append({
            "id": sid,
            "codigo": f"SUB-{i:04d}",
            "nome": sub_nome,
            "categoria_id": cat_id_by_nome[cat_nome],
            "categoria_nome": cat_nome,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    artigo_docs = []
    matched_fornecedor = 0
    # Ordenar por data CRM para códigos ART estáveis; prefixo do software (ART-0001…)
    mapped_sorted = sorted(mapped, key=lambda d: (d.get("created_at") or "", d.get("nome") or ""))
    for i, d in enumerate(mapped_sorted, start=1):
        cat_nome = d["categoria_nome"]
        sub_nome = d["subcategoria_nome"]
        fornecedor_nome = d.get("fornecedor_nome") or ""
        fornecedor_id = None
        if fornecedor_nome:
            hit = fornecedor_by_nome.get(fornecedor_nome.casefold())
            if hit:
                fornecedor_id = hit["id"]
                matched_fornecedor += 1

        doc = {
            "id": str(uuid.uuid4()),
            "codigo": f"ART-{i:04d}",
            "codigo_origem": d.get("codigo_origem") or "",
            "nome": d["nome"],
            "descricao": d["descricao"],
            "unidade": d["unidade"],
            "imagem": d["imagem"],
            "categoria_id": cat_id_by_nome[cat_nome],
            "categoria_nome": cat_nome,
            "subcategoria_id": sub_id_by_key[(cat_nome, sub_nome)],
            "subcategoria_nome": sub_nome,
            "custo_artigo": d["custo_artigo"],
            "margem": d["margem"],
            "ativo": d["ativo"],
            "fabricante": d["fabricante"],
            "cod_fabricante": d["cod_fabricante"],
            "fornecedor_id": fornecedor_id,
            "fornecedor_nome": fornecedor_nome,
            "cod_fornecedor": d["cod_fornecedor"],
            "website": d["website"],
            "comprimento_mm": d["comprimento_mm"],
            "largura_mm": d["largura_mm"],
            "espessura_mm": d["espessura_mm"],
            "responsavel": d["responsavel"],
            "materiais": [],
            "roteiro": [],
            "created_at": d["created_at"],
        }
        artigo_docs.append(doc)

    if cat_docs:
        await db.categorias.insert_many(cat_docs)
    if sub_docs:
        await db.subcategorias.insert_many(sub_docs)
    if artigo_docs:
        await db.artigos.insert_many(artigo_docs)

    await _ensure_counters(len(cat_docs), len(sub_docs), len(artigo_docs))

    counts = {
        "artigos": await db.artigos.count_documents({}),
        "categorias": await db.categorias.count_documents({}),
        "subcategorias": await db.subcategorias.count_documents({}),
    }
    client.close()
    return {
        "dry_run": False,
        "csv": str(csv_path),
        "inserted_artigos": len(artigo_docs),
        "inserted_categorias": len(cat_docs),
        "inserted_subcategorias": len(sub_docs),
        "fornecedores_associados": matched_fornecedor,
        "na_bd": counts,
        "wiped": wiped,
        "stats": stats,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa produtos do CSV CRM para artigos.")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help=f"Caminho do CSV (default: {DEFAULT_CSV})")
    parser.add_argument(
        "--reset-artigos",
        action="store_true",
        help="Apaga artigos + categorias + subcategorias antes de importar",
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

    result = asyncio.run(run(csv_path=csv_path, reset=args.reset_artigos, dry_run=args.dry_run))
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    if args.dry_run:
        print("\nDry-run — nada foi escrito.")
    else:
        print(
            f"\nOK — {result['inserted_artigos']} artigos, "
            f"{result['inserted_categorias']} categorias, "
            f"{result['inserted_subcategorias']} subcategorias "
            f"(BD artigos: {result['na_bd']['artigos']})."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
