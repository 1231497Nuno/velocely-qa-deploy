"""TOConline — OAuth2 (authorization code) + API comercial.

Credenciais em TOConline → Empresa → Configurações → Dados API: client_id, client_secret, URL OAuth e URL da API.
O endereço de retorno (redirect) a registar lá é o mostrado nas Definições do ERP.
Documentos são criados já finalizados (`finalize: 1`) no endpoint /api/v1/commercial_sales_documents.
"""
from __future__ import annotations

import time
from typing import Any, Optional
from urllib.parse import urlencode

from app.services.faturacao.base import (
    NIF_CONSUMIDOR_FINAL, SAFT_METODO, FaturacaoErro, FaturacaoNaoSuportado, ResultadoEmissao, http, isento,
    linhas_para_emitir, mensagem_erro, nif_cliente, pais_iso,
)

TIPOS = {"fatura": "FT", "fatura_recibo": "FR", "fatura_simplificada": "FS"}


def _c(cfg: dict) -> dict:
    return cfg.get("toconline") or {}


def _limpar(url: str) -> str:
    return (url or "").strip().rstrip("/")


def url_autorizacao(cfg: dict, state: str) -> str:
    c = _c(cfg)
    if not (c.get("client_id") and c.get("oauth_url") and c.get("redirect_uri")):
        raise FaturacaoErro("Preencha o client ID, o URL OAuth e guarde antes de autorizar", 400)
    q = urlencode({"client_id": c["client_id"], "redirect_uri": c["redirect_uri"], "response_type": "code",
                   "scope": "commercial", "state": state})
    return f"{_limpar(c['oauth_url'])}/auth?{q}"


async def _token(cfg: dict, dados: dict) -> dict:
    c = _c(cfg)
    if not (c.get("client_id") and c.get("client_secret") and c.get("oauth_url")):
        raise FaturacaoErro("Faltam as credenciais do TOConline (client ID, segredo e URL OAuth)", 400)
    r = await http("POST", f"{_limpar(c['oauth_url'])}/token", data=dados,
                   auth=(c["client_id"], c["client_secret"]), headers={"Accept": "application/json"})
    if r.status_code >= 400:
        raise FaturacaoErro(mensagem_erro(r, "O TOConline recusou a autorização"), 400)
    j = r.json()
    if not j.get("access_token"):
        raise FaturacaoErro("O TOConline não devolveu o token de acesso", 400)
    return {
        "access_token": j["access_token"],
        "refresh_token": j.get("refresh_token") or c.get("refresh_token") or "",
        "expira_em": int(time.time()) + int(j.get("expires_in") or 3600) - 60,
    }


async def trocar_codigo(cfg: dict, code: str) -> dict:
    return await _token(cfg, {"grant_type": "authorization_code", "code": code, "redirect_uri": _c(cfg).get("redirect_uri") or "",
                              "scope": "commercial"})


async def _access(cfg: dict, ctx: dict) -> str:
    c = _c(cfg)
    if c.get("access_token") and int(c.get("expira_em") or 0) > time.time():
        return c["access_token"]
    if not c.get("refresh_token"):
        raise FaturacaoErro("O TOConline ainda não está autorizado — carregue em «Autorizar no TOConline»", 400)
    novos = await _token(cfg, {"grant_type": "refresh_token", "refresh_token": c["refresh_token"], "scope": "commercial"})
    await ctx["guardar_tokens"](novos)
    cfg["toconline"] = {**c, **novos}
    return novos["access_token"]


async def _pedido(cfg: dict, ctx: dict, metodo: str, caminho: str, *, json=None, params=None, jsonapi=False, erro="O TOConline recusou o pedido"):
    c = _c(cfg)
    if not c.get("api_url"):
        raise FaturacaoErro("Falta o URL da API do TOConline", 400)
    tipo = "application/vnd.api+json" if jsonapi else "application/json"
    headers = {"Authorization": f"Bearer {await _access(cfg, ctx)}", "Accept": tipo, "Content-Type": tipo}
    r = await http(metodo, f"{_limpar(c['api_url'])}{caminho}", headers=headers, json=json, params=params)
    if r.status_code == 401:
        raise FaturacaoErro("O TOConline recusou o acesso (401). Volte a autorizar nas Definições.", 400)
    if r.status_code >= 400:
        raise FaturacaoErro(mensagem_erro(r, erro))
    try:
        return r.json()
    except ValueError:
        return {}


def _attrs(o: Any) -> dict:
    """Aceita respostas JSON:API ({data:{id, attributes}}) ou JSON simples."""
    if isinstance(o, dict) and isinstance(o.get("data"), dict):
        o = o["data"]
    if isinstance(o, dict) and isinstance(o.get("attributes"), dict):
        return {"id": o.get("id"), **o["attributes"]}
    return o if isinstance(o, dict) else {}


async def testar(cfg: dict, ctx: dict) -> dict:
    j = await _pedido(cfg, ctx, "GET", "/api/commercial_document_series", jsonapi=True,
                      erro="Não foi possível ler as séries no TOConline")
    n = len(j.get("data") or []) if isinstance(j, dict) else 0
    return {"ok": True, "empresa": "", "series": n}


