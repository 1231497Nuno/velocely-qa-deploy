"""Exportação / importação Excel (.xlsx) — dados mestre + export de documentos."""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from app.core.database import new_id, now_iso
from app.repositories import (
    artigos_repo, categorias_repo, clientes_repo, consumiveis_repo,
    encomendas_repo, fornecedores_repo, mao_obra_repo, maquinas_repo, orcamentos_repo,
    ordens_repo, subcategorias_repo,
)
from app.services.numeracao import next_codigo

MAX_ROWS = 5000

# entity_key → módulo RBAC
ENTITY_PERM = {
    "clientes": "clientes",
    "fornecedores": "fornecedores",
    "artigos": "artigos",
    "materiais": "materiais",
    "maquinas": "maquinas",
    "mao_obra": "mao_obra",
    "categorias": "artigos",
    "subcategorias": "artigos",
    "orcamentos": "orcamentos",
    "encomendas": "encomendas",
    "ordens_fabrico": "ordens_fabrico",
}

IMPORTABLE = {
    "clientes", "artigos", "materiais", "maquinas", "mao_obra", "categorias", "subcategorias",
}

EXPORTABLE = set(ENTITY_PERM.keys())

# Folhas e colunas canónicas (ordem = cabeçalho Excel)
SHEETS: Dict[str, Dict[str, Any]] = {
    "clientes": {
        "title": "Clientes",
        "columns": [
            "codigo", "nome", "tipo", "morada", "codigo_postal", "cidade", "pais",
            "contacto", "email", "nif", "notas",
        ],
    },
    "fornecedores": {
        "title": "Fornecedores",
        "columns": [
            "codigo", "nome", "tipo", "morada", "codigo_postal", "cidade", "pais",
            "contacto", "email", "nif", "website", "categoria", "notas",
        ],
    },
    "artigos": {
        "title": "Artigos",
        "columns": [
            "codigo", "nome", "descricao", "unidade", "categoria", "subcategoria",
            "custo_artigo", "margem", "fabricante", "fornecedor", "cod_fornecedor",
        ],
    },
    "materiais": {
        "title": "Materiais",
        "columns": ["codigo", "nome", "unidade", "custo_unitario"],
    },
    "maquinas": {
        "title": "Maquinas",
        "columns": ["codigo", "nome", "custo_amortizacao_hora", "custo_energia_hora"],
    },
    "mao_obra": {
        "title": "Mao_de_obra",
        "columns": ["codigo", "nome", "custo_hora", "responsavel_personalizacoes"],
    },
    "categorias": {
        "title": "Categorias",
        "columns": ["codigo", "nome"],
    },
    "subcategorias": {
        "title": "Subcategorias",
        "columns": ["codigo", "nome", "categoria_codigo", "categoria"],
    },
    "orcamentos": {
        "title": "Orcamentos",
        "columns": [
            "numero", "cliente", "descricao", "numero_encomenda", "data", "validade",
            "status", "margem", "total", "notas",
        ],
    },
    "encomendas": {
        "title": "Encomendas",
        "columns": [
            "numero", "cliente", "descricao", "data", "prazo_entrega", "estado",
            "valor_total", "valor_pago", "orcamento_numero", "notas",
        ],
    },
    "ordens_fabrico": {
        "title": "Ordens_fabrico",
        "columns": [
            "numero", "cliente", "descricao", "data", "status", "prioritaria",
            "responsavel_nome", "encomenda_numero", "orcamento_numero", "notas",
        ],
    },
}

# Ao pedir "categorias" no hub, exporta também subcategorias
EXPORT_EXPAND = {
    "categorias": ["categorias", "subcategorias"],
}


def _cell(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "sim" if v else "nao"
    return v


def _parse_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v or "").strip().lower()
    return s in ("1", "true", "sim", "yes", "s", "y")


def _parse_float(v: Any, default: float = 0.0) -> float:
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _row_dict(headers: List[str], values: tuple) -> Dict[str, Any]:
    out = {}
    for i, h in enumerate(headers):
        key = (h or "").strip().lower()
        if not key:
            continue
        out[key] = values[i] if i < len(values) else None
    return out


