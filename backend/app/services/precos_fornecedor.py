"""Atualizar custos a partir da tabela de preços de um fornecedor (Excel/CSV): ler → pré-visualizar → aplicar."""
from __future__ import annotations

import csv
import io
import re
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import artigos_repo, fornecedores_repo, importacoes_tmp_repo
from app.services import audit

PISTAS_REF = ("ref", "referencia", "referência", "codigo", "código", "sku", "artigo", "item", "reference", "code")
PISTAS_PRECO = ("-500", "500", "preco", "preço", "price", "custo", "pvp", "valor", "net")


def _norm(v) -> str:
    return re.sub(r"\s+", "", str(v or "")).strip().upper().lstrip("0") or str(v or "").strip()


def _num(v) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def ler_ficheiro(nome: str, dados: bytes) -> List[List]:
    if nome.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
        ws = wb.active
        return [list(r) for r in ws.iter_rows(values_only=True)]
    txt = dados.decode("utf-8-sig", errors="replace")
    sep = ";" if txt.count(";") > txt.count(",") else ","
    return [r for r in csv.reader(io.StringIO(txt), delimiter=sep)]


async def ler(nome: str, dados: bytes) -> dict:
    linhas = [r for r in ler_ficheiro(nome, dados) if any(c not in (None, "") for c in r)]
    if len(linhas) < 2:
        raise HTTPException(400, "O ficheiro não tem linhas")
    # Cabeçalho = primeira linha com pelo menos 2 textos
    hi = next((i for i, r in enumerate(linhas[:15]) if sum(isinstance(c, str) and c.strip() != "" for c in r) >= 2), 0)
    cab = [str(c or f"Coluna {j + 1}").strip() for j, c in enumerate(linhas[hi])]
    corpo = [[c if not hasattr(c, "isoformat") else str(c) for c in r] for r in linhas[hi + 1:]][:20000]

    def sugere(pistas):
        for p in pistas:
            for j, c in enumerate(cab):
                if p in c.lower():
                    return j
        return None
    token = new_id()
    await importacoes_tmp_repo.insert({"id": token, "tipo": "precos_fornecedor", "nome": nome, "cabecalho": cab, "linhas": corpo,
                                       "created_at": now_iso()})
    return {"token": token, "colunas": cab, "amostra": corpo[:5], "linhas": len(corpo),
            "col_ref": sugere(PISTAS_REF), "col_preco": sugere(PISTAS_PRECO)}


async def previsao(dados: dict) -> dict:
    imp = await importacoes_tmp_repo.get(dados.get("token") or "")
    if not imp:
        raise HTTPException(404, "Ficheiro expirado — volte a carregar")
    fid = dados.get("fornecedor_id")
    if not fid or not await fornecedores_repo.get(fid):
        raise HTTPException(400, "Escolha o fornecedor")
    cr, cp = int(dados.get("col_ref")), int(dados.get("col_preco"))
    precos: Dict[str, float] = {}
    for r in imp["linhas"]:
        if len(r) <= max(cr, cp):
            continue
        p = _num(r[cp])
        if r[cr] not in (None, "") and p is not None and p > 0:
            precos[_norm(r[cr])] = p
    fator = 1 + float(dados.get("ajuste_pct") or 0) / 100
    alteracoes, iguais, sem_ref = [], 0, 0
    for a in await artigos_repo.find({"fornecedor_id": fid}, limit=50000):
        ref = a.get("cod_fornecedor") or ""
        if not ref:
            sem_ref += 1
            continue
        novo = precos.get(_norm(ref))
        if novo is None:
            continue
        novo = round(novo * fator, 4)
        atual = float(a.get("custo_artigo") or 0)
        if abs(novo - atual) < 0.005:
            iguais += 1
            continue
        alteracoes.append({"artigo_id": a["id"], "codigo": a.get("codigo") or "", "nome": a.get("nome") or "", "ref": ref,
                           "custo_atual": round2(atual), "custo_novo": round2(novo),
                           "variacao_pct": round2((novo - atual) / atual * 100) if atual else None})
    alteracoes.sort(key=lambda x: -abs(x["variacao_pct"] or 100))
    return {"alteracoes": alteracoes, "iguais": iguais, "artigos_sem_ref": sem_ref, "precos_no_ficheiro": len(precos)}


async def aplicar(dados: dict, user: dict) -> dict:
    pv = await previsao(dados)
    escolhidos = set(dados.get("artigo_ids") or [x["artigo_id"] for x in pv["alteracoes"]])
    n = 0
    for x in pv["alteracoes"]:
        if x["artigo_id"] not in escolhidos:
            continue
        a = await artigos_repo.get(x["artigo_id"]) or {}
        patch = {"custo_artigo": x["custo_novo"], "updated_at": now_iso(), "woo_pendente": True}
        if float(a.get("preco_compra") or 0) > 0:
            patch["preco_compra"] = x["custo_novo"]
        await artigos_repo.update(x["artigo_id"], patch)
        await audit.registar("artigo", x["artigo_id"], "editado", user,
                             f"Custo atualizado pela tabela do fornecedor: {x['custo_atual']:.2f} € → {x['custo_novo']:.2f} €", x["nome"])
        n += 1
    await importacoes_tmp_repo.col.delete_many({"id": dados.get("token")})
    return {"atualizados": n}
