"""FIZ (fiz.co) — API REST com chave (`x-api-key`). Documentos criados em rascunho e emitidos com /issue.

Atenção: a FIZ não tem ambiente de testes — tudo o que é emitido é real e comunicado à AT.
"""
from __future__ import annotations

import hashlib
from typing import Optional

from app.services.faturacao.base import (
    FaturacaoErro, ResultadoEmissao, http, isento, linhas_para_emitir, mensagem_erro, nif_cliente, pais_iso,
)

BASE = "https://api.fiz.co"
TIPOS = {"fatura": "INVOICE", "fatura_recibo": "INVOICE_RECEIPT", "fatura_simplificada": "SIMPLIFIED_INVOICE"}
METODOS = {
    "numerario": "cash", "cartao": "card", "transferencia": "bankTransfer", "mbway": "mbWay",
    "multibanco": "multibanco", "cheque": "other", "outro": "other",
}


def _chave(cfg: dict) -> str:
    k = ((cfg.get("fiz") or {}).get("api_key") or "").strip()
    if not k:
        raise FaturacaoErro("Falta a chave da API da FIZ (Definições → Integrações → Faturação)", 400)
    return k


def _headers(cfg: dict, idem: Optional[str] = None) -> dict:
    h = {"x-api-key": _chave(cfg), "Accept": "application/json", "Content-Type": "application/json"}
    if idem:
        h["Idempotency-Key"] = idem
    return h


async def _pedido(cfg: dict, metodo: str, caminho: str, *, json=None, params=None, idem: Optional[str] = None, erro: str = "A FIZ recusou o pedido"):
    r = await http(metodo, f"{BASE}{caminho}", headers=_headers(cfg, idem), json=json, params=params)
    if r.status_code == 401:
        raise FaturacaoErro("A FIZ recusou a chave da API (401). Confirme a chave em Definições → Integrações.", 400)
    if r.status_code >= 400:
        raise FaturacaoErro(mensagem_erro(r, erro))
    try:
        j = r.json()
    except ValueError:
        return {}
    return j.get("data", j) if isinstance(j, dict) and isinstance(j.get("data"), (dict, list)) else j


def _lista(j) -> list:
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        for k in ("items", "results", "series", "customers", "data"):
            if isinstance(j.get(k), list):
                return j[k]
    return []


async def testar(cfg: dict, ctx: Optional[dict] = None) -> dict:
    emp = await _pedido(cfg, "GET", "/company", erro="Não foi possível ler a empresa na FIZ")
    nome = (emp or {}).get("name") or (emp or {}).get("companyName") or ""
    return {"ok": True, "empresa": nome, "nif": (emp or {}).get("taxpayerNumber") or (emp or {}).get("nif") or ""}


async def dados(cfg: dict, ctx: Optional[dict] = None) -> dict:
    series = []
    for s in _lista(await _pedido(cfg, "GET", "/series", erro="Não foi possível ler as séries")):
        series.append({
            "id": str(s.get("id")),
            "nome": s.get("name") or s.get("code") or s.get("prefix") or str(s.get("id")),
            "tipo": s.get("documentType") or s.get("type") or "",
        })
    caes = []
    try:
        for t in _lista(await _pedido(cfg, "GET", "/templates")):
            if t.get("cae") or t.get("code"):
                caes.append({"id": str(t.get("cae") or t.get("code")), "nome": t.get("name") or t.get("description") or ""})
    except FaturacaoErro:
        pass
    return {"series": series, "caes": caes, "metodos": [], "impostos": []}


async def _cliente(cfg: dict, cliente: dict, ctx: dict) -> str:
    nif = nif_cliente(cliente)
    chave = f"fiz:cliente:{nif or 'consumidor-final'}"
    em_cache = await ctx["cache_get"](chave)
    if em_cache:
        return em_cache
    if nif:
        for c in _lista(await _pedido(cfg, "GET", "/customers", params={"search": nif})):
            if str(c.get("taxpayerNumber") or "") == nif and c.get("id"):
                await ctx["cache_set"](chave, str(c["id"]))
                return str(c["id"])
    corpo = {"name": (cliente.get("nome") or "Consumidor final")[:100] if nif else "Consumidor final"}
    if nif:
        corpo.update({k: v for k, v in {
            "taxpayerNumber": nif,
            "email": (cliente.get("email") or "").strip(),
            "address": (cliente.get("morada") or "").strip(),
            "city": (cliente.get("cidade") or "").strip(),
            "postalCode": (cliente.get("codigo_postal") or "").strip(),
            "country": pais_iso(cliente.get("pais") or ""),
        }.items() if v})
    novo = await _pedido(cfg, "POST", "/customers", json=corpo, erro="A FIZ não aceitou o cliente")
    cid = str((novo or {}).get("id") or "")
    if not cid:
        raise FaturacaoErro("A FIZ não devolveu o identificador do cliente")
    await ctx["cache_set"](chave, cid)
    return cid


async def _artigo(cfg: dict, linha: dict, ctx: dict) -> str:
    vat = "EXEMPT" if isento(ctx) else "NORMAL"
    base = f"{linha['descricao']}|{linha['preco_unit']:.4f}|{vat}|{cfg.get('motivo_isencao') or ''}"
    chave = "fiz:artigo:" + hashlib.sha1(base.encode("utf-8")).hexdigest()
    em_cache = await ctx["cache_get"](chave)
    if em_cache:
        return em_cache
    corpo = {"name": linha["descricao"][:120], "type": "PRODUCT", "unitPrice": linha["preco_unit"], "vatRate": vat}
    if vat == "EXEMPT":
        corpo["vatExemptionReason"] = cfg.get("motivo_isencao") or "M10"
    novo = await _pedido(cfg, "POST", "/items", json=corpo, erro="A FIZ não aceitou o artigo")
    aid = str((novo or {}).get("id") or "")
    if not aid:
        raise FaturacaoErro("A FIZ não devolveu o identificador do artigo")
    await ctx["cache_set"](chave, aid)
    return aid