async def _load_docs(entity: str, ids: Optional[List[str]] = None) -> List[dict]:
    repo_map = {
        "clientes": clientes_repo,
        "fornecedores": fornecedores_repo,
        "artigos": artigos_repo,
        "materiais": consumiveis_repo,
        "maquinas": maquinas_repo,
        "mao_obra": mao_obra_repo,
        "categorias": categorias_repo,
        "subcategorias": subcategorias_repo,
        "orcamentos": orcamentos_repo,
        "encomendas": encomendas_repo,
        "ordens_fabrico": ordens_repo,
    }
    repo = repo_map[entity]
    query: dict = {}
    if ids is not None:
        if not ids:
            return []
        query = {"id": {"$in": ids}}
    return await repo.find(query, sort=("created_at", 1), limit=MAX_ROWS)


def _doc_to_row(entity: str, doc: dict) -> List[Any]:
    cols = SHEETS[entity]["columns"]
    if entity == "clientes":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "tipo": doc.get("tipo") or ("empresa" if doc.get("nif") else "particular"),
            "morada": doc.get("morada"),
            "codigo_postal": doc.get("codigo_postal"),
            "cidade": doc.get("cidade"),
            "pais": doc.get("pais"),
            "contacto": doc.get("contacto"),
            "email": doc.get("email"),
            "nif": doc.get("nif"),
            "notas": doc.get("notas"),
        }
    elif entity == "fornecedores":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "tipo": doc.get("tipo") or ("empresa" if doc.get("nif") else "particular"),
            "morada": doc.get("morada"),
            "codigo_postal": doc.get("codigo_postal"),
            "cidade": doc.get("cidade"),
            "pais": doc.get("pais"),
            "contacto": doc.get("contacto"),
            "email": doc.get("email"),
            "nif": doc.get("nif"),
            "website": doc.get("website"),
            "categoria": doc.get("categoria"),
            "notas": doc.get("notas"),
        }
    elif entity == "artigos":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "descricao": doc.get("descricao"),
            "unidade": doc.get("unidade") or "un",
            "categoria": doc.get("categoria_nome"),
            "subcategoria": doc.get("subcategoria_nome"),
            "custo_artigo": doc.get("custo_artigo"),
            "margem": doc.get("margem"),
            "fabricante": doc.get("fabricante"),
            "fornecedor": doc.get("fornecedor_nome"),
            "cod_fornecedor": doc.get("cod_fornecedor"),
        }
    elif entity == "materiais":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "unidade": doc.get("unidade") or "un",
            "custo_unitario": doc.get("custo_unitario"),
        }
    elif entity == "maquinas":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "custo_amortizacao_hora": doc.get("custo_amortizacao_hora"),
            "custo_energia_hora": doc.get("custo_energia_hora"),
        }
    elif entity == "mao_obra":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "custo_hora": doc.get("custo_hora"),
            "responsavel_personalizacoes": doc.get("responsavel_personalizacoes"),
        }
    elif entity == "categorias":
        m = {"codigo": doc.get("codigo"), "nome": doc.get("nome")}
    elif entity == "subcategorias":
        m = {
            "codigo": doc.get("codigo"),
            "nome": doc.get("nome"),
            "categoria_codigo": "",  # preenchido abaixo se necessário
            "categoria": doc.get("categoria_nome"),
        }
    elif entity == "orcamentos":
        m = {
            "numero": doc.get("numero"),
            "cliente": doc.get("cliente"),
            "descricao": doc.get("descricao"),
            "numero_encomenda": doc.get("numero_encomenda"),
            "data": doc.get("data"),
            "validade": doc.get("validade"),
            "status": doc.get("status"),
            "margem": doc.get("margem"),
            "total": doc.get("total"),
            "notas": doc.get("notas"),
        }
    elif entity == "encomendas":
        m = {
            "numero": doc.get("numero"),
            "cliente": doc.get("cliente"),
            "descricao": doc.get("descricao"),
            "data": doc.get("data"),
            "prazo_entrega": doc.get("prazo_entrega"),
            "estado": doc.get("estado"),
            "valor_total": doc.get("valor_total"),
            "valor_pago": doc.get("valor_pago"),
            "orcamento_numero": doc.get("orcamento_numero"),
            "notas": doc.get("notas"),
        }
    elif entity == "ordens_fabrico":
        m = {
            "numero": doc.get("numero"),
            "cliente": doc.get("cliente"),
            "descricao": doc.get("descricao"),
            "data": doc.get("data"),
            "status": doc.get("status"),
            "prioritaria": doc.get("prioritaria"),
            "responsavel_nome": doc.get("responsavel_nome"),
            "encomenda_numero": doc.get("encomenda_numero"),
            "orcamento_numero": doc.get("orcamento_numero"),
            "notas": doc.get("notas"),
        }
    else:
        m = {}
    return [_cell(m.get(c)) for c in cols]


