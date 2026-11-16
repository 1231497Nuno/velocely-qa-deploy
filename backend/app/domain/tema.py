"""Aparência da aplicação (cores, cantos, logótipo), editável nas Definições."""
import re
from typing import Literal

from pydantic import BaseModel

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

TEMA_DEFAULT = {
    "cor_principal": "#111827",   # botões principais, item ativo do menu, filtros ativos
    "cor_destaque": "#2563eb",    # ligações e realces
    "cor_menu": "#ffffff",        # fundo da barra lateral
    "cor_fundo": "#f8f9fa",       # fundo das páginas
    "cantos": "retos",            # retos | suaves | arredondados
    "usar_logo_empresa": False,   # usar o logótipo das Definições → Empresa na barra lateral
}

TEMA_PRESETS = [
    {"nome": "Grafite (original)", **{k: TEMA_DEFAULT[k] for k in ("cor_principal", "cor_destaque", "cor_menu", "cor_fundo")}},
    {"nome": "Menu escuro", "cor_principal": "#111827", "cor_destaque": "#f59e0b", "cor_menu": "#111827", "cor_fundo": "#f3f4f6"},
    {"nome": "Azul profissional", "cor_principal": "#1d4ed8", "cor_destaque": "#0ea5e9", "cor_menu": "#0f172a", "cor_fundo": "#f1f5f9"},
    {"nome": "Verde", "cor_principal": "#15803d", "cor_destaque": "#0d9488", "cor_menu": "#ffffff", "cor_fundo": "#f7faf8"},
    {"nome": "Laranja", "cor_principal": "#ea580c", "cor_destaque": "#111827", "cor_menu": "#1c1917", "cor_fundo": "#fafaf9"},
]


class TemaInput(BaseModel):
    cor_principal: str = TEMA_DEFAULT["cor_principal"]
    cor_destaque: str = TEMA_DEFAULT["cor_destaque"]
    cor_menu: str = TEMA_DEFAULT["cor_menu"]
    cor_fundo: str = TEMA_DEFAULT["cor_fundo"]
    cantos: Literal["retos", "suaves", "arredondados"] = "retos"
    usar_logo_empresa: bool = False


def normalizar_tema(tema) -> dict:
    """Junta o tema guardado com os valores por defeito e descarta cores inválidas."""
    out = dict(TEMA_DEFAULT)
    for k, v in (tema or {}).items():
        if k not in out:
            continue
        if k.startswith("cor_"):
            if isinstance(v, str) and _HEX.match(v.strip()):
                out[k] = v.strip().lower()
        elif k == "cantos":
            if v in ("retos", "suaves", "arredondados"):
                out[k] = v
        elif k == "usar_logo_empresa":
            out[k] = bool(v)
    return out
