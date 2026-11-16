"""Listas do ERP (as "tabelas diversas" do Sage): valores editáveis em Definições → Listas.

Cada lista tem uma chave fixa (usada pelos ecrãs) e valores que a empresa gere.
"""
from __future__ import annotations

from typing import Dict, List

from fastapi import HTTPException

from app.domain.crm import ORIGENS_SUGERIDAS
from app.repositories import integracoes_repo

LISTAS_ID = "listas"

LISTAS: Dict[str, dict] = {
    "condicoes_pagamento": {"label": "Condições de pagamento", "onde": "Ficha do cliente",
                            "padrao": ["Pronto pagamento", "15 dias", "30 dias", "45 dias", "60 dias", "90 dias"]},
    "origens_lead": {"label": "Origens dos leads", "onde": "CRM", "padrao": list(ORIGENS_SUGERIDAS)},
    "motivos_perda": {"label": "Motivos de perda", "onde": "CRM e orçamentos perdidos",
                      "padrao": ["Preço", "Prazo", "Foi para a concorrência", "Desistiu", "Sem resposta"]},
    "motivos_bloqueio": {"label": "Motivos de bloqueio de encomenda", "onde": "Encomendas → Bloquear",
                         "padrao": ["À espera da arte final", "À espera de aprovação do cliente", "Problema de pagamento",
                                    "Falta de material", "Pedido do cliente"]},
    "tipos_compra": {"label": "Tipos de compra", "onde": "Ordens de compra",
                     "padrao": ["Consumiveis", "Produtos", "Outros", "Manutenção", "Portes"]},
    "centros_custo": {"label": "Centros de custo", "onde": "Categorias e ordens de compra (rentabilidade por área)",
                      "padrao": ["Vestuário e fardamentos", "Sinalética e placas", "Brindes", "Decoração e eventos", "Loja online", "Geral"]},
    "transportadoras": {"label": "Transportadoras", "onde": "Ordens de compra e envios",
                        "padrao": ["CTT", "CTT Expresso", "DPD", "GLS", "MRW", "Nacex", "Recolha na loja"]},
}


def _limpar(valores) -> List[str]:
    vistos, out = set(), []
    for v in valores or []:
        v = str(v or "").strip()[:80]
        if v and v.lower() not in vistos:
            vistos.add(v.lower())
            out.append(v)
    return out


async def todas() -> Dict[str, List[str]]:
    doc = await integracoes_repo.get(LISTAS_ID) or {}
    guardado = doc.get("valores") or {}
    return {k: (guardado[k] if k in guardado else list(m["padrao"])) for k, m in LISTAS.items()}


async def meta() -> dict:
    vals = await todas()
    return {"listas": [{"key": k, "label": m["label"], "onde": m["onde"], "valores": vals[k], "padrao": m["padrao"]}
                       for k, m in LISTAS.items()]}


async def guardar(chave: str, valores: List[str]) -> dict:
    if chave not in LISTAS:
        raise HTTPException(404, "Lista desconhecida")
    doc = await integracoes_repo.get(LISTAS_ID) or {}
    guardado = dict(doc.get("valores") or {})
    guardado[chave] = _limpar(valores)
    await integracoes_repo.update_where({"id": LISTAS_ID}, {"id": LISTAS_ID, "valores": guardado}, upsert=True)
    return await meta()
