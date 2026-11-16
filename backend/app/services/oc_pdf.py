"""Criar ordens de compra a partir do PDF do fornecedor (proforma, encomenda, fatura).

1. Lê o texto do PDF (pypdf). Se houver `ANTHROPIC_API_KEY`, pede ao Claude a extração estruturada
   (mais fiável com layouts diferentes); senão usa a leitura por regras abaixo.
2. Identifica o fornecedor (NIF ou nome) e as linhas: referência, descrição, quantidade e preço.
3. Associa cada linha a um artigo: associação aprendida (fornecedor + referência), referência do
   fornecedor no artigo (`cod_fornecedor`), código interno ou nome.
4. Valida: artigo sem gestão de compra, preço diferente do custo registado, quantidades.
O utilizador revê e confirma; as associações que fizer ficam aprendidas para a próxima vez.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
from typing import List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso
from app.repositories import artigos_repo, fornecedores_repo, empresa_repo, referencias_fornecedor_repo

_NUM = re.compile(r"(?<![\w/])-?\d{1,3}(?:[ .]\d{3})*(?:,\d+)?(?![\w/])|(?<![\w/])-?\d+(?:[.,]\d+)?(?![\w/])")


def _norm(v) -> str:
    s = re.sub(r"[\s.\-_/]", "", str(v or "")).upper()
    return s.lstrip("0") or s


def _num(tok: str) -> Optional[float]:
    s = tok.strip().replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def texto_pdf(dados: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:  # pragma: no cover
        raise HTTPException(500, "Leitura de PDF indisponível no servidor (falta o pacote pypdf)") from e
    try:
        r = PdfReader(io.BytesIO(dados))
        return "\n".join((p.extract_text() or "") for p in r.pages[:20])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Não foi possível ler o PDF (está protegido ou é uma imagem digitalizada?)") from e


# ---------------------------------------------------------------------------
# Extração por regras
# ---------------------------------------------------------------------------
def _melhor_triplo(nums: List[float]):
    """Escolhe (qtd, preço unitário, total) tal que qtd × preço ≈ total (com desconto até 60%)."""
    best = None
    n = len(nums)
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                q, p, t = nums[i], nums[j], nums[k]
                if q <= 0 or p <= 0 or t <= 0 or q > 100000:
                    continue
                bruto = q * p
                if bruto <= 0:
                    continue
                r = t / bruto
                if 0.4 <= r <= 1.0001:
                    erro = abs(1 - r)
                    if best is None or erro < best[0]:
                        best = (erro, q, p, t, round((1 - r) * 100, 1))
    return best


def extrair_linhas_regras(texto: str, refs_conhecidas: dict) -> List[dict]:
    """Linhas com números que parecem artigos. `refs_conhecidas`: {ref normalizada: artigo}."""
    out = []
    for raw in texto.splitlines():
        linha = raw.strip()
        if len(linha) < 6:
            continue
        baixo = linha.lower()
        if any(x in baixo for x in ("total", "subtotal", "iva ", "i.v.a", "nif", "contribuinte", "iban", "página", "pagina", "telefone",
                                    "telef", "email", "e-mail", "capital social", "data de ", "vencimento", "portes")):
            continue
        tokens = linha.split()
        ref_tok, artigo = None, None
        for t in tokens[:4]:
            a = refs_conhecidas.get(_norm(t))
            if a:
                ref_tok, artigo = t, a
                break
        if not ref_tok and re.match(r"^[A-Za-z0-9][A-Za-z0-9.\-/]{2,24}$", tokens[0]) and re.search(r"\d", tokens[0]):
            ref_tok = tokens[0]
        nums_tok = [m.group(0) for m in _NUM.finditer(linha)]
        if ref_tok:
            nums_tok = [x for x in nums_tok if _norm(x) != _norm(ref_tok)]
        nums = [v for v in (_num(x) for x in nums_tok) if v is not None]
        if len(nums) < 2 or not ref_tok:
            continue
        tri = _melhor_triplo(nums)
        if tri:
            _e, q, p, t, desc = tri
        else:
            q, p, desc = nums[0], nums[1], 0.0
            t = q * p
        desc_txt = linha
        for x in [ref_tok] + nums_tok:
            desc_txt = desc_txt.replace(x, " ", 1)
        desc_txt = re.sub(r"\s{2,}", " ", re.sub(r"[€%]|\b(un|uni|und|pcs|pç|cx|m2|m²|ml|kg|eur)\b", " ", desc_txt, flags=re.I)).strip(" -·|")
        out.append({"ref": ref_tok, "descricao": desc_txt[:160], "quantidade": round(q, 3), "preco_unit": round(p, 4),
                    "desconto": desc if desc > 0.05 else 0.0, "total": round(t, 2), "texto": linha[:240],
                    "_artigo": artigo})
    return out


# ---------------------------------------------------------------------------
# Extração com o Claude (opcional)
# ---------------------------------------------------------------------------
_PROMPT = (
    "Este PDF é um documento de um fornecedor (proforma, nota de encomenda, orçamento ou fatura). "
    "Extrai em JSON, sem texto à volta: {\"fornecedor_nome\": str, \"fornecedor_nif\": str, \"numero_documento\": str, "
    "\"linhas\": [{\"ref\": str, \"descricao\": str, \"quantidade\": number, \"preco_unit\": number, \"desconto\": number, \"total\": number}]}. "
    "preco_unit é o preço unitário sem IVA antes do desconto; desconto em %. Ignora portes, IVA e totais do documento."
)


def _claude(dados: bytes) -> Optional[dict]:
    chave = os.environ.get("ANTHROPIC_API_KEY") or ""
    if not chave:
        return None
    import requests
    corpo = {
        "model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5-5",
        "max_tokens": 4000,
        "messages": [{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(dados).decode()}},
            {"type": "text", "text": _PROMPT},
        ]}],
    }
    try:
        r = requests.post("https://api.anthropic.com/v1/messages", json=corpo, timeout=90,
                          headers={"x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        r.raise_for_status()
        txt = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        m = re.search(r"\{.*\}", txt, re.S)
        return json.loads(m.group(0)) if m else None
    except Exception:  # noqa: BLE001 — se falhar, usa as regras
        return None


# ---------------------------------------------------------------------------
async def _refs_conhecidas(fornecedor_id: Optional[str]) -> dict:
    refs = {}
    artigos = await artigos_repo.find({}, limit=20000)
    por_id = {a["id"]: a for a in artigos}
    for a in artigos:
        for k in ("codigo", "codigo_produto"):
            if a.get(k):
                refs.setdefault(_norm(a[k]), a)
    for a in artigos:  # referência do fornecedor tem prioridade sobre o código interno
        if a.get("cod_fornecedor") and (not fornecedor_id or not a.get("fornecedor_id") or a.get("fornecedor_id") == fornecedor_id):
            refs[_norm(a["cod_fornecedor"])] = a
    q = {"fornecedor_id": fornecedor_id} if fornecedor_id else {}
    for m in await referencias_fornecedor_repo.find(q, limit=20000):
        a = por_id.get(m.get("artigo_id"))
        if a:
            refs[_norm(m.get("ref"))] = a
    return refs


async def _detetar_fornecedor(texto: str, nome_ia: str = "", nif_ia: str = "") -> Optional[dict]:
    emp = await empresa_repo.find_one({"id": "empresa"}) or {}
    meu = re.sub(r"\D", "", emp.get("nif") or "")
    forns = await fornecedores_repo.find({}, limit=5000)
    nifs = set(re.findall(r"(?<!\d)(?:PT\s?)?(\d{9})(?!\d)", texto)) | ({re.sub(r"\D", "", nif_ia)} if nif_ia else set())
    nifs.discard(meu)
    for f in forns:
        if re.sub(r"\D", "", f.get("nif") or "") in nifs:
            return f
    alvo = (nome_ia or "").lower()
    baixo = texto.lower()
    melhor = None
    for f in forns:
        n = (f.get("nome") or "").lower().replace("[sim] ", "").strip()
        if len(n) >= 4 and (n in baixo or (alvo and (n in alvo or alvo in n))):
            if not melhor or len(n) > len(melhor[0]):
                melhor = (n, f)
    return melhor[1] if melhor else None


def _por_nome(desc: str, artigos: List[dict]) -> Optional[dict]:
    d = set(w for w in re.findall(r"[a-zà-ú0-9]{3,}", (desc or "").lower()))
    if len(d) < 2:
        return None
    best = None
    for a in artigos:
        w = set(re.findall(r"[a-zà-ú0-9]{3,}", (a.get("nome") or "").lower()))
        if not w:
            continue
        s = len(d & w) / len(w)
        if s >= 0.75 and (not best or s > best[0]):
            best = (s, a)
    return best[1] if best else None


async def analisar(nome: str, dados: bytes) -> dict:
    if not nome.lower().endswith(".pdf") and not dados[:5] == b"%PDF-":
        raise HTTPException(400, "Envie o PDF do fornecedor")
    texto = await asyncio.to_thread(texto_pdf, dados)
    ia = await asyncio.to_thread(_claude, dados)
    forn = await _detetar_fornecedor(texto, (ia or {}).get("fornecedor_nome") or "", (ia or {}).get("fornecedor_nif") or "")
    refs = await _refs_conhecidas(forn["id"] if forn else None)
    if ia and ia.get("linhas"):
        linhas = []
        for l in ia["linhas"]:
            linhas.append({"ref": str(l.get("ref") or "")[:40], "descricao": str(l.get("descricao") or "")[:160],
                           "quantidade": float(l.get("quantidade") or 0), "preco_unit": float(l.get("preco_unit") or 0),
                           "desconto": float(l.get("desconto") or 0), "total": float(l.get("total") or 0), "texto": "",
                           "_artigo": refs.get(_norm(l.get("ref"))) if l.get("ref") else None})
        metodo = "ia"
    else:
        linhas = extrair_linhas_regras(texto, refs)
        metodo = "regras"
    if not texto.strip() and not linhas:
        raise HTTPException(400, "O PDF não tem texto (é uma digitalização). Peça o PDF original ao fornecedor.")
    artigos = None
    out = []
    for l in linhas:
        a = l.pop("_artigo", None)
        origem = "referencia" if a else ""
        if not a:
            if artigos is None:
                artigos = await artigos_repo.find({}, limit=20000)
            a = _por_nome(l["descricao"], artigos)
            origem = "nome" if a else ""
        avisos = []
        if a:
            custo = float(a.get("custo_artigo") or 0) * float(a.get("fator_compra") or 1)
            pliq = l["preco_unit"] * (1 - l["desconto"] / 100)
            if custo > 0 and pliq > 0 and abs(pliq - custo) / custo > 0.05:
                avisos.append(f"Preço {pliq:.2f} € ≠ custo registado {custo:.2f} €")
            if forn and a.get("fornecedor_id") and a.get("fornecedor_id") != forn["id"]:
                avisos.append(f"Artigo associado a outro fornecedor ({a.get('fornecedor_nome') or '—'})")
        if l["quantidade"] <= 0:
            avisos.append("Quantidade não encontrada")
        out.append({**l, "id": new_id(), "artigo_id": a["id"] if a else None, "artigo_nome": a.get("nome") if a else "",
                    "artigo_codigo": a.get("codigo") if a else "", "custo_registado": float(a.get("custo_artigo") or 0) if a else None,
                    "associacao": origem, "avisos": avisos, "incluir": True})
    num = re.search(r"(?:proforma|encomenda|fatura|factura|or[cç]amento|documento|n\.?º|nº)\s*[:\-]?\s*([A-Z0-9][\w/\-. ]{2,25})", texto, re.I)
    numero = ((ia or {}).get("numero_documento") or (num.group(1).strip() if num else ""))[:40]
    return {"metodo": metodo, "fornecedor_id": forn["id"] if forn else None, "fornecedor_nome": forn.get("nome") if forn else (ia or {}).get("fornecedor_nome") or "",
            "numero_documento": numero, "linhas": out,
            "resumo": {"linhas": len(out), "associadas": sum(1 for x in out if x["artigo_id"]), "com_avisos": sum(1 for x in out if x["avisos"])}}


async def aprender(fornecedor_id: Optional[str], linhas: List[dict]) -> int:
    """Guarda as associações referência do fornecedor → artigo que o utilizador confirmou."""
    n = 0
    for l in linhas:
        ref, aid = (l.get("ref") or "").strip(), l.get("artigo_id")
        if not ref or not aid:
            continue
        q = {"fornecedor_id": fornecedor_id or None, "ref_norm": _norm(ref)}
        ex = await referencias_fornecedor_repo.find_one(q)
        if ex:
            if ex.get("artigo_id") != aid:
                await referencias_fornecedor_repo.update(ex["id"], {"artigo_id": aid, "updated_at": now_iso()})
                n += 1
        else:
            await referencias_fornecedor_repo.insert({"id": new_id(), **q, "ref": ref, "artigo_id": aid, "created_at": now_iso()})
            n += 1
    return n