async def dados(cfg: dict, ctx: dict) -> dict:
    j = await _pedido(cfg, ctx, "GET", "/api/commercial_document_series", jsonapi=True,
                      erro="Não foi possível ler as séries no TOConline")
    series = []
    for s in (j.get("data") or []) if isinstance(j, dict) else []:
        a = _attrs(s)
        nome = a.get("prefix") or a.get("name") or a.get("description") or str(a.get("id"))
        tipo = a.get("document_type") or a.get("type") or ""
        series.append({"id": str(a.get("id")), "nome": f"{tipo} {nome}".strip(), "tipo": tipo})
    return {"series": series, "caes": [], "metodos": [], "impostos": []}


async def emitir(cfg: dict, doc: dict, cliente: dict, ctx: dict) -> ResultadoEmissao:
    tipo = TIPOS.get(doc.get("tipo"))
    if not tipo:
        raise FaturacaoErro(f"O TOConline não emite este tipo de documento ({doc.get('tipo')})", 400)
    anterior = doc.get("faturacao") or {}
    if anterior.get("externo_id") and anterior.get("fornecedor") == "toconline":
        # Já foi criado numa tentativa anterior: só falta ler o número
        j = await _pedido(cfg, ctx, "GET", f"/api/commercial_sales_documents/{anterior['externo_id']}", jsonapi=True,
                          erro="Não foi possível ler o documento no TOConline")
        return await _resultado(cfg, ctx, _attrs(j), anterior["externo_id"])
    nif = nif_cliente(cliente)
    linhas = []
    for l in linhas_para_emitir(doc):
        linha = {"description": l["descricao"], "quantity": l["quantidade"], "unit_price": l["preco_unit"],
                 "item_type": "Product"}
        if isento(ctx):
            linha["tax_code"] = "ISE"
            if cfg.get("toconline_motivo_isencao_id"):
                linha["tax_exemption_reason_id"] = cfg["toconline_motivo_isencao_id"]
        else:
            linha["tax_code"] = "NOR"
        linhas.append(linha)
    corpo = {
        "document_type": tipo,
        "date": doc.get("data"),
        "due_date": doc.get("data"),
        "finalize": 1,
        "customer_tax_registration_number": nif or NIF_CONSUMIDOR_FINAL,
        "customer_business_name": (cliente.get("nome") if nif else "Consumidor final") or "Consumidor final",
        "customer_address_detail": (cliente.get("morada") or "") if nif else "",
        "customer_postcode": (cliente.get("codigo_postal") or "") if nif else "",
        "customer_city": (cliente.get("cidade") or "") if nif else "",
        "customer_country": pais_iso(cliente.get("pais") or ""),
        "notes": (doc.get("notas") or "")[:500],
        "external_reference": (doc.get("referencia_cliente") or doc.get("encomenda_numero") or "")[:60],
        "lines": linhas,
    }
    serie = (cfg.get("series") or {}).get(doc["tipo"])
    if serie:
        corpo["commercial_document_series_id"] = serie
    if tipo == "FR":
        corpo["payment_mechanism"] = (cfg.get("metodos") or {}).get(doc.get("metodo_pagamento") or "") \
            or SAFT_METODO.get(doc.get("metodo_pagamento") or "", "OU")
    j = await _pedido(cfg, ctx, "POST", "/api/v1/commercial_sales_documents", json=corpo,
                      erro="O TOConline não aceitou o documento")
    a = _attrs(j)
    externo_id = str(a.get("id") or "")
    if not externo_id:
        raise FaturacaoErro("O TOConline não devolveu o identificador do documento")
    await ctx["guardar_parcial"]({"externo_id": externo_id})
    return await _resultado(cfg, ctx, a, externo_id)


async def _resultado(cfg: dict, ctx: dict, a: dict, externo_id: str) -> ResultadoEmissao:
    total = a.get("gross_total")
    try:
        total = float(total) if total not in (None, "") else None
    except (TypeError, ValueError):
        total = None
    res = ResultadoEmissao(
        externo_id=externo_id,
        numero=str(a.get("document_no") or a.get("document_number") or a.get("number") or ""),
        atcud=str(a.get("atcud") or ""),
        hash_curto=str(a.get("hash_control") or a.get("short_hash") or ""),
        estado_at="",
        total=total,
    )
    try:
        res.pdf_url = await pdf_url(cfg, {"externo_id": externo_id}, ctx)
    except FaturacaoErro:
        pass
    return res


async def pdf_url(cfg: dict, externo: dict, ctx: Optional[dict] = None) -> str:
    j = await _pedido(cfg, ctx or {}, "GET", f"/api/url_for_print/{externo['externo_id']}",
                      params={"filter[type]": "Document"}, jsonapi=True, erro="O TOConline não devolveu o PDF")
    a = _attrs(j)
    u = a.get("url") or {}
    if isinstance(u, str):
        return u
    if isinstance(u, dict) and u.get("host"):
        porta = f":{u['port']}" if u.get("port") and str(u["port"]) not in ("80", "443") else ""
        return f"{u.get('scheme') or 'https'}://{u['host']}{porta}{u.get('path') or ''}"
    return ""


async def registar_recebimento(cfg: dict, externo: dict, valor: float, metodo: str, data: str, ctx: dict) -> ResultadoEmissao:
    raise FaturacaoNaoSuportado(
        "O recibo desta fatura tem de ser emitido no TOConline. Para pagamentos já recebidos use a fatura-recibo."
    )


async def anular(cfg: dict, externo: dict, motivo: str, ctx: Optional[dict] = None) -> None:
    raise FaturacaoNaoSuportado(
        "No TOConline um documento finalizado anula-se (ou emite-se a nota de crédito) no próprio programa."
    )
