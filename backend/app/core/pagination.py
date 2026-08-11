"""Paginação de listagens (API).

Uso típico nas rotas:
  page, page_size, skip = parse_page(page, page_size)
  total = await repo.count(query)
  items = await repo.find(query, sort=..., limit=page_size, skip=skip)
  return page_payload(items, total, page, page_size)

Sem `page` na query → a rota pode manter o comportamento legado (lista completa)
para selectors/comboboxes.
"""
from __future__ import annotations

from math import ceil
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Query


DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


def parse_page(
    page: Optional[int] = None,
    page_size: Optional[int] = None,
) -> Tuple[int, int, int]:
    """Devolve (page, page_size, skip)."""
    p = max(1, int(page or 1))
    ps = int(page_size or DEFAULT_PAGE_SIZE)
    ps = max(1, min(MAX_PAGE_SIZE, ps))
    return p, ps, (p - 1) * ps


def page_payload(items: List[Any], total: int, page: int, page_size: int) -> Dict[str, Any]:
    total = int(total or 0)
    pages = ceil(total / page_size) if page_size and total else (1 if total == 0 else 1)
    if total > 0 and page_size > 0:
        pages = max(1, ceil(total / page_size))
    else:
        pages = 1
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


def text_search(fields: List[str], q: str, *, prefix_fields: Optional[List[str]] = None) -> Optional[dict]:
    """Filtro Mongo `$or` case-insensitive — *sempre* pelo início do texto (`^`).

    Mesma lógica que clientes/fornecedores: o que escreves tem de ser o prefixo do
    campo (ex.: «div» → Diversos…; «art-00» → ART-0044). Não pesquisa no meio.

    `prefix_fields` fica só por compatibilidade (ignorado — todos os campos são prefixo).
    """
    ql = (q or "").strip()
    if not ql:
        return None
    import re
    esc = re.escape(ql)
    _ = prefix_fields  # compat
    return {"$or": [{f: {"$regex": rf"^{esc}", "$options": "i"}} for f in fields]}


def text_search_cliente(q: str) -> Optional[dict]:
    """Clientes: compara *só* o campo `nome`, do início, carácter a carácter.

    O que escreves tem de ser o prefixo do nome (ex.: «nu» → Nuno…; não Cátia Nunes).
    Não pesquisa email, cidade, código, apelido nem qualquer outro campo.
    """
    return text_search_nome_prefix(q)


def text_search_nome_prefix(q: str) -> Optional[dict]:
    """Pesquisa pelo início do campo `nome` (carácter a carácter)."""
    ql = (q or "").strip()
    if not ql:
        return None
    import re
    esc = re.escape(ql)
    return {"nome": {"$regex": rf"^{esc}", "$options": "i"}}

def apply_status_filter(query: dict, status: Optional[str], field: str = "status") -> dict:
    """Filtro de estado: valor único, lista CSV, ou `ne:valor` (≠)."""
    if not status:
        return query
    raw = str(status).strip()
    if raw.startswith("ne:"):
        query[field] = {"$ne": raw[3:].strip()}
        return query
    parts = [s.strip() for s in raw.split(",") if s.strip()]
    if len(parts) == 1:
        query[field] = parts[0]
    elif parts:
        query[field] = {"$in": parts}
    return query


def filter_by_q(items: List[Any], q: str, fields: List[str]) -> List[Any]:
    """Filtro em memória — começa por (prefixo), igual a clientes/fornecedores."""
    ql = (q or "").strip().lower()
    if not ql:
        return items
    out = []
    for it in items:
        for f in fields:
            val = str((it or {}).get(f) or "").lower()
            if val.startswith(ql):
                out.append(it)
                break
    return out


def paginate_or_all(
    items: List[Any],
    page: Optional[int],
    page_size: int = DEFAULT_PAGE_SIZE,
    extra: Optional[Dict[str, Any]] = None,
) -> Any:
    """Se page é None → lista completa; senão → page_payload (+ extra)."""
    if page is None:
        return items
    p, ps, skip = parse_page(page, page_size)
    total = len(items)
    payload = page_payload(items[skip:skip + ps], total, p, ps)
    if extra:
        payload.update(extra)
    return payload


def PageQuery(
    page: Optional[int] = Query(None, ge=1, description="Se omitido, devolve lista completa (legado)"),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    q: str = Query("", description="Pesquisa de texto"),
):
    """Dependência FastAPI — não usar directamente; preferir parâmetros nas rotas."""
    return page, page_size, q
