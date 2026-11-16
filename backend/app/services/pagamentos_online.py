"""Pagamentos online: referências Multibanco e pedidos MB WAY (ifthenpay ou Eupago).

Configuração em `integracoes` (id «pagamentos_online»). O fornecedor avisa por callback (URL pública) quando o cliente
paga; o pagamento entra na encomenda como um pagamento normal (recibo, alerta, autorização de produção).
"""
from __future__ import annotations

import asyncio
import secrets
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import encomendas_repo, integracoes_repo, pagamentos_online_repo

CFG_ID = "pagamentos_online"
DEFAULT = {"id": CFG_ID, "ativo": False, "fornecedor": "ifthenpay", "metodos": ["multibanco", "mbway"], "validade_dias": 5,
           "ifthenpay": {"mb_key": "", "mbway_key": "", "anti_phishing": ""},
           "eupago": {"api_key": "", "sandbox": True}}
SEGREDOS = {"ifthenpay": ("mb_key", "mbway_key", "anti_phishing"), "eupago": ("api_key",)}


class PagamentoErro(Exception):
    pass


async def get_config(publica: bool = False) -> dict:
    g = await integracoes_repo.get(CFG_ID) or {}
    cfg = {**DEFAULT, **{k: v for k, v in g.items() if k != "_id"}}
    for p in ("ifthenpay", "eupago"):
        cfg[p] = {**DEFAULT[p], **(g.get(p) or {})}
    if not cfg["ifthenpay"].get("anti_phishing"):
        # Chave do callback gerada uma vez e guardada
        cfg["ifthenpay"]["anti_phishing"] = secrets.token_hex(12)
        await integracoes_repo.update_where({"id": CFG_ID}, {"id": CFG_ID, "ifthenpay": cfg["ifthenpay"]}, upsert=True)
    if publica:
        for p, campos in SEGREDOS.items():
            for c in campos:
                v = cfg[p].get(c) or ""
                cfg[p][c] = ("•••• " + v[-4:]) if v and c != "anti_phishing" else v
    return cfg


async def guardar_config(dados: dict) -> dict:
    atual = await get_config()
    patch: Dict[str, Any] = {"ativo": bool(dados.get("ativo")),
                             "fornecedor": dados.get("fornecedor") if dados.get("fornecedor") in ("ifthenpay", "eupago") else "ifthenpay",
                             "metodos": [m for m in dados.get("metodos") or [] if m in ("multibanco", "mbway")] or ["multibanco"],
                             "validade_dias": max(1, min(60, int(dados.get("validade_dias") or 5)))}
    for p in ("ifthenpay", "eupago"):
        novo = dict(atual[p])
        for k, v in (dados.get(p) or {}).items():
            if k in novo and not (isinstance(v, str) and v.startswith("•••• ")):
                novo[k] = v.strip() if isinstance(v, str) else v
        patch[p] = novo
    await integracoes_repo.update_where({"id": CFG_ID}, {"id": CFG_ID, **patch}, upsert=True)
    return await get_config(publica=True)


def _url_publica(caminho: str) -> str:
    import os
    base = (os.environ.get("BACKEND_PUBLIC_URL") or os.environ.get("FRONTEND_URL") or os.environ.get("APP_URL") or "").rstrip("/")
    return f"{base}{caminho}"


async def _http(metodo: str, url: str, **kw):
    import requests

    def _f():
        return requests.request(metodo, url, timeout=25, **kw)
    try:
        return await asyncio.to_thread(_f)
    except requests.RequestException as ex:
        raise PagamentoErro(f"Não foi possível ligar ao serviço de pagamentos ({ex.__class__.__name__})")


def _json(r) -> dict:
    try:
        return r.json() if r.content else {}
    except ValueError:
        return {}


