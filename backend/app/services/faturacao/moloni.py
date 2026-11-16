"""Moloni — API v1 (https://api.moloni.pt/v1). Autenticação por utilizador/palavra-passe (grant_type=password)
com o client ID / segredo de programador; o token dura 1 hora e renova-se com o refresh token.

Cada linha de um documento Moloni tem de apontar para um artigo existente: usamos um artigo genérico
(referência configurável) e enviamos o nome e o preço de cada linha.
"""
from __future__ import annotations

import time
from typing import Any, Optional

from app.services.faturacao.base import (
    NIF_CONSUMIDOR_FINAL, FaturacaoErro, FaturacaoNaoSuportado, ResultadoEmissao, http, isento,
    linhas_para_emitir, nif_cliente,
)

BASE = "https://api.moloni.pt/v1"
ENDPOINT_TIPO = {"fatura": "invoices", "fatura_recibo": "invoiceReceipts", "fatura_simplificada": "simplifiedInvoices"}


def _c(cfg: dict) -> dict:
    return cfg.get("moloni") or {}


def _empresa(cfg: dict) -> int:
    try:
        return int(_c(cfg).get("company_id") or 0)
    except (TypeError, ValueError):
        return 0


def _erro_moloni(j: Any) -> str:
    """O Moloni responde 200 mesmo com erros de validação: lista de {code, field, description}."""
    if isinstance(j, list) and j and isinstance(j[0], dict) and ("code" in j[0] or "description" in j[0]):
        return "; ".join(f"{e.get('field') or ''} {e.get('description') or e.get('code')}".strip() for e in j[:3])
    if isinstance(j, dict) and j.get("error"):
        return str(j.get("error_description") or j.get("error"))
    if isinstance(j, dict) and j.get("valid") == 0:
        return "dados inválidos"
    return ""


async def _token(cfg: dict, params: dict) -> dict:
    c = _c(cfg)
    if not (c.get("client_id") and c.get("client_secret")):
        raise FaturacaoErro("Faltam o client ID e o segredo de programador do Moloni", 400)
    r = await http("GET", f"{BASE}/grant/", params={"client_id": c["client_id"], "client_secret": c["client_secret"], **params})
    try:
        j = r.json()
    except ValueError:
        j = {}
    if r.status_code >= 400 or not isinstance(j, dict) or not j.get("access_token"):
        detalhe = _erro_moloni(j) or f"erro {r.status_code}"
        raise FaturacaoErro(f"O Moloni recusou a autenticação: {detalhe}", 400)
    return {"access_token": j["access_token"], "refresh_token": j.get("refresh_token") or "",
            "expira_em": int(time.time()) + int(j.get("expires_in") or 3600) - 60,
            "refresh_expira_em": int(time.time()) + 13 * 86400}


async def _access(cfg: dict, ctx: dict) -> str:
    c = _c(cfg)
    if c.get("access_token") and int(c.get("expira_em") or 0) > time.time():
        return c["access_token"]
    novos = None
    if c.get("refresh_token") and int(c.get("refresh_expira_em") or 0) > time.time():
        try:
            novos = await _token(cfg, {"grant_type": "refresh_token", "refresh_token": c["refresh_token"]})
        except FaturacaoErro:
            novos = None
    if not novos:
        if not (c.get("username") and c.get("password")):
            raise FaturacaoErro("Faltam o utilizador e a palavra-passe do Moloni", 400)
        novos = await _token(cfg, {"grant_type": "password", "username": c["username"], "password": c["password"]})
    await ctx["guardar_tokens"](novos)
    cfg["moloni"] = {**c, **novos}
    return novos["access_token"]


async def _chamar(cfg: dict, ctx: dict, endpoint: str, dados: Optional[dict] = None, *, erro: str = "O Moloni recusou o pedido", com_empresa: bool = True):
    corpo = dict(dados or {})
    if com_empresa:
        if not _empresa(cfg):
            raise FaturacaoErro("Escolha a empresa do Moloni nas definições da faturação", 400)
        corpo.setdefault("company_id", _empresa(cfg))
    r = await http("POST", f"{BASE}/{endpoint.strip('/')}/", params={"access_token": await _access(cfg, ctx), "json": "true"},
                   json=corpo, headers={"Accept": "application/json"})
    try:
        j = r.json()
    except ValueError:
        j = None
    if r.status_code >= 400:
        raise FaturacaoErro(f"{erro} (erro {r.status_code}){': ' + _erro_moloni(j) if _erro_moloni(j) else ''}")
    detalhe = _erro_moloni(j)
    if detalhe:
        raise FaturacaoErro(f"{erro}: {detalhe}")
    return j


