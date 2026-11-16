"""Calculadora de preço por técnica (DTF ao metro linear, área, tempo de máquina, artigo de fornecedor).

Os parâmetros ficam em `integracoes` (id «tecnicas_preco»); o cálculo é feito no ecrã (lib/calculadoraPreco.js).
"""
from fastapi import HTTPException

from app.repositories import integracoes_repo

CFG_ID = "tecnicas_preco"
TIPOS = ("dtf", "area", "tempo", "fornecedor")
DEFAULT = [
    {"id": "dtf", "nome": "DTF têxtil", "tipo": "dtf", "largura_util_cm": 57, "custo_metro": 9, "margem_pct": 75,
     "extra_unidade": 1, "espaco_cm": 1, "minimo": 0},
    {"id": "uv", "nome": "Impressão UV (cor)", "tipo": "area", "custo_m2": 35, "margem_pct": 150, "setup": 0, "minimo": 5},
    {"id": "laser", "nome": "Corte / gravação laser", "tipo": "tempo", "custo_hora": 30, "margem_pct": 100, "setup_min": 5,
     "minimo": 5},
    {"id": "fornecedor", "nome": "Artigo de fornecedor (Makito, THC…)", "tipo": "fornecedor", "iva_pct": 23, "margem_pct": 100,
     "minimo": 0},
    {"id": "natal", "nome": "Artigos de Natal", "tipo": "fornecedor", "iva_pct": 21, "margem_pct": 80, "minimo": 0},
]


async def listar() -> list:
    g = await integracoes_repo.get(CFG_ID)
    return (g or {}).get("tecnicas") or DEFAULT


async def guardar(tecnicas: list) -> list:
    limpas = []
    for t in tecnicas or []:
        if t.get("tipo") not in TIPOS or not (t.get("nome") or "").strip():
            raise HTTPException(400, "Cada técnica precisa de nome e tipo válido")
        limpa = {"id": (t.get("id") or t["nome"]).strip()[:40], "nome": t["nome"].strip(), "tipo": t["tipo"]}
        for k, v in t.items():
            if k not in limpa and isinstance(v, (int, float)) and not isinstance(v, bool):
                limpa[k] = max(0.0, float(v))
            elif k not in limpa and isinstance(v, str) and v.replace(".", "", 1).isdigit():
                limpa[k] = float(v)
        limpas.append(limpa)
    await integracoes_repo.update_where({"id": CFG_ID}, {"id": CFG_ID, "tecnicas": limpas}, upsert=True)
    return limpas
