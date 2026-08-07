"""Classificação de ordens de compra / despesas.

Regras de negócio:
  compra           — matéria-prima, stock, artigos para transformar ou revender
  despesa_normal   — custos operacionais: água, luz, telecom, gasóleo de trabalho,
                     renda, segurança social, alarme, manutenção de máquinas
  despesa_diversa  — extraordinário / pontual: hotéis, anúncios, rifas, eventos,
                     SMS marketing, alimentação, portes de envio, gasóleo «de lucro»
"""
from __future__ import annotations

from typing import Iterable, Optional

from app.domain.models import TIPO_DESPESA_DESC, TIPO_DESPESA_PT

__all__ = [
    "TIPO_DESPESA_PT",
    "TIPO_DESPESA_DESC",
    "classificar_tipo_despesa",
    "classificar_doc",
]

TIPO_COMPRA_FALLBACK = {
    "produtos": "compra",
    "consumiveis": "compra",
    "manutenção": "despesa_normal",
    "manutencao": "despesa_normal",
    "outros": "despesa_diversa",
    "portes": "despesa_diversa",
}

_FORTES_DESPESA = (
    "água", "agua", "saneamento", "luz eletr", "eletricidade", "edp",
    "renda", "segurança social", "seguranca social", "alarme", "securitas",
    "extintor", "compressor", "reparação", "reparacao", "reparaç",
    "gasoleo", "gasóleo", "combustivel", "combustível",
    "telecom", "telefone", "internet", "vodafone",
)

_DIVERSAS_KW = (
    "hotel", "hotéis", "hoteis", "alojamento",
    "facebook", "anúncio", "anuncio", "anuncios", "anúncios", "publicidade", "publicitár",
    "rifa", "evento", "bni",
    "sms", "alimentação", "alimentacao", "restaurante", "almoço", "almoco", "jantar",
    "uber", "táxi", "taxi", "viagem", "desloc",
    "portes envio", "portes", "ctt", "correios",
)

_COMPRA_KW = (
    "acrilico", "acrílico", "acrylic", "castcryl", "lasermax",
    "mdf", "madeira", "choupo", "bambu",
    "vinil", "suptac", "dtf", "tinta", "spray",
    "led", "fonte led", "driver",
    "bijuteria", "pendente", "chapa", "placa",
    "parafuso", "esquadro", "fresa", "broca", "cola",
    "makito", "brinde", "camisola", "t-shirt", "sweatshirt",
    "caneca", "garrafa", "caneta", "candeeiro",
    "stock", "material", "dimatur", "jmr",
    "folha", "sheet", "papel", "cartão", "cartao",
)


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _blob(*parts: Optional[str]) -> str:
    return " ".join(_norm(p) for p in parts if p)


def _has_any(text: str, keywords: Iterable[str]) -> bool:
    return any(k in text for k in keywords)


def classificar_tipo_despesa(
    *,
    tipo_compra: str = "",
    assunto: str = "",
    fornecedor_nome: str = "",
    itens: Optional[Iterable[str]] = None,
    tipologia: str = "",
) -> str:
    """Devolve compra | despesa_normal | despesa_diversa."""
    itens_txt = " ".join(_norm(i) for i in (itens or []) if i)
    text = _blob(assunto, fornecedor_nome, tipologia, itens_txt)
    tipo = _norm(tipo_compra)

    if _has_any(text, _FORTES_DESPESA):
        return "despesa_normal"

    if _has_any(text, _DIVERSAS_KW) or tipo == "portes":
        return "despesa_diversa"

    if _has_any(text, _COMPRA_KW) or tipo in ("produtos", "consumiveis"):
        return "compra"

    if tipo in TIPO_COMPRA_FALLBACK:
        return TIPO_COMPRA_FALLBACK[tipo]

    return "despesa_diversa"


def classificar_doc(doc: dict) -> str:
    linhas = doc.get("linhas") or []
    itens = [l.get("nome") or "" for l in linhas]
    return classificar_tipo_despesa(
        tipo_compra=doc.get("tipo_compra") or "",
        assunto=doc.get("assunto") or "",
        fornecedor_nome=doc.get("fornecedor_nome") or "",
        itens=itens,
        tipologia=doc.get("tipologia") or "",
    )
