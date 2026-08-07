#!/usr/bin/env python3
"""Importa encomendas a partir de Encomendas.csv + Fa_Proforma.csv.

Cruza proformas → encomendas por assunto+cliente (e data se houver empate),
preenche artigos/valores/pagamentos e cria documentos financeiros (proforma).

Uso (a partir de backend/, com venv):

  python scripts/import_encomendas_csv.py --dry-run
  python scripts/import_encomendas_csv.py --env-file ../.env.shared --reset-encomendas
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
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.chdir(BACKEND_ROOT)

DEFAULT_ENC_CSV = REPO_ROOT / "data" / "Encomendas.csv"
DEFAULT_PRO_CSV = REPO_ROOT / "data" / "Fa_Proforma.csv"

RESET_COLLECTIONS = ("encomendas", "ordens_fabrico", "documentos_financeiros")

ESTADO_MAP = {
    "closed": "concluida",
    "cancelada": "cancelada",
    "cancelled": "cancelada",
    "canceled": "cancelada",
    "open": "aberta",
    "in progress": "em_producao",
    "preparar desenho": "em_producao",
}

DOC_ESTADO_MAP = {
    "finalizada": "emitida",
    "paid": "emitida",
    "sent": "emitida",
    "autocreated": "emitida",
    "cancel": "anulada",
    "cancelled": "anulada",
    "canceled": "anulada",
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


def _f(raw: str, default: float | None = 0.0):
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
    part = raw.split()[0]
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(part, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _parse_dt_obj(raw: str):
    iso = _parse_date(raw)
    if not iso:
        return None
    return datetime.strptime(iso, "%Y-%m-%d").date()


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


def _strip_html(raw: str) -> str:
    t = (raw or "").strip()
    if not t:
        return ""
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def read_encomendas(path: Path) -> list[dict]:
    docs = []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=";")
        for i, row in enumerate(reader, start=2):
            num = _s(row, "Nº. Encomenda")
            if not num:
                print(f"Aviso Encomendas L{i}: sem número — ignorada", file=sys.stderr)
                continue
            assunto = _s(row, "Assunto")
            descricao = _s(row, "Descrição")
            solucao = _s(row, "Solução")
            tipologia = _s(row, "Tipologia")
            tipo_entrega = _s(row, "Tipo de Entrega")
            responsavel = _s(row, "Responsável")
            notes = []
            if tipologia:
                notes.append(f"Tipologia: {tipologia}")
            if tipo_entrega:
                notes.append(f"Entrega: {tipo_entrega}")
            if responsavel:
                notes.append(f"Responsável CRM: {responsavel}")
            if solucao:
                notes.append(solucao)
            desc_parts = [p for p in (assunto, descricao) if p]
            docs.append({
                "codigo_origem": num,
                "assunto": assunto,
                "cliente_nome": _clean_ref(_s(row, "Cliente")),
                "estado_crm": _s(row, "Estado"),
                "estado": ESTADO_MAP.get(_s(row, "Estado").lower(), "aberta"),
                "data": _parse_date(_s(row, "Data Criação")),
                "prazo_entrega": _parse_date(_s(row, "Data Entrega")),
                "descricao": " — ".join(desc_parts),
                "notas": "\n".join(notes),
                "created_at": _parse_created_at(_s(row, "Data Criação")),
                "data_obj": _parse_dt_obj(_s(row, "Data Criação")),
                "tipologia": tipologia,
                "tipo_entrega": tipo_entrega,
            })
    return docs


def read_proformas(path: Path) -> list[dict]:
    groups = {}
    order = []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=";")
        for i, row in enumerate(reader, start=2):
            pn = _s(row, "Proforma Nº.")
            if not pn:
                print(f"Aviso Proforma L{i}: sem número — ignorada", file=sys.stderr)
                continue
            if pn not in groups:
                order.append(pn)
                groups[pn] = {
                    "codigo_origem": pn,
                    "assunto": _s(row, "Assunto"),
                    "cliente_nome": _clean_ref(_s(row, "Nome Cliente")),
                    "enc_ref": _clean_ref(_s(row, "Encomenda")),
                    "estado_crm": _s(row, "Estado"),
                    "estado": DOC_ESTADO_MAP.get(_s(row, "Estado").lower(), "emitida"),
                    "total": _f(_s(row, "Total")) or 0.0,
                    "subtotal": _f(_s(row, "Sub Total")) or 0.0,
                    "recebido": _f(_s(row, "Recebido")) or 0.0,
                    "data": _parse_date(_s(row, "Data da Proforma")) or _parse_date(_s(row, "Data Criação")),
                    "data_obj": _parse_dt_obj(_s(row, "Data da Proforma")) or _parse_dt_obj(_s(row, "Data Criação")),
                    "data_pagamento": _parse_date(_s(row, "Data Pagamento")),
                    "tipologia": _s(row, "Tipologia"),
                    "created_at": _parse_created_at(_s(row, "Data Criação")),
                    "linhas": [],
                }
            item = _clean_ref(_s(row, "Nome do Item"))
            preco = _f(_s(row, "Lista de Preço"), None)
            qtd = _f(_s(row, "Qtd"), 1.0) or 1.0
            if item or (preco is not None and preco != 0):
                groups[pn]["linhas"].append({
                    "nome": item or "Item",
                    "quantidade": qtd,
                    "preco_unit": preco or 0.0,
                    "desconto": _f(_s(row, "Desconto")) or 0.0,
                    "comentario": _strip_html(_s(row, "Comentário do Item", "Descrição")),
                })
    return [groups[k] for k in order]


def match_proforma_to_encomenda(pros: list[dict], encs: list[dict]) -> tuple[dict, dict]:
    """Devolve (pro_num → enc_codigo_origem, stats)."""
    by_ac = defaultdict(list)
    for e in encs:
        by_ac[(e["assunto"].lower(), e["cliente_nome"].lower())].append(e)

    match: dict[str, str] = {}
    ambiguous = 0
    miss = 0

    for p in pros:
        # Skip caixa/agregados óbvios
        if (p["assunto"] or "").lower().startswith("entradas ") and not p["enc_ref"]:
            miss += 1
            continue

        cands = by_ac.get((p["assunto"].lower(), p["cliente_nome"].lower()), [])
        if not cands and p["enc_ref"]:
            cands = by_ac.get((p["enc_ref"].lower(), p["cliente_nome"].lower()), [])

        # Assunto da proforma às vezes começa por "ENC0026 …"
        if not cands:
            m = re.match(r"^(ENC\d+)\b", p["assunto"], re.I)
            if m:
                cod = m.group(1).upper()
                hit = next((e for e in encs if e["codigo_origem"].upper() == cod), None)
                if hit:
                    match[p["codigo_origem"]] = hit["codigo_origem"]
                    continue

        if not cands:
            miss += 1
            continue
        if len(cands) == 1:
            match[p["codigo_origem"]] = cands[0]["codigo_origem"]
            continue

        if not p["data_obj"]:
            ambiguous += 1
            continue
        ranked = sorted(
            cands,
            key=lambda e: (
                abs((e["data_obj"] - p["data_obj"]).days) if e.get("data_obj") else 9999,
                e["codigo_origem"],
            ),
        )
        d0 = abs((ranked[0]["data_obj"] - p["data_obj"]).days) if ranked[0].get("data_obj") else 9999
        d1 = abs((ranked[1]["data_obj"] - p["data_obj"]).days) if ranked[1].get("data_obj") else 9999
        if d0 <= 2 and d0 < d1:
            match[p["codigo_origem"]] = ranked[0]["codigo_origem"]
        else:
            ambiguous += 1

    stats = {
        "proformas": len(pros),
        "matched": len(match),
        "ambiguous": ambiguous,
        "miss": miss,
    }
    return match, stats


def build_docs(
    encs: list[dict],
    pros: list[dict],
    match: dict[str, str],
    clientes_by_nome: dict[str, dict],
    artigos_by_nome: dict[str, dict],
) -> tuple[list[dict], list[dict], dict]:
    pros_by_enc = defaultdict(list)
    for p in pros:
        eid = match.get(p["codigo_origem"])
        if eid:
            pros_by_enc[eid].append(p)

    enc_docs = []
    doc_docs = []
    seq_enc: dict[str, int] = {}
    seq_pro: dict[str, int] = {}

    encs_sorted = sorted(encs, key=lambda e: (e.get("created_at") or "", e.get("codigo_origem") or ""))
    for e in encs_sorted:
        year = (e.get("data") or e.get("created_at") or "")[:4] or "0000"
        seq_enc[year] = seq_enc.get(year, 0) + 1
        numero = f"ENC-{year}-{seq_enc[year]:04d}"
        enc_id = str(uuid.uuid4())

        cli = clientes_by_nome.get((e["cliente_nome"] or "").lower())
        cliente_id = cli["id"] if cli else None
        cliente_nome = (cli["nome"] if cli else None) or e["cliente_nome"] or "Cliente"

        linked = pros_by_enc.get(e["codigo_origem"], [])
        # Preferir proforma Finalizada/Paid com maior total; senão a primeira
        linked_sorted = sorted(
            linked,
            key=lambda p: (
                0 if p["estado"] == "emitida" else 1,
                -(p.get("total") or 0),
                p.get("data") or "",
            ),
        )
        primary = linked_sorted[0] if linked_sorted else None

        artigos = []
        valor_total = None
        valor_pago = 0.0
        pagamentos = []
        proforma_nums = []

        if primary:
            valor_total = round(primary.get("total") or 0.0, 2)
            valor_pago = round(primary.get("recebido") or 0.0, 2)
            for ln in primary.get("linhas") or []:
                art = artigos_by_nome.get((ln["nome"] or "").lower())
                artigos.append({
                    "id": str(uuid.uuid4()),
                    "artigo_id": art["id"] if art else None,
                    "artigo_nome": (art["nome"] if art else None) or ln["nome"],
                    "imagem": "",
                    "quantidade": ln["quantidade"],
                    "preco_unit": ln["preco_unit"],
                    "desconto": ln.get("desconto") or 0.0,
                    "desconto_tipo": "eur",
                    "personalizacoes": [],
                })
            if valor_pago > 0:
                pagamentos.append({
                    "id": str(uuid.uuid4()),
                    "recibo_numero": "",
                    "data": primary.get("data_pagamento") or primary.get("data") or e.get("data"),
                    "valor": valor_pago,
                    "metodo": "transferencia",
                    "nota": f"Importado da proforma {primary['codigo_origem']}",
                    "created_at": primary.get("created_at") or e.get("created_at"),
                })

        notas = e.get("notas") or ""
        if linked:
            proforma_nums = [p["codigo_origem"] for p in linked_sorted]
            extra = "Proforma(s): " + ", ".join(proforma_nums)
            notas = (notas + ("\n" if notas else "") + extra).strip()

        enc_docs.append({
            "id": enc_id,
            "numero": numero,
            "codigo_origem": e["codigo_origem"],
            "cliente": cliente_nome,
            "cliente_id": cliente_id,
            "descricao": e.get("descricao") or e.get("assunto") or "",
            "data": e.get("data") or None,
            "prazo_entrega": e.get("prazo_entrega") or None,
            "estado": e["estado"],
            "notas": notas,
            "desconto_total": 0.0,
            "desconto_total_tipo": "pct",
            "artigos": artigos,
            "imagens": [],
            "pagamentos": pagamentos,
            "valor_total": valor_total,
            "valor_total_manual": valor_total is not None,
            "valor_pago": valor_pago,
            "autorizada_producao": bool(valor_pago and valor_total and valor_pago + 0.01 >= valor_total),
            "orcamento_id": None,
            "orcamento_numero": None,
            "created_at": e.get("created_at"),
            "_proformas": linked_sorted,
        })

        # Documentos financeiros (todas as proformas ligadas)
        for p in linked_sorted:
            year_p = (p.get("data") or p.get("created_at") or "")[:4] or year
            seq_pro[year_p] = seq_pro.get(year_p, 0) + 1
            doc_numero = f"FP-{year_p}-{seq_pro[year_p]:04d}"
            linhas = []
            for ln in p.get("linhas") or []:
                art = artigos_by_nome.get((ln["nome"] or "").lower())
                qty = ln["quantidade"]
                pu = ln["preco_unit"]
                desc = ln.get("desconto") or 0.0
                sub = round(qty * pu - desc, 2)
                linhas.append({
                    "artigo_id": art["id"] if art else None,
                    "encomenda_artigo_id": None,
                    "descricao": (art["nome"] if art else None) or ln["nome"],
                    "quantidade": qty,
                    "preco_unit": pu,
                    "desconto": desc,
                    "desconto_tipo": "eur",
                    "personalizacoes": [],
                    "subtotal": sub,
                })
            doc_docs.append({
                "id": str(uuid.uuid4()),
                "tipo": "proforma",
                "numero": doc_numero,
                "codigo_origem": p["codigo_origem"],
                "cliente": cliente_nome,
                "cliente_id": cliente_id,
                "encomenda_id": enc_id,
                "encomenda_numero": numero,
                "fatura_id": None,
                "fatura_numero": None,
                "data": p.get("data") or None,
                "linhas": linhas,
                "subtotal": round(p.get("subtotal") or 0.0, 2),
                "desconto_total": 0.0,
                "iva_taxa": 0.0,
                "iva_valor": 0.0,
                "total": round(p.get("total") or 0.0, 2),
                "valor_pago": round(p.get("recebido") or 0.0, 2),
                "metodo_pagamento": "",
                "notas": f"Importado CRM {p['codigo_origem']}" + (f" · {p['assunto']}" if p.get("assunto") else ""),
                "estado": p["estado"],
                "created_at": p.get("created_at"),
            })

    # Limpar campo interno
    for d in enc_docs:
        d.pop("_proformas", None)

    stats = {
        "encomendas": len(enc_docs),
        "com_proforma": sum(1 for d in enc_docs if d.get("valor_total_manual")),
        "sem_proforma": sum(1 for d in enc_docs if not d.get("valor_total_manual")),
        "com_cliente_id": sum(1 for d in enc_docs if d.get("cliente_id")),
        "artigos_linhas": sum(len(d.get("artigos") or []) for d in enc_docs),
        "documentos_proforma": len(doc_docs),
        "valor_total_sum": round(sum(d.get("valor_total") or 0 for d in enc_docs), 2),
        "valor_pago_sum": round(sum(d.get("valor_pago") or 0 for d in enc_docs), 2),
        "por_estado": dict(Counter(d["estado"] for d in enc_docs)),
        "seq_enc_por_ano": dict(seq_enc),
        "seq_pro_por_ano": dict(seq_pro),
    }
    return enc_docs, doc_docs, stats


async def load_lookups():
    from app.core.database import db
    clientes = await db["clientes"].find({}, {"_id": 0, "id": 1, "nome": 1}).to_list(10000)
    artigos = await db["artigos"].find({}, {"_id": 0, "id": 1, "nome": 1}).to_list(10000)
    by_cli = {(c.get("nome") or "").strip().lower(): c for c in clientes if c.get("nome")}
    by_art = {(a.get("nome") or "").strip().lower(): a for a in artigos if a.get("nome")}
    return by_cli, by_art


async def run(*, enc_csv: Path, pro_csv: Path, reset: bool, dry_run: bool) -> dict:
    encs = read_encomendas(enc_csv)
    pros = read_proformas(pro_csv)
    match, match_stats = match_proforma_to_encomenda(pros, encs)

    if dry_run:
        # Try lookups if DB available
        try:
            from app.core.database import client
            by_cli, by_art = await load_lookups()
            client.close()
        except Exception as e:
            print(f"Aviso dry-run sem BD: {e}", file=sys.stderr)
            by_cli, by_art = {}, {}
        enc_docs, doc_docs, stats = build_docs(encs, pros, match, by_cli, by_art)
        sample = []
        for d in enc_docs[:5]:
            sample.append({
                "numero": d["numero"],
                "codigo_origem": d["codigo_origem"],
                "cliente": d["cliente"],
                "estado": d["estado"],
                "valor_total": d["valor_total"],
                "valor_pago": d["valor_pago"],
                "n_artigos": len(d["artigos"]),
            })
        return {
            "dry_run": True,
            "match": match_stats,
            "stats": stats,
            "sample": sample,
            "reset_would": list(RESET_COLLECTIONS) if reset else [],
        }

    from app.core.database import db, client

    by_cli, by_art = await load_lookups()
    enc_docs, doc_docs, stats = build_docs(encs, pros, match, by_cli, by_art)

    wiped = {}
    if reset:
        for name in RESET_COLLECTIONS:
            res = await db[name].delete_many({})
            wiped[name] = res.deleted_count
            print(f"Limpeza {name}: {res.deleted_count}")

    if enc_docs:
        await db["encomendas"].insert_many(enc_docs)
    if doc_docs:
        await db["documentos_financeiros"].insert_many(doc_docs)

    # Counters year-based
    await db.counters.delete_one({"_id": "ENC"})
    for year, seq in stats["seq_enc_por_ano"].items():
        if year != "0000":
            await db.counters.update_one({"_id": f"ENC-{year}"}, {"$set": {"seq": seq}}, upsert=True)
    # Ensure encomenda numeracao uses year
    num = await db.empresa_settings.find_one({"id": "numeracao"}) or {"id": "numeracao", "referencias": {}}
    refs = num.get("referencias") or {}
    refs["encomenda"] = {"prefix": "ENC", "incluir_ano": True, "digitos": 4}
    refs.setdefault("proforma", {"prefix": "FP", "incluir_ano": True, "digitos": 4})
    for year, seq in stats["seq_pro_por_ano"].items():
        if year != "0000":
            await db.counters.update_one({"_id": f"FP-{year}"}, {"$set": {"seq": seq}}, upsert=True)
    await db.empresa_settings.update_one({"id": "numeracao"}, {"$set": {"referencias": refs}}, upsert=True)

    # Indexes (ignore conflicts with índices já existentes)
    for col, keys, kwargs in (
        ("encomendas", [("numero", 1)], {"unique": True, "sparse": True, "name": "numero_unique"}),
        ("encomendas", [("codigo_origem", 1)], {"name": "codigo_origem_1"}),
        ("encomendas", [("cliente_id", 1)], {"name": "cliente_id_1"}),
        ("documentos_financeiros", [("numero", 1)], {"unique": True, "sparse": True, "name": "numero_unique"}),
        ("documentos_financeiros", [("encomenda_id", 1)], {"name": "encomenda_id_1"}),
    ):
        try:
            await db[col].create_index(keys, **kwargs)
        except Exception as e:
            print(f"Aviso índice {col}.{kwargs.get('name')}: {e}", file=sys.stderr)

    result = {
        "dry_run": False,
        "match": match_stats,
        "stats": stats,
        "wiped": wiped,
        "encomendas_na_bd": await db["encomendas"].count_documents({}),
        "docs_na_bd": await db["documentos_financeiros"].count_documents({}),
    }
    client.close()
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="Importa Encomendas.csv + Fa_Proforma.csv")
    ap.add_argument("--enc-csv", type=Path, default=DEFAULT_ENC_CSV)
    ap.add_argument("--pro-csv", type=Path, default=DEFAULT_PRO_CSV)
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--reset-encomendas", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    _load_dotenv()
    if args.env_file:
        _load_dotenv(args.env_file)

    if not args.enc_csv.exists():
        raise SystemExit(f"CSV encomendas não encontrado: {args.enc_csv}")
    if not args.pro_csv.exists():
        raise SystemExit(f"CSV proformas não encontrado: {args.pro_csv}")

    result = asyncio.run(run(
        enc_csv=args.enc_csv,
        pro_csv=args.pro_csv,
        reset=args.reset_encomendas,
        dry_run=args.dry_run,
    ))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