async def _enrich_subcategorias(docs: List[dict]) -> List[dict]:
    """Acrescenta categoria_codigo via lookup."""
    cats = {c["id"]: c for c in await categorias_repo.find(limit=MAX_ROWS)}
    for d in docs:
        cat = cats.get(d.get("categoria_id") or "")
        d["_categoria_codigo"] = (cat or {}).get("codigo") or ""
        if not d.get("categoria_nome") and cat:
            d["categoria_nome"] = cat.get("nome") or ""
    return docs


def _doc_to_row_sub(doc: dict) -> List[Any]:
    cols = SHEETS["subcategorias"]["columns"]
    m = {
        "codigo": doc.get("codigo"),
        "nome": doc.get("nome"),
        "categoria_codigo": doc.get("_categoria_codigo"),
        "categoria": doc.get("categoria_nome"),
    }
    return [_cell(m.get(c)) for c in cols]


def _style_header(ws, n_cols: int):
    bold = Font(bold=True)
    for col in range(1, n_cols + 1):
        cell = ws.cell(1, col)
        cell.font = bold
        ws.column_dimensions[get_column_letter(col)].width = 18


def _add_sheet(wb: Workbook, entity: str, rows: List[List[Any]], *, first: bool) -> None:
    meta = SHEETS[entity]
    title = meta["title"][:31]
    if first and wb.active.title == "Sheet":
        ws = wb.active
        ws.title = title
    else:
        ws = wb.create_sheet(title)
    cols = meta["columns"]
    ws.append(cols)
    _style_header(ws, len(cols))
    for row in rows:
        ws.append(row)


def _instructions_sheet(wb: Workbook, entities: List[str]) -> None:
    ws = wb.create_sheet("Instrucoes", 0)
    lines = [
        ["Velocely — Importação / Exportação Excel"],
        [""],
        ["Regras:"],
        ["- Não altere os nomes das colunas na primeira linha."],
        ["- Upsert por código: se o código existir, actualiza; se vazio, cria código novo."],
        ["- Máximo 5000 linhas por folha."],
        ["- Documentos (orçamentos, encomendas, OFs) são só para exportação."],
        [""],
        ["Folhas neste ficheiro:"],
    ]
    for e in entities:
        lines.append([SHEETS[e]["title"], ", ".join(SHEETS[e]["columns"])])
    for row in lines:
        ws.append(row)
    ws.column_dimensions["A"].width = 55
    ws.column_dimensions["B"].width = 80


async def build_export_xlsx(
    entities: List[str],
    ids_by_entity: Optional[Dict[str, List[str]]] = None,
) -> bytes:
    """Gera .xlsx com uma folha por entidade (expandindo categorias no export completo)."""
    expanded: List[str] = []
    for e in entities:
        e = (e or "").strip()
        if not e:
            continue
        if ids_by_entity is not None:
            # Lista com filtros: exportar exactamente a entidade pedida
            if e in SHEETS and e not in expanded:
                expanded.append(e)
        else:
            if e not in EXPORTABLE and e not in EXPORT_EXPAND:
                continue
            for x in EXPORT_EXPAND.get(e, [e]):
                if x in SHEETS and x not in expanded:
                    expanded.append(x)
    if not expanded:
        raise ValueError("Seleccione pelo menos uma entidade válida")

    wb = Workbook()
    first = True
    for entity in expanded:
        id_list = None
        if ids_by_entity is not None and entity in ids_by_entity:
            id_list = ids_by_entity[entity]
        docs = await _load_docs(entity, id_list)
        if entity == "subcategorias":
            docs = await _enrich_subcategorias(docs)
            rows = [_doc_to_row_sub(d) for d in docs]
        else:
            rows = [_doc_to_row(entity, d) for d in docs]
        _add_sheet(wb, entity, rows, first=first)
        first = False

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_template_xlsx(entity: str) -> bytes:
    if entity not in IMPORTABLE:
        raise ValueError("Entidade não suportada para importação")
    keys = EXPORT_EXPAND.get(entity, [entity])
    wb = Workbook()
    first = True
    for e in keys:
        _add_sheet(wb, e, [], first=first)
        first = False
    _instructions_sheet(wb, keys)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _resolve_categoria(nome_or_codigo: str) -> Optional[dict]:
    s = (nome_or_codigo or "").strip()
    if not s:
        return None
    cat = await categorias_repo.find_one({"codigo": s})
    if cat:
        return cat
    return await categorias_repo.find_one({"nome": s})


