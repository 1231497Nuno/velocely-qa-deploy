"""Exportação / importação Excel (.xlsx) — dados mestre + export de documentos."""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from app.core.database import new_id, now_iso, next_sequence
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
    "encomenda_linhas": "encomendas",
    "ordens_fabrico": "ordens_fabrico",
}

IMPORTABLE = {
    "clientes", "fornecedores", "artigos", "materiais", "maquinas", "mao_obra",
    "categorias", "subcategorias", "encomendas",
}

EXPORTABLE = set(k for k in ENTITY_PERM.keys() if k not in ("encomenda_linhas", "subcategorias"))

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
            "codigo", "nome", "descricao", "unidade", "tipo_artigo", "produzido",
            "categoria", "subcategoria",
            "custo_artigo", "margem", "comissao_pct",
            "fabricante", "cod_fabricante", "fornecedor", "cod_fornecedor",
            "website", "ficha_produto", "plano_contas", "codigo_produto",
            "comprimento_mm", "largura_mm", "espessura_mm", "peso_kg",
            "comprimento_unidade", "largura_unidade", "espessura_unidade", "peso_unidade",
            "responsavel", "qtd_uni", "qtd_stock", "nivel_reabastecimento", "qtd_ultima_compra",
            "diversos", "ativo",
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
            "valor_total", "valor_pago", "desconto_total", "desconto_total_tipo", "envio",
            "orcamento_numero", "notas",
        ],
    },
    "encomenda_linhas": {
        "title": "Encomenda_linhas",
        "columns": [
            "encomenda_numero", "artigo_codigo", "artigo_nome", "quantidade",
            "preco_unit", "desconto", "desconto_tipo", "personalizacoes",
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

# Ao pedir "categorias" / "encomendas" no hub, exporta folhas filhas
EXPORT_EXPAND = {
    "categorias": ["categorias", "subcategorias"],
    "encomendas": ["encomendas", "encomenda_linhas"],
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


def _parse_date(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    if hasattr(v, "strftime"):
        try:
            return v.strftime("%Y-%m-%d")
        except Exception:
            return None
    s = str(v).strip()
    if not s:
        return None
    # dd/mm/yyyy or dd-mm-yyyy
    for sep in ("/", "-"):
        parts = s.split(sep)
        if len(parts) == 3 and len(parts[2]) == 4:
            d, m, y = parts[0], parts[1], parts[2]
            if len(d) <= 2 and len(m) <= 2:
                try:
                    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
                except ValueError:
                    pass
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return s[:10] if len(s) >= 8 else s


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
            "tipo_artigo": doc.get("tipo_artigo") or "ativo",
            "produzido": doc.get("produzido"),
            "categoria": doc.get("categoria_nome"),
            "subcategoria": doc.get("subcategoria_nome"),
            "custo_artigo": doc.get("custo_artigo"),
            "margem": doc.get("margem"),
            "comissao_pct": doc.get("comissao_pct"),
            "fabricante": doc.get("fabricante"),
            "cod_fabricante": doc.get("cod_fabricante"),
            "fornecedor": doc.get("fornecedor_nome"),
            "cod_fornecedor": doc.get("cod_fornecedor"),
            "website": doc.get("website"),
            "ficha_produto": doc.get("ficha_produto"),
            "plano_contas": doc.get("plano_contas"),
            "codigo_produto": doc.get("codigo_produto"),
            "comprimento_mm": doc.get("comprimento_mm"),
            "largura_mm": doc.get("largura_mm"),
            "espessura_mm": doc.get("espessura_mm"),
            "peso_kg": doc.get("peso_kg"),
            "comprimento_unidade": doc.get("comprimento_unidade") or "mm",
            "largura_unidade": doc.get("largura_unidade") or "mm",
            "espessura_unidade": doc.get("espessura_unidade") or "mm",
            "peso_unidade": doc.get("peso_unidade") or "kg",
            "responsavel": doc.get("responsavel"),
            "qtd_uni": doc.get("qtd_uni"),
            "qtd_stock": doc.get("qtd_stock"),
            "nivel_reabastecimento": doc.get("nivel_reabastecimento"),
            "qtd_ultima_compra": doc.get("qtd_ultima_compra"),
            "diversos": doc.get("diversos"),
            "ativo": doc.get("ativo") if doc.get("ativo") is not None else True,
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
            "desconto_total": doc.get("desconto_total"),
            "desconto_total_tipo": doc.get("desconto_total_tipo") or "pct",
            "envio": doc.get("envio"),
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


def _pers_to_cell(pers: Any) -> str:
    parts = []
    for p in pers or []:
        nome = (p.get("nome") or "").strip()
        if not nome:
            continue
        parts.append(f"{nome}={_parse_float(p.get('valor'))}")
    return ";".join(parts)


def _pers_from_cell(raw: Any) -> List[dict]:
    s = str(raw or "").strip()
    if not s:
        return []
    out = []
    for part in s.split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            n, v = part.split("=", 1)
        elif ":" in part:
            n, v = part.split(":", 1)
        else:
            n, v = part, "0"
        out.append({
            "id": new_id(),
            "nome": n.strip(),
            "valor": _parse_float(v),
            "tempo": 0,
        })
    return out


def _doc_to_row_enc_linha(enc: dict, linha: dict) -> List[Any]:
    cols = SHEETS["encomenda_linhas"]["columns"]
    m = {
        "encomenda_numero": enc.get("numero"),
        "artigo_codigo": linha.get("_artigo_codigo") or "",
        "artigo_nome": linha.get("artigo_nome"),
        "quantidade": linha.get("quantidade"),
        "preco_unit": linha.get("preco_unit"),
        "desconto": linha.get("desconto"),
        "desconto_tipo": linha.get("desconto_tipo") or "pct",
        "personalizacoes": _pers_to_cell(linha.get("personalizacoes")),
    }
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
        ["- Upsert por código (ou número, nas encomendas): se existir, actualiza; se vazio, cria novo."],
        ["- Máximo 5000 linhas por folha."],
        ["- Orçamentos e ordens de fabrico são só para exportação."],
        ["- Encomendas: folha Encomendas + Encomenda_linhas (ligadas por encomenda_numero)."],
        ["- Personalizações nas linhas: Nome=valor;Outro=valor (separador ;)."],
        ["- Artigos: preencha tipo_artigo (ativo/consumivel/servico/nao_utilizado/inativo) e produzido (sim/nao)."],
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
    """Gera .xlsx com uma folha por entidade (expandindo categorias / encomendas)."""
    expanded: List[str] = []
    for e in entities:
        e = (e or "").strip()
        if not e:
            continue
        if e not in SHEETS and e not in EXPORT_EXPAND:
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
        if ids_by_entity is not None:
            if entity == "encomenda_linhas":
                id_list = ids_by_entity.get("encomendas") or ids_by_entity.get("encomenda_linhas")
            elif entity in ids_by_entity:
                id_list = ids_by_entity[entity]

        if entity == "encomenda_linhas":
            encs = await _load_docs("encomendas", id_list)
            art_ids = {a.get("artigo_id") for e in encs for a in (e.get("artigos") or []) if a.get("artigo_id")}
            arts = await artigos_repo.find({"id": {"$in": list(art_ids)}}, limit=MAX_ROWS) if art_ids else []
            art_cod = {a["id"]: a.get("codigo") or "" for a in arts}
            rows = []
            for enc in encs:
                for linha in enc.get("artigos") or []:
                    linha = {**linha, "_artigo_codigo": art_cod.get(linha.get("artigo_id") or "", "")}
                    rows.append(_doc_to_row_enc_linha(enc, linha))
            _add_sheet(wb, entity, rows, first=first)
            first = False
            continue

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
            # Folha de linhas é opcional (encomenda sem artigos)
            if target == "encomenda_linhas":
                continue
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
        # Colunas novas são opcionais (compatibilidade com templates antigos)
        required = {
            "artigos": ["nome"],
            "encomendas": ["cliente"],
            "encomenda_linhas": ["encomenda_numero"],
            "clientes": ["nome"],
            "fornecedores": ["nome"],
        }.get(target, expected)
        missing = [c for c in required if c not in headers]
        if missing:
            errors.append({
                "linha": 1,
                "folha": sheet_title,
                "erro": f"Colunas em falta: {', '.join(missing)}",
            })
            continue

        if target == "encomenda_linhas":
            lines_by_num: Dict[str, List[dict]] = defaultdict(list)
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
                num = str(row.get("encomenda_numero") or "").strip()
                if not num:
                    errors.append({"linha": line_no, "folha": sheet_title, "erro": "encomenda_numero obrigatório"})
                    continue
                try:
                    linha = await _parse_encomenda_linha(row)
                except Exception as ex:
                    errors.append({"linha": line_no, "folha": sheet_title, "erro": str(ex)})
                    continue
                if isinstance(linha, str):
                    errors.append({"linha": line_no, "folha": sheet_title, "erro": linha})
                    continue
                lines_by_num[num].append(linha)

            for num, linhas in lines_by_num.items():
                try:
                    action, summary = await _apply_encomenda_linhas(num, linhas, dry_run=dry_run)
                except Exception as ex:
                    errors.append({"linha": 0, "folha": sheet_title, "erro": f"{num}: {ex}"})
                    continue
                if action == "error":
                    errors.append({"linha": 0, "folha": sheet_title, "erro": summary})
                    continue
                if action == "create":
                    created += 1
                elif action == "update":
                    updated += 1
                preview.append({"linha": 0, "folha": sheet_title, "acao": action, **summary})
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

    if entity == "fornecedores":
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
            "website": str(row.get("website") or "").strip(),
            "categoria": str(row.get("categoria") or "").strip(),
            "notas": str(row.get("notas") or "").strip(),
        }
        tipo_raw = str(row.get("tipo") or "").strip().lower().replace(" ", "_")
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
        existing = await fornecedores_repo.find_one({"codigo": codigo}) if codigo else None
        if not existing and patch["nif"]:
            existing = await fornecedores_repo.find_one({"nif": patch["nif"]})
        if existing:
            if not dry_run:
                await fornecedores_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("codigo") or codigo, "nome": nome}
        if not dry_run:
            doc = {
                "id": new_id(),
                "codigo": codigo or await next_codigo("fornecedor"),
                **patch,
                "created_at": now_iso(),
            }
            await fornecedores_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    if entity == "encomendas":
        cliente_nome = str(row.get("cliente") or "").strip()
        if not cliente_nome:
            return "error", "Cliente obrigatório"
        cliente = await clientes_repo.find_one({"nome": cliente_nome})
        if not cliente:
            # fallback: código do cliente
            cliente = await clientes_repo.find_one({"codigo": cliente_nome})
        if not cliente:
            return "error", f"Cliente não encontrado: {cliente_nome}"

        numero = str(row.get("numero") or "").strip()
        estado_raw = str(row.get("estado") or "aberta").strip().lower().replace(" ", "_")
        estado_map = {
            "aberta": "aberta",
            "em_producao": "em_producao",
            "emprodução": "em_producao",
            "em_produção": "em_producao",
            "concluida": "concluida",
            "concluída": "concluida",
            "cancelada": "cancelada",
            "open": "aberta",
            "closed": "concluida",
            "cancelled": "cancelada",
            "canceled": "cancelada",
        }
        estado = estado_map.get(estado_raw, "aberta")

        orc_num = str(row.get("orcamento_numero") or "").strip()
        orcamento_id = None
        if orc_num:
            orc = await orcamentos_repo.find_one({"numero": orc_num})
            if orc:
                orcamento_id = orc.get("id")
            else:
                return "error", f"Orçamento não encontrado: {orc_num}"

        valor_total = row.get("valor_total")
        has_valor = valor_total is not None and str(valor_total).strip() != ""
        patch = {
            "cliente": cliente.get("nome") or cliente_nome,
            "cliente_id": cliente.get("id"),
            "descricao": str(row.get("descricao") or "").strip(),
            "data": _parse_date(row.get("data")),
            "prazo_entrega": _parse_date(row.get("prazo_entrega")),
            "estado": estado,
            "notas": str(row.get("notas") or "").strip(),
            "valor_pago": _parse_float(row.get("valor_pago")),
            "desconto_total": _parse_float(row.get("desconto_total")),
            "desconto_total_tipo": (
                "eur" if str(row.get("desconto_total_tipo") or "pct").strip().lower() in ("eur", "€", "euro") else "pct"
            ),
            "envio": _parse_float(row.get("envio")),
            "orcamento_numero": orc_num or None,
            "orcamento_id": orcamento_id,
        }
        if has_valor:
            patch["valor_total"] = _parse_float(valor_total)
            patch["valor_total_manual"] = True

        existing = await encomendas_repo.find_one({"numero": numero}) if numero else None
        if existing:
            if not dry_run:
                await encomendas_repo.update(existing["id"], patch)
            return "update", {"codigo": existing.get("numero") or numero, "nome": patch["cliente"]}
        if not dry_run:
            doc = {
                "id": new_id(),
                "numero": numero or await next_sequence("ENC"),
                **patch,
                "artigos": [],
                "imagens": [],
                "anexos": [],
                "pagamentos": [],
                "desconto_total": 0.0,
                "desconto_total_tipo": "pct",
                "envio": 0.0,
                "autorizada_producao": False,
                "entregue": False,
                "created_at": now_iso(),
            }
            if not has_valor:
                doc["valor_total"] = None
                doc["valor_total_manual"] = False
            await encomendas_repo.insert(doc)
            return "create", {"codigo": doc["numero"], "nome": patch["cliente"]}
        return "create", {"codigo": numero or "(novo)", "nome": patch["cliente"]}

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
        forn_ref = str(row.get("fornecedor") or "").strip()
        forn = None
        if forn_ref:
            forn = await fornecedores_repo.find_one({"codigo": forn_ref})
            if not forn:
                forn = await fornecedores_repo.find_one({"nome": forn_ref})

        tipo_raw = str(row.get("tipo_artigo") or "ativo").strip().lower().replace(" ", "_")
        if tipo_raw in ("produzido",):
            tipo_raw = "ativo"
            produzido = True
        else:
            produzido = _parse_bool(row.get("produzido")) if "produzido" in row else False
        if tipo_raw not in ("ativo", "consumivel", "servico", "nao_utilizado", "inativo"):
            return "error", f"tipo_artigo inválido: {tipo_raw}"
        if tipo_raw != "ativo":
            produzido = False

        ativo = _parse_bool(row.get("ativo")) if row.get("ativo") not in (None, "") else (tipo_raw != "inativo")
        if tipo_raw == "inativo":
            ativo = False

        patch = {
            "nome": nome,
            "descricao": str(row.get("descricao") or "").strip(),
            "unidade": str(row.get("unidade") or "un").strip() or "un",
            "tipo_artigo": tipo_raw,
            "produzido": produzido,
            "categoria_id": cat["id"] if cat else None,
            "categoria_nome": (cat or {}).get("nome") or "",
            "subcategoria_id": sub["id"] if sub else None,
            "subcategoria_nome": (sub or {}).get("nome") or "",
            "custo_artigo": _parse_float(row.get("custo_artigo")),
            "margem": _parse_float(row.get("margem"), 0.0 if tipo_raw == "consumivel" else 30.0),
            "comissao_pct": _parse_float(row.get("comissao_pct")),
            "fabricante": str(row.get("fabricante") or "").strip(),
            "cod_fabricante": str(row.get("cod_fabricante") or "").strip(),
            "fornecedor_id": forn["id"] if forn else None,
            "fornecedor_nome": (forn or {}).get("nome") or forn_ref,
            "cod_fornecedor": str(row.get("cod_fornecedor") or "").strip(),
            "website": str(row.get("website") or "").strip(),
            "ficha_produto": str(row.get("ficha_produto") or "").strip(),
            "plano_contas": str(row.get("plano_contas") or "").strip(),
            "codigo_produto": str(row.get("codigo_produto") or "").strip(),
            "comprimento_mm": _parse_float(row.get("comprimento_mm")),
            "largura_mm": _parse_float(row.get("largura_mm")),
            "espessura_mm": _parse_float(row.get("espessura_mm")),
            "peso_kg": _parse_float(row.get("peso_kg")),
            "comprimento_unidade": str(row.get("comprimento_unidade") or "mm").strip() or "mm",
            "largura_unidade": str(row.get("largura_unidade") or "mm").strip() or "mm",
            "espessura_unidade": str(row.get("espessura_unidade") or "mm").strip() or "mm",
            "peso_unidade": str(row.get("peso_unidade") or "kg").strip() or "kg",
            "responsavel": str(row.get("responsavel") or "").strip(),
            "qtd_uni": _parse_float(row.get("qtd_uni"), 1.0),
            "qtd_stock": _parse_float(row.get("qtd_stock")),
            "nivel_reabastecimento": _parse_float(row.get("nivel_reabastecimento")),
            "qtd_ultima_compra": _parse_float(row.get("qtd_ultima_compra")),
            "diversos": _parse_bool(row.get("diversos")),
            "ativo": ativo,
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
                "updated_at": now_iso(),
            }
            await artigos_repo.insert(doc)
            return "create", {"codigo": doc["codigo"], "nome": nome}
        return "create", {"codigo": codigo or "(novo)", "nome": nome}

    return "error", f"Entidade desconhecida: {entity}"


async def _parse_encomenda_linha(row: Dict[str, Any]):
    """Devolve dict da linha ou string de erro."""
    cod = str(row.get("artigo_codigo") or "").strip()
    nome = str(row.get("artigo_nome") or "").strip()
    art = None
    if cod:
        art = await artigos_repo.find_one({"codigo": cod})
    if not art and nome:
        art = await artigos_repo.find_one({"nome": nome})
    if not nome and art:
        nome = art.get("nome") or ""
    if not nome and not art:
        return "Indique artigo_codigo ou artigo_nome"
    qtd = _parse_float(row.get("quantidade"), 1.0)
    if qtd <= 0:
        return "Quantidade deve ser > 0"
    desc_tipo = str(row.get("desconto_tipo") or "pct").strip().lower()
    if desc_tipo not in ("pct", "eur"):
        desc_tipo = "pct"
    return {
        "id": new_id(),
        "artigo_id": art["id"] if art else None,
        "artigo_nome": nome or (art or {}).get("nome") or "",
        "imagem": (art or {}).get("imagem") or "",
        "quantidade": qtd,
        "preco_unit": _parse_float(row.get("preco_unit"), _parse_float((art or {}).get("custo_artigo"), 0.0)),
        "desconto": _parse_float(row.get("desconto")),
        "desconto_tipo": desc_tipo,
        "personalizacoes": _pers_from_cell(row.get("personalizacoes")),
    }


async def _apply_encomenda_linhas(numero: str, linhas: List[dict], *, dry_run: bool) -> Tuple[str, dict]:
    enc = await encomendas_repo.find_one({"numero": numero})
    if not enc:
        if dry_run:
            # Pode ser encomenda criada na mesma importação (ainda não gravada)
            return "update", {"codigo": numero, "nome": f"{len(linhas)} linha(s)"}
        return "error", f"Encomenda não encontrada: {numero}"
    if not dry_run:
        await encomendas_repo.update(enc["id"], {"artigos": linhas})
    return "update", {
        "codigo": numero,
        "nome": f"{len(linhas)} linha(s)",
    }