def _resultado(j: dict, externo_id: str) -> ResultadoEmissao:
    sync = (j or {}).get("syncWithAt") or {}
    est = {"SYNCED": "comunicado", "PROCESSING": "pendente", "FAILED": "erro"}.get(str(sync.get("status") or "").upper(), "")
    return ResultadoEmissao(
        externo_id=externo_id,
        numero=str(j.get("number") or j.get("documentNumber") or ""),
        atcud=str(j.get("atcud") or ""),
        hash_curto=str(j.get("shortHash") or ""),
        estado_at=est,
        mensagem_at=str(sync.get("atMessage") or ""),
        total=float(j["total"]) if isinstance(j.get("total"), (int, float)) else None,
    )


async def _nota_credito(cfg: dict, doc: dict, ctx: dict) -> ResultadoEmissao:
    mae = ctx.get("fatura_origem") or {}
    if not mae.get("externo_id"):
        raise FaturacaoErro("A fatura original não está na FIZ", 400)
    j = await _pedido(cfg, "POST", "/invoices/credit-notes",
                      json={"parentInvoiceId": mae["externo_id"], "reason": (doc.get("motivo") or "Devolução")[:200], "issue": True},
                      idem=f"{doc['id']}-nc", erro="A FIZ não emitiu a nota de crédito")
    res = _resultado(j or {}, str((j or {}).get("id") or ""))
    try:
        res.pdf_url = await pdf_url(cfg, {"externo_id": res.externo_id})
    except FaturacaoErro:
        pass
    return res


async def emitir(cfg: dict, doc: dict, cliente: dict, ctx: dict) -> ResultadoEmissao:
    if doc.get("tipo") == "nota_credito":
        return await _nota_credito(cfg, doc, ctx)
    tipo = TIPOS.get(doc.get("tipo"))
    if not tipo:
        raise FaturacaoErro(f"A FIZ não emite este tipo de documento ({doc.get('tipo')})", 400)
    if not (cfg.get("cae") or "").strip():
        raise FaturacaoErro("Indique o CAE da empresa nas definições da faturação (obrigatório na FIZ)", 400)
    externo_id = ((doc.get("faturacao") or {}).get("externo_id") or "")
    if not externo_id:
        cid = await _cliente(cfg, cliente, ctx)
        itens = []
        for l in linhas_para_emitir(doc):
            itens.append({"id": await _artigo(cfg, l, ctx), "quantity": l["quantidade"]})
        corpo = {"cae": cfg["cae"].strip(), "type": tipo, "customerId": cid, "items": itens, "date": doc.get("data")}
        if doc.get("notas"):
            corpo["notes"] = doc["notas"][:500]
        serie = (cfg.get("series") or {}).get(doc["tipo"])
        if serie:
            corpo["seriesId"] = serie
        if tipo == "INVOICE_RECEIPT":
            corpo["payment"] = {"method": METODOS.get(doc.get("metodo_pagamento") or "", "other"), "date": doc.get("data")}
        criado = await _pedido(cfg, "POST", "/invoices", json=corpo, idem=f"{doc['id']}-criar", erro="A FIZ não aceitou o documento")
        externo_id = str((criado or {}).get("id") or "")
        if not externo_id:
            raise FaturacaoErro("A FIZ não devolveu o identificador do documento")
        await ctx["guardar_parcial"]({"externo_id": externo_id, "extra": {"cliente_id": cid}})
    emitido = await _pedido(cfg, "POST", f"/invoices/{externo_id}/issue", idem=f"{doc['id']}-emitir", erro="A FIZ não emitiu o documento")
    res = _resultado(emitido or {}, externo_id)
    try:
        res.pdf_url = await pdf_url(cfg, {"externo_id": externo_id})
    except FaturacaoErro:
        pass
    return res


async def pdf_url(cfg: dict, externo: dict, ctx: Optional[dict] = None) -> str:
    j = await _pedido(cfg, "GET", f"/invoices/{externo['externo_id']}/pdf", erro="A FIZ não devolveu o PDF")
    return str((j or {}).get("url") or "")


async def registar_recebimento(cfg: dict, externo: dict, valor: float, metodo: str, data: str, ctx: dict) -> ResultadoEmissao:
    j = await _pedido(
        cfg, "POST", f"/invoices/{externo['externo_id']}/pay",
        json={"method": METODOS.get(metodo or "", "other"), "date": data, "amount": round(valor, 2)},
        idem=f"{externo['externo_id']}-pay-{data}-{valor:.2f}", erro="A FIZ não registou o recebimento",
    )
    rec = (j or {}).get("receipt") or j or {}
    return _resultado(rec, str(rec.get("id") or ""))


async def anular(cfg: dict, externo: dict, motivo: str, ctx: Optional[dict] = None) -> None:
    await _pedido(cfg, "POST", f"/invoices/{externo['externo_id']}/cancel", json={"reason": (motivo or "Anulado")[:200]},
                  erro="A FIZ não anulou o documento")
