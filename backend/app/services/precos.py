"""Tabelas de preços (as "tarifas" do Sage): preços ou descontos por cliente, artigo/categoria e escalão de quantidade.

Regra escolhida para uma linha:
  1. só tabelas ativas e dentro da validade;
  2. tabelas do cliente antes das gerais; depois a menor prioridade;
  3. dentro da tabela: regra do artigo > da categoria > geral;
  4. o escalão com a maior quantidade mínima que a linha atinge.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import artigos_repo, tabelas_precos_repo


def _hoje() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def normalizar(dados: dict, existente: Optional[dict] = None) -> dict:
    nome = (dados.get("nome") or "").strip()
    if not nome:
        raise HTTPException(400, "Dê um nome à tabela de preços")
    regras = []
    for i, r in enumerate(dados.get("regras") or []):
        alvo = r.get("alvo") if r.get("alvo") in ("artigo", "categoria", "todos") else "artigo"
        tipo = r.get("tipo") if r.get("tipo") in ("preco", "desconto") else "preco"
        if alvo == "artigo" and not r.get("artigo_id"):
            raise HTTPException(400, f"Regra {i + 1}: escolha o artigo")
        if alvo == "categoria" and not r.get("categoria_id"):
            raise HTTPException(400, f"Regra {i + 1}: escolha a categoria")
        escaloes = []
        for e in r.get("escaloes") or []:
            try:
                qmin, valor = max(0.0, float(e.get("qtd_min") or 0)), float(e.get("valor") or 0)
            except (TypeError, ValueError):
                raise HTTPException(400, f"Regra {i + 1}: escalão inválido")
            if tipo == "desconto" and not 0 <= valor <= 100:
                raise HTTPException(400, f"Regra {i + 1}: o desconto tem de estar entre 0 e 100%")
            if valor < 0:
                raise HTTPException(400, f"Regra {i + 1}: valor negativo")
            escaloes.append({"qtd_min": round2(qmin), "valor": round2(valor)})
        if not escaloes:
            raise HTTPException(400, f"Regra {i + 1}: indique pelo menos um escalão (quantidade e valor)")
        escaloes.sort(key=lambda e: e["qtd_min"])
        regras.append({
            "id": r.get("id") or new_id(), "alvo": alvo, "tipo": tipo,
            "artigo_id": r.get("artigo_id") if alvo == "artigo" else None,
            "artigo_nome": (r.get("artigo_nome") or "") if alvo == "artigo" else "",
            "categoria_id": r.get("categoria_id") if alvo == "categoria" else None,
            "categoria_nome": (r.get("categoria_nome") or "") if alvo == "categoria" else "",
            "escaloes": escaloes,
        })
    de, ate = (dados.get("de") or "")[:10], (dados.get("ate") or "")[:10]
    if de and ate and de > ate:
        raise HTTPException(400, "A data de início é posterior à data de fim")
    return {
        **(existente or {"id": new_id(), "created_at": now_iso()}),
        "nome": nome, "ativo": bool(dados.get("ativo", True)),
        "prioridade": int(dados.get("prioridade") or 10),
        "cliente_ids": [c for c in (dados.get("cliente_ids") or []) if c],
        "clientes_nomes": dados.get("clientes_nomes") or [],
        "de": de, "ate": ate, "notas": (dados.get("notas") or "").strip(),
        "regras": regras, "updated_at": now_iso(),
    }


def _vigente(t: dict, dia: str, cliente_id: Optional[str]) -> bool:
    if not t.get("ativo", True):
        return False
    if t.get("de") and dia < t["de"]:
        return False
    if t.get("ate") and dia > t["ate"]:
        return False
    cl = t.get("cliente_ids") or []
    return not cl or (cliente_id in cl)


def _escalao(regra: dict, qtd: float) -> Optional[dict]:
    melhor = None
    for e in regra.get("escaloes") or []:
        if qtd + 1e-9 >= float(e.get("qtd_min") or 0):
            melhor = e
    return melhor


async def aplicar(cliente_id: Optional[str], linhas: List[dict], dia: Optional[str] = None) -> List[dict]:
    """Para cada linha {artigo_id, quantidade, categoria_id?} devolve o preço/desconto da tabela (ou None)."""
    dia = (dia or _hoje())[:10]
    tabelas = [t for t in await tabelas_precos_repo.find({}, limit=500) if _vigente(t, dia, cliente_id)]
    tabelas.sort(key=lambda t: (0 if t.get("cliente_ids") else 1, int(t.get("prioridade") or 10), t.get("nome") or ""))
    cats: Dict[str, Optional[str]] = {}
    ids = [l.get("artigo_id") for l in linhas if l.get("artigo_id") and not l.get("categoria_id")]
    if ids:
        for a in await artigos_repo.find({"id": {"$in": ids}}, limit=len(ids) + 5, projection={"id": 1, "categoria_id": 1}):
            cats[a["id"]] = a.get("categoria_id")
    out = []
    for l in linhas:
        aid = l.get("artigo_id")
        cat = l.get("categoria_id") or cats.get(aid or "")
        qtd = float(l.get("quantidade") or 0)
        achado = None
        for t in tabelas:
            candidatas = [r for r in t.get("regras") or [] if
                          (r["alvo"] == "artigo" and aid and r.get("artigo_id") == aid)
                          or (r["alvo"] == "categoria" and cat and r.get("categoria_id") == cat)
                          or r["alvo"] == "todos"]
            candidatas.sort(key=lambda r: {"artigo": 0, "categoria": 1, "todos": 2}[r["alvo"]])
            for r in candidatas:
                e = _escalao(r, qtd)
                if e:
                    achado = {"tabela_id": t["id"], "tabela": t["nome"], "tipo": r["tipo"], "valor": e["valor"],
                              "qtd_min": e["qtd_min"],
                              "descricao": (f"{t['nome']}: " + (f"{e['valor']:.2f} €/un" if r["tipo"] == "preco" else f"−{e['valor']:g}%")
                                            + (f" a partir de {e['qtd_min']:g} un" if e["qtd_min"] > 0 else ""))}
                    break
            if achado:
                break
        out.append(achado)
    return out