async def _resolve_subcategoria(nome: str, categoria_id: Optional[str]) -> Optional[dict]:
    s = (nome or "").strip()
    if not s:
        return None
    q: dict = {"nome": s}
    if categoria_id:
        q["categoria_id"] = categoria_id
    return await subcategorias_repo.find_one(q)


async def import_rows(
    entity: str,
    file_bytes: bytes,
    *,
    dry_run: bool = True,
) -> Dict[str, Any]:
    """Valida (e opcionalmente grava) linhas de um .xlsx para uma entidade mestre."""
    if entity not in IMPORTABLE:
        raise ValueError("Entidade não suportada para importação")

    # Se pedirem "categorias", processar folhas Categorias e Subcategorias
    targets = EXPORT_EXPAND.get(entity, [entity])

    wb = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    errors: List[dict] = []
    preview: List[dict] = []
    created = updated = 0

    for target in targets:
        sheet_title = SHEETS[target]["title"]
        ws = None
        for name in wb.sheetnames:
            if name.lower() == sheet_title.lower() or name.lower() == target.lower():
                ws = wb[name]
                break
        if ws is None and len(targets) == 1 and wb.sheetnames:
            # aceitar primeira folha de dados (não Instruções)
            for name in wb.sheetnames:
                if name.lower() not in ("instrucoes", "instruções", "instructions"):
                    ws = wb[name]
                    break
        if ws is None:
            errors.append({"linha": 0, "folha": sheet_title, "erro": f"Folha '{sheet_title}' não encontrada"})
            continue

        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = next(rows_iter)
        except StopIteration:
            errors.append({"linha": 0, "folha": sheet_title, "erro": "Folha vazia"})
            continue

        headers = [str(h).strip().lower() if h is not None else "" for h in header_row]
        expected = SHEETS[target]["columns"]
        missing = [c for c in expected if c not in headers]
        if missing:
            errors.append({
                "linha": 1,
                "folha": sheet_title,
                "erro": f"Colunas em falta: {', '.join(missing)}",
            })
            continue

        line_no = 1
        count = 0
        for values in rows_iter:
            line_no += 1
            if not values or all(v is None or str(v).strip() == "" for v in values):
                continue
            count += 1
            if count > MAX_ROWS:
                errors.append({"linha": line_no, "folha": sheet_title, "erro": f"Limite de {MAX_ROWS} linhas excedido"})
                break

            row = _row_dict(headers, values)
            try:
                action, summary = await _upsert_row(target, row, dry_run=dry_run)
            except Exception as ex:
                errors.append({"linha": line_no, "folha": sheet_title, "erro": str(ex)})
                continue

            if action == "error":
                errors.append({"linha": line_no, "folha": sheet_title, "erro": summary})
                continue
            if action == "create":
                created += 1
            elif action == "update":
                updated += 1
            preview.append({"linha": line_no, "folha": sheet_title, "acao": action, **summary})

    return {
        "ok": len(errors) == 0,
        "dry_run": dry_run,
        "created": created,
        "updated": updated,
        "errors": errors,
        "preview": preview[:200],
        "preview_total": len(preview),
    }