# ---------------------------------------------------------------------------
# Fornecedores
# ---------------------------------------------------------------------------
async def _ifthenpay(cfg: dict, metodo: str, pedido: dict, telemovel: str) -> dict:
    c = cfg["ifthenpay"]
    if metodo == "multibanco":
        if not c.get("mb_key"):
            raise PagamentoErro("Falta a chave Multibanco do ifthenpay")
        r = await _http("POST", "https://api.ifthenpay.com/multibanco/reference/init", json={
            "mbKey": c["mb_key"], "orderId": pedido["order_id"], "amount": f"{pedido['valor']:.2f}",
            "description": pedido["descricao"][:200], "expiryDays": cfg.get("validade_dias") or 5})
        j = _json(r)
        if r.status_code >= 400 or str(j.get("Status")) not in ("0", "None") and not j.get("Reference"):
            raise PagamentoErro(f"ifthenpay recusou a referência: {j.get('Message') or r.status_code}")
        return {"entidade": j.get("Entity"), "referencia": j.get("Reference"), "expira": j.get("ExpiryDate"),
                "externo_id": j.get("RequestId")}
    if not c.get("mbway_key"):
        raise PagamentoErro("Falta a chave MB WAY do ifthenpay")
    r = await _http("POST", "https://api.ifthenpay.com/spg/payment/mbway", json={
        "mbWayKey": c["mbway_key"], "orderId": pedido["order_id"], "amount": f"{pedido['valor']:.2f}",
        "mobileNumber": f"351#{telemovel}", "description": pedido["descricao"][:100]})
    j = _json(r)
    if r.status_code >= 400 or str(j.get("Status")) not in ("000", "0"):
        raise PagamentoErro(f"MB WAY recusado: {j.get('Message') or r.status_code}")
    return {"externo_id": j.get("RequestId"), "telemovel": telemovel}


async def _eupago(cfg: dict, metodo: str, pedido: dict, telemovel: str) -> dict:
    c = cfg["eupago"]
    if not c.get("api_key"):
        raise PagamentoErro("Falta a API key da Eupago")
    base = "https://sandbox.eupago.pt" if c.get("sandbox") else "https://clientes.eupago.pt"
    if metodo == "multibanco":
        r = await _http("POST", f"{base}/clientes/rest_api/multibanco/create", data={
            "chave": c["api_key"], "valor": f"{pedido['valor']:.2f}", "id": pedido["order_id"], "per_dup": 0})
        j = _json(r)
        if not j.get("sucesso"):
            raise PagamentoErro(f"Eupago recusou a referência: {j.get('resposta') or r.status_code}")
        return {"entidade": j.get("entidade"), "referencia": j.get("referencia"), "externo_id": str(j.get("referencia"))}
    r = await _http("POST", f"{base}/clientes/rest_api/mbway/create", data={
        "chave": c["api_key"], "valor": f"{pedido['valor']:.2f}", "id": pedido["order_id"], "alias": telemovel,
        "descricao": pedido["descricao"][:50]})
    j = _json(r)
    if not j.get("sucesso"):
        raise PagamentoErro(f"MB WAY recusado: {j.get('resposta') or r.status_code}")
    return {"externo_id": str(j.get("referencia")), "telemovel": telemovel}


# ---------------------------------------------------------------------------
# Pedidos e confirmação
# ---------------------------------------------------------------------------
async def pedir(encomenda_id: str, metodo: str, telemovel: str = "", valor: Optional[float] = None) -> dict:
    from app.services.costing import compute_encomenda
    cfg = await get_config()
    if not cfg.get("ativo"):
        raise HTTPException(400, "Pagamentos online não estão ativos (Definições → Integrações)")
    if metodo not in cfg.get("metodos") or []:
        raise HTTPException(400, "Método de pagamento não disponível")
    enc = await encomendas_repo.get(encomenda_id)
    if not enc or enc.get("estado") == "cancelada":
        raise HTTPException(404, "Encomenda não encontrada")
    calc = await compute_encomenda(dict(enc))
    pendente = round2(float(calc.get("valor_pendente") or 0))
    valor = round2(min(float(valor or pendente), pendente))
    if valor <= 0:
        raise HTTPException(400, "A encomenda já está paga")
    telemovel = "".join(ch for ch in (telemovel or "") if ch.isdigit())[-9:]
    if metodo == "mbway" and len(telemovel) != 9:
        raise HTTPException(400, "Indique o número de telemóvel MB WAY (9 dígitos)")
    # Reutiliza referência Multibanco pendente com o mesmo valor
    if metodo == "multibanco":
        ja = await pagamentos_online_repo.find_one({"encomenda_id": encomenda_id, "metodo": "multibanco", "estado": "pendente",
                                                    "valor": valor})
        if ja:
            return ja
    order_id = f"{(enc.get('numero') or 'ENC').replace('/', '')[-10:]}{secrets.token_hex(2)}".upper()[:15]
    pedido = {"order_id": order_id, "valor": valor, "descricao": f"Encomenda {enc.get('numero')}"}
    try:
        dados = await (_ifthenpay if cfg["fornecedor"] == "ifthenpay" else _eupago)(cfg, metodo, pedido, telemovel)
    except PagamentoErro as ex:
        raise HTTPException(502, str(ex))
    doc = {"id": new_id(), "encomenda_id": encomenda_id, "encomenda_numero": enc.get("numero"), "metodo": metodo,
           "fornecedor": cfg["fornecedor"], "order_id": order_id, "valor": valor, "estado": "pendente", **dados,
           "created_at": now_iso()}
    await pagamentos_online_repo.insert(doc)
    return doc