async def testar(cfg: dict, ctx: dict) -> dict:
    empresas = await _chamar(cfg, ctx, "companies/getAll", {}, com_empresa=False, erro="Não foi possível ler as empresas no Moloni")
    lista = [{"id": str(e.get("company_id")), "nome": e.get("name") or ""} for e in (empresas or []) if isinstance(e, dict)]
    escolhida = next((e for e in lista if e["id"] == str(_empresa(cfg))), None)
    out = {"ok": True, "empresas": lista, "empresa": (escolhida or {}).get("nome") or ""}
    ref = (_c(cfg).get("produto_referencia") or "").strip()
    if escolhida and ref:
        out["produto"] = bool(await _produto(cfg, ctx, ref, falhar=False))
    return out


async def dados(cfg: dict, ctx: dict) -> dict:
    empresas = await _chamar(cfg, ctx, "companies/getAll", {}, com_empresa=False)
    out = {"empresas": [{"id": str(e.get("company_id")), "nome": e.get("name") or ""} for e in (empresas or []) if isinstance(e, dict)],
           "series": [], "metodos": [], "impostos": [], "caes": []}
    if not _empresa(cfg):
        return out
    for s in await _chamar(cfg, ctx, "documentSets/getAll") or []:
        out["series"].append({"id": str(s.get("document_set_id")), "nome": s.get("name") or "", "tipo": ""})
    for m in await _chamar(cfg, ctx, "paymentMethods/getAll") or []:
        out["metodos"].append({"id": str(m.get("payment_method_id")), "nome": m.get("name") or ""})
    for t in await _chamar(cfg, ctx, "taxes/getAll") or []:
        out["impostos"].append({"id": str(t.get("tax_id")), "nome": f"{t.get('name') or ''} ({t.get('value')}%)", "valor": t.get("value")})
    return out


async def _produto(cfg: dict, ctx: dict, ref: str, falhar: bool = True) -> Optional[int]:
    chave = f"moloni:{_empresa(cfg)}:produto:{ref}"
    em_cache = await ctx["cache_get"](chave)
    if em_cache:
        return int(em_cache)
    lista = await _chamar(cfg, ctx, "products/getByReference", {"reference": ref, "exact": 1}, erro="Não encontrei o artigo genérico no Moloni")
    pid = next((p.get("product_id") for p in (lista or []) if isinstance(p, dict) and p.get("product_id")), None)
    if not pid:
        if falhar:
            raise FaturacaoErro(f"Não existe no Moloni um artigo com a referência «{ref}» (artigo genérico das linhas)", 400)
        return None
    await ctx["cache_set"](chave, str(pid))
    return int(pid)


async def _cliente(cfg: dict, ctx: dict, cliente: dict) -> int:
    nif = nif_cliente(cliente) or NIF_CONSUMIDOR_FINAL
    chave = f"moloni:{_empresa(cfg)}:cliente:{nif}"
    em_cache = await ctx["cache_get"](chave)
    if em_cache:
        return int(em_cache)
    lista = await _chamar(cfg, ctx, "customers/getByVat", {"vat": nif}, erro="Não foi possível procurar o cliente no Moloni")
    cid = next((c.get("customer_id") for c in (lista or []) if isinstance(c, dict) and c.get("customer_id")), None)
    if not cid:
        final = nif == NIF_CONSUMIDOR_FINAL
        metodo = (cfg.get("metodos") or {}).get("transferencia") or 0
        novo = await _chamar(cfg, ctx, "customers/insert", {
            "vat": nif,
            "number": ("CF" if final else (cliente.get("codigo") or nif))[:30],
            "name": "Consumidor final" if final else (cliente.get("nome") or "Cliente")[:100],
            "language_id": 1,
            "address": "" if final else (cliente.get("morada") or "Desconhecido"),
            "zip_code": "" if final else (cliente.get("codigo_postal") or ""),
            "city": "" if final else (cliente.get("cidade") or "Desconhecido"),
            "country_id": 1,
            "email": "" if final else (cliente.get("email") or ""),
            "maturity_date_id": 0,
            "payment_method_id": int(metodo or 0),
            "salesman_id": 0, "payment_day": 0, "discount": 0, "credit_limit": 0, "delivery_method_id": 0,
        }, erro="O Moloni não aceitou o cliente")
        cid = (novo or {}).get("customer_id")
        if not cid:
            raise FaturacaoErro("O Moloni não devolveu o identificador do cliente")
    await ctx["cache_set"](chave, str(cid))
    return int(cid)


def _metodo(cfg: dict, metodo: str) -> int:
    m = cfg.get("metodos") or {}
    v = m.get(metodo or "") or m.get("outro") or 0
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


