"""Catálogo de módulos do sistema.

Os packs (comercial, produção, …) ligam/desligam módulos por cliente.
As permissões RBAC dos utilizadores aplicam-se só aos módulos activos.
"""
from typing import Any, Dict, Iterable, List, Optional

PACKS = [
    {"key": "core", "label": "Base"},
    {"key": "comercial", "label": "Comercial"},
    {"key": "catalogo", "label": "Catálogo"},
    {"key": "compras", "label": "Compras"},
    {"key": "producao", "label": "Produção"},
    {"key": "financeiro", "label": "Faturas e recibos"},
    {"key": "contas", "label": "Contas a pagar e a receber"},
]

# core=True → sempre activo (não se desliga no pack).
SYSTEM_MODULES: List[Dict[str, Any]] = [
    {"key": "dashboard", "label": "Dashboard", "pack": "core", "core": True},
    {"key": "definicoes", "label": "Definições", "pack": "core", "core": True},
    {"key": "utilizadores", "label": "Gestão de Utilizadores", "pack": "core", "core": True},
    {"key": "historico", "label": "Histórico", "pack": "core", "core": True},
    {"key": "clientes", "label": "Clientes", "pack": "comercial", "core": True},
    {"key": "orcamentos", "label": "Orçamentos", "pack": "comercial", "core": True},
    {"key": "encomendas", "label": "Encomendas", "pack": "comercial", "core": True},
    {"key": "rentabilidade", "label": "Rentabilidade por Cliente", "pack": "comercial", "core": False},
    {"key": "artigos", "label": "Artigos", "pack": "catalogo", "core": True},
    {"key": "categorias", "label": "Categorias", "pack": "catalogo", "core": True},
    {"key": "materiais", "label": "Materiais", "pack": "catalogo", "core": False},
    {"key": "maquinas", "label": "Máquinas", "pack": "catalogo", "core": False},
    {"key": "mao_obra", "label": "Mão de Obra", "pack": "catalogo", "core": False},
    {"key": "personalizacao", "label": "Tipos de Personalização", "pack": "catalogo", "core": False},
    {"key": "fornecedores", "label": "Fornecedores", "pack": "compras", "core": False},
    {"key": "pedidos_cotacao", "label": "Pedidos de Cotação", "pack": "compras", "core": False},
    {"key": "ordens_compra", "label": "Ordens de Compra", "pack": "compras", "core": False},
    {"key": "ordens_fabrico", "label": "Ordens de Fabrico", "pack": "producao", "core": False},
    {"key": "analise_producao", "label": "Análise da Produção", "pack": "producao", "core": False},
    {"key": "calendario", "label": "Calendário", "pack": "producao", "core": False},
    {"key": "nao_conformidades", "label": "Não conformidades", "pack": "producao", "core": False},
    {"key": "financeiro", "label": "Faturas e recibos", "pack": "financeiro", "core": False},
    {"key": "contas", "label": "Contas a pagar e a receber", "pack": "contas", "core": False},
]

MODULE_KEYS = [m["key"] for m in SYSTEM_MODULES]
MODULE_BY_KEY = {m["key"]: m for m in SYSTEM_MODULES}
CORE_MODULE_KEYS = [m["key"] for m in SYSTEM_MODULES if m.get("core")]


def module_label(key: str) -> str:
    m = MODULE_BY_KEY.get(key)
    return m["label"] if m else key


def resolve_modulos_ativos(stored: Optional[Iterable[str]]) -> List[str]:
    """Lista efectiva. Vazio/None = todos (instalações actuais). Módulos core ficam sempre ligados."""
    if not stored:
        return list(MODULE_KEYS)
    wanted = {str(k) for k in stored if k in MODULE_BY_KEY}
    wanted.update(CORE_MODULE_KEYS)
    return [k for k in MODULE_KEYS if k in wanted]


def modulo_activo(ativos: Optional[Iterable[str]], key: str) -> bool:
    if key not in MODULE_BY_KEY:
        return True
    return key in set(resolve_modulos_ativos(ativos))