async def confirmar(fornecedor: str, params: dict) -> dict:
    """Callback do fornecedor: valida e regista o pagamento na encomenda (idempotente)."""
    cfg = await get_config()
    if fornecedor == "ifthenpay":
        if not secrets.compare_digest(str(params.get("key") or params.get("chave") or ""), cfg["ifthenpay"]["anti_phishing"]):
            raise HTTPException(403, "Chave inválida")
        order_id = params.get("orderId") or params.get("id") or ""
        ref = params.get("referencia") or params.get("reference")
        valor = float(str(params.get("valor") or params.get("amount") or "0").replace(",", "."))
    else:
        order_id = params.get("identificador") or ""
        ref = params.get("referencia")
        valor = float(str(params.get("valor") or "0").replace(",", "."))
    q = {"order_id": order_id} if order_id else {"referencia": ref}
    p = await pagamentos_online_repo.find_one(q) if (order_id or ref) else None
    if not p:
        raise HTTPException(404, "Pagamento desconhecido")
    if fornecedor == "eupago" and cfg["eupago"].get("api_key") and params.get("chave_api") and \
            not secrets.compare_digest(str(params.get("chave_api")), cfg["eupago"]["api_key"]):
        raise HTTPException(403, "Chave inválida")
    if p.get("estado") == "pago":
        return {"ok": True, "duplicado": True}
    if valor and abs(valor - float(p["valor"])) > 0.01:
        raise HTTPException(400, "Valor não confere")
    await registar_pagamento(p, "Multibanco" if p["metodo"] == "multibanco" else "MB WAY")
    return {"ok": True}


async def registar_pagamento(p: dict, origem_txt: str) -> None:
    from app.domain.models import Pagamento
    from app.core.database import next_sequence
    from app.services import workflow
    from app.services.costing import compute_encomenda, soma_valor_pago
    enc = await encomendas_repo.get(p["encomenda_id"])
    if not enc:
        return
    status_antes = (await compute_encomenda(dict(enc))).get("status_pagamento")
    pag = Pagamento(valor=round2(p["valor"]), metodo="multibanco" if p["metodo"] == "multibanco" else "mbway",
                    nota=f"Pagamento online {p['order_id']}", data=now_iso()[:10], origem="online")
    pag.recibo_numero = await next_sequence("REC")
    pagamentos = (enc.get("pagamentos") or []) + [pag.model_dump()]
    await encomendas_repo.update(enc["id"], {"pagamentos": pagamentos, "valor_pago": soma_valor_pago(pagamentos)})
    await pagamentos_online_repo.update(p["id"], {"estado": "pago", "pago_at": now_iso(), "recibo_numero": pag.recibo_numero})
    from app.services import audit
    await audit.registar("encomenda", enc["id"], "pagamento", {"id": "sistema", "name": "Pagamento online"},
                         f"Pagamento {origem_txt} de {pag.valor:.2f}€ na encomenda {enc.get('numero')} · recibo {pag.recibo_numero}",
                         enc.get("numero"))
    await workflow.evento("pagamento_online", f"Pago por {origem_txt}: {enc.get('numero')} ({pag.valor:.2f} €)",
                          enc.get("cliente") or "", link=f"/encomendas/{enc['id']}", entidade="encomenda", entidade_id=enc["id"])
    await workflow.apos_pagamento(enc["id"], status_antes, pag.valor, origem=f"{origem_txt} · {pag.recibo_numero}")


def url_callback(fornecedor: str, cfg: dict) -> str:
    if fornecedor == "ifthenpay":
        return _url_publica(f"/api/publico/pagamentos/ifthenpay?key={cfg['ifthenpay']['anti_phishing']}"
                            "&orderId=[ORDER_ID]&valor=[AMOUNT]&referencia=[REFERENCE]")
    return _url_publica("/api/publico/pagamentos/eupago")