async def emitir(cfg: dict, doc: dict, cliente: dict, ctx: dict) -> ResultadoEmissao:
    endpoint = ENDPOINT_TIPO.get(doc.get("tipo"))
    if not endpoint:
        raise FaturacaoErro(f"O Moloni não emite este tipo de documento ({doc.get('tipo')})", 400)
    anterior = doc.get("faturacao") or {}
    if anterior.get("externo_id") and anterior.get("fornecedor") == "moloni":
        # Já foi criado numa tentativa anterior (falhou depois): só falta ler o número
        return await _resultado(cfg, ctx, int(anterior["externo_id"]), (anterior.get("extra") or {}).get("cliente_id"))
    serie = (cfg.get("series") or {}).get(doc["tipo"])
    if not serie:
        raise FaturacaoErro("Escolha a série do Moloni para este tipo de documento nas definições", 400)
    ref = (_c(cfg).get("produto_referencia") or "").strip()
    if not ref:
        raise FaturacaoErro("Indique a referência do artigo genérico do Moloni nas definições", 400)
    produto_id = await _produto(cfg, ctx, ref)
    cid = await _cliente(cfg, ctx, cliente)
    tax_id = _c(cfg).get("tax_id")
    produtos = []
    for i, l in enumerate(linhas_para_emitir(doc)):
        p = {"product_id": produto_id, "name": l["descricao"], "qty": l["quantidade"], "price": l["preco_unit"],
             "discount": 0, "order": i + 1}
        if isento(ctx) or not tax_id:
            p["exemption_reason"] = cfg.get("motivo_isencao") or "M10"
            p["taxes"] = []
        else:
            p["taxes"] = [{"tax_id": int(tax_id), "order": 1, "cumulative": 0}]
        produtos.append(p)
    corpo = {
        "date": doc.get("data"), "expiration_date": doc.get("data"), "document_set_id": int(serie),
        "customer_id": cid, "your_reference": (doc.get("referencia_cliente") or doc.get("encomenda_numero") or "")[:60],
        "notes": (doc.get("notas") or "")[:500], "products": produtos, "status": 1,
    }
    if doc["tipo"] in ("fatura_recibo", "fatura_simplificada"):
        corpo["payments"] = [{"payment_method_id": _metodo(cfg, doc.get("metodo_pagamento")), "date": doc.get("data"),
                              "value": round(float(doc.get("total") or 0), 2)}]
    j = await _chamar(cfg, ctx, f"{endpoint}/insert", corpo, erro="O Moloni não aceitou o documento")
    did = (j or {}).get("document_id")
    if not did:
        raise FaturacaoErro("O Moloni não devolveu o identificador do documento")
    await ctx["guardar_parcial"]({"externo_id": str(did), "extra": {"cliente_id": cid}})
    return await _resultado(cfg, ctx, did, cid)


async def _resultado(cfg: dict, ctx: dict, did: int, cid) -> ResultadoEmissao:
    info = await _chamar(cfg, ctx, "documents/getOne", {"document_id": did}) or {}
    numero = info.get("number")
    serie_nome = info.get("document_set_name") or ""
    res = ResultadoEmissao(
        externo_id=str(did),
        numero=f"{serie_nome}/{numero}".strip("/") if numero else "",
        atcud=str(info.get("atcud") or ""),
        hash_curto=str(info.get("rsa_hash") or "")[:4],
        estado_at="",
        total=float(info["net_value"]) if isinstance(info.get("net_value"), (int, float)) else None,
        extra={"cliente_id": cid} if cid else {},
    )
    try:
        res.pdf_url = await pdf_url(cfg, {"externo_id": str(did)}, ctx)
    except FaturacaoErro:
        pass
    return res


async def pdf_url(cfg: dict, externo: dict, ctx: Optional[dict] = None) -> str:
    j = await _chamar(cfg, ctx or {}, "documents/getPDFLink", {"document_id": int(externo["externo_id"])},
                      erro="O Moloni não devolveu o PDF")
    return str((j or {}).get("url") or "")


async def registar_recebimento(cfg: dict, externo: dict, valor: float, metodo: str, data: str, ctx: dict) -> ResultadoEmissao:
    serie = (cfg.get("series") or {}).get("recibo")
    if not serie:
        raise FaturacaoNaoSuportado("Escolha a série de recibos do Moloni nas definições para emitir o recibo")
    cid = ((externo.get("extra") or {}).get("cliente_id"))
    if not cid:
        raise FaturacaoNaoSuportado("Não sei o cliente Moloni desta fatura — emita o recibo no Moloni")
    j = await _chamar(cfg, ctx, "receipts/insert", {
        "date": data, "document_set_id": int(serie), "customer_id": int(cid), "net_value": round(valor, 2),
        "associated_documents": [{"associated_id": int(externo["externo_id"]), "value": round(valor, 2)}],
        "payments": [{"payment_method_id": _metodo(cfg, metodo), "date": data, "value": round(valor, 2)}],
        "status": 1,
    }, erro="O Moloni não emitiu o recibo")
    did = (j or {}).get("document_id")
    info = await _chamar(cfg, ctx, "documents/getOne", {"document_id": did}) if did else {}
    numero = (info or {}).get("number")
    return ResultadoEmissao(externo_id=str(did or ""), numero=f"{(info or {}).get('document_set_name') or ''}/{numero}".strip("/") if numero else "",
                            atcud=str((info or {}).get("atcud") or ""))


async def anular(cfg: dict, externo: dict, motivo: str, ctx: Optional[dict] = None) -> None:
    raise FaturacaoNaoSuportado("No Moloni um documento fechado anula-se (ou emite-se a nota de crédito) no próprio programa.")