async def _upsert_row(entity: str, row: Dict[str, Any], *, dry_run: bool) -> Tuple[str, dict]:
    nome = str(row.get("nome") or "").strip()
    codigo = str(row.get("codigo") or "").strip()

    if entity == "clientes":
        if not nome:
            return "error", "Nome obrigatório"
        patch = {
            "nome": nome,
            "morada": str(row.get("morada") or "").strip(),
            "codigo_postal": str(row.get("codigo_postal") or "").strip(),
            "cidade": str(row.get("cidade") or "").strip(),
            "pais": str(row.get("pais") or "Portugal").strip() or "Portugal",
            "contacto": str(row.get("contacto") or "").strip(),
            "email": str(row.get("email") or "").strip().lower(),
            "nif": str(row.get("nif") or "").strip(),
            "notas": str(row.get("notas") or "").strip(),
        }
        tipo_raw = str(row.get("tipo") or "").strip().lower().replace(" ", "_")
        if tipo_raw in ("cliente_final", "cliente final"):
            tipo_raw = "particular"
        if tipo_raw in ("empresa", "particular"):
            patch["tipo"] = tipo_raw
        else:
            patch["tipo"] = "empresa" if patch["nif"] else "particular"
        if patch["tipo"] == "empresa":
            faltam = [k for k, v in (
                ("NIF", patch["nif"]),
                ("morada", patch["morada"]),
                ("código postal", patch["codigo_postal"]),
                ("cidade", patch["cidade"]),
                ("contacto", patch["contacto"]),
                ("email", patch["email"]),
            ) if not v]
            if faltam:
                return "error", "Para empresas são obrigatórios: " + ", ".join(faltam)
        existing = await clientes_repo.find_one({"codigo": codigo}) if codigo else None
        if not existing and patch["nif"]:
            existing = await clientes_repo.find_one({"nif": patch["nif"]})
        if existing:
            if not dry_run:
                await clientes_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("cliente"),
                **patch,
                "created_at": now_iso(),
            }
            await clientes_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "materiais":
        if not nome:
            return "error", "Nome obrigatório"
        patch = {
            "nome": nome,
            "unidade": str(row.get("unidade") or "un").strip() or "un",
            "custo_unitario": _parse_float(row.get("custo_unitario")),
        }
        existing = await consumiveis_repo.find_one({"codigo": codigo}) if codigo else None
        if existing:
            if not dry_run:
                await consumiveis_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("material"),
                **patch,
                "created_at": now_iso(),
            }
            await consumiveis_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "maquinas":
        if not nome:
            return "error", "Nome obrigatório"
        patch = {
            "nome": nome,
            "custo_amortizacao_hora": _parse_float(row.get("custo_amortizacao_hora")),
            "custo_energia_hora": _parse_float(row.get("custo_energia_hora")),
        }
        existing = await maquinas_repo.find_one({"codigo": codigo}) if codigo else None
        if existing:
            if not dry_run:
                await maquinas_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("maquina"),
                **patch,
                "created_at": now_iso(),
            }
            await maquinas_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "mao_obra":
        if not nome:
            return "error", "Nome obrigatório"
        patch = {
            "nome": nome,
            "custo_hora": _parse_float(row.get("custo_hora")),
            "responsavel_personalizacoes": _parse_bool(row.get("responsavel_personalizacoes")),
        }
        existing = await mao_obra_repo.find_one({"codigo": codigo}) if codigo else None
        if existing:
            if not dry_run:
                await mao_obra_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("mao_obra"),
                **patch,
                "created_at": now_iso(),
            }
            await mao_obra_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "categorias":
        if not nome:
            return "error", "Nome obrigatório"
        existing = await categorias_repo.find_one({"codigo": codigo}) if codigo else None
        if not existing:
            existing = await categorias_repo.find_one({"nome": nome})
        if existing:
            if not dry_run:
                await categorias_repo.update(existing["id"], {"nome": nome})
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("categoria"),
                "nome": nome,
                "created_at": now_iso(),
            }
            await categorias_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "subcategorias":
        if not nome:
            return "error", "Nome obrigatório"
        cat_ref = str(row.get("categoria_codigo") or row.get("categoria") or "").strip()
        cat = await _resolve_categoria(cat_ref)
        if not cat:
            return "error", f"Categoria não encontrada: {cat_ref or '(vazia)'}"
        existing = await subcategorias_repo.find_one({"codigo": codigo}) if codigo else None
        if not existing:
            existing = await subcategorias_repo.find_one({"nome": nome, "categoria_id": cat["id"]})
        patch = {
            "nome": nome,
            "categoria_id": cat["id"],
            "categoria_nome": cat.get("nome") or "",
        }
        if existing:
            if not dry_run:
                await subcategorias_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("subcategoria"),
                **patch,
                "created_at": now_iso(),
            }
            await subcategorias_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "artigos":
        if not nome:
            return "error", "Nome obrigatório"
        cat = await _resolve_categoria(str(row.get("categoria") or ""))
        sub = None
        if cat:
            sub = await _resolve_subcategoria(str(row.get("subcategoria") or ""), cat["id"])
        patch = {
            "nome": nome,
            "descricao": str(row.get("descricao") or "").strip(),
            "unidade": str(row.get("unidade") or "un").strip() or "un",
            "categoria_id": cat["id"] if cat else None,
            "categoria_nome": (cat or {}).get("nome") or "",
            "subcategoria_id": sub["id"] if sub else None,
            "subcategoria_nome": (sub or {}).get("nome") or "",
            "custo_artigo": _parse_float(row.get("custo_artigo")),
            "margem": _parse_float(row.get("margem"), 30.0),
        }
        existing = await artigos_repo.find_one({"codigo": codigo}) if codigo else None
        if existing:
            if not dry_run:
                # não apagar materiais/roteiro existentes
                await artigos_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("artigo"),
                **patch,
                "imagem": "",
                "materiais": [],
                "roteiro": [],
                "created_at": now_iso(),
            }
            await artigos_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    return "error", f"Entidade desconhecida: {entity}"
