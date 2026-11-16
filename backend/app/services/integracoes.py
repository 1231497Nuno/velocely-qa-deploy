"""Integração com o site (WordPress / WooCommerce).

- Encomendas da loja online → encomendas do ERP (webhook do WooCommerce ou importação manual).
- Pedidos de orçamento / contacto do site → leads do CRM (endpoint com token).

As credenciais ficam na coleção `integracoes` e nunca são devolvidas por inteiro ao browser.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import re
import secrets
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.core.database import new_id, next_sequence, now_iso, round2
from app.domain.models import Encomenda, Pagamento
from app.repositories import (
    artigos_repo, clientes_repo, crm_estados_repo, encomendas_repo, integracoes_repo, leads_repo,
)
from app.services import audit
from app.services.costing import soma_valor_pago
from app.services.numeracao import next_codigo

WOO_ID = "woocommerce"
SITE_ID = "site"

# Estados WooCommerce: processing = pago (a preparar); on-hold = à espera de pagamento (ex.: transferência)
WOO_ESTADOS_PAGOS = ("processing", "completed")
WOO_ESTADOS_DEFAULT = ["processing", "completed", "on-hold"]
WOO_ESTADOS_CANCELADOS = ("cancelled", "refunded", "failed")

WOO_DEFAULT = {
    "id": WOO_ID,
    "ativo": False,
    "url": "",
    "consumer_key": "",
    "consumer_secret": "",
    "webhook_secret": "",
    "estados_importar": WOO_ESTADOS_DEFAULT,
    "criar_clientes": True,
    "ultima_sincronizacao": None,
    "ultimo_pedido": None,
    "ultimo_erro": "",
}
SITE_DEFAULT = {"id": SITE_ID, "ativo": False, "token": "", "origem": "Site", "ultimo_pedido": None}

SYSTEM_USER = {"id": None, "nome": "Loja online", "email": ""}


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------
def _mascarar(v: str) -> str:
    v = v or ""
    return "" if not v else ("•" * 6 + v[-4:])


async def get_woo(raw: bool = False) -> dict:
    cfg = {**WOO_DEFAULT, **(await integracoes_repo.get(WOO_ID) or {})}
    if raw:
        return cfg
    out = {k: v for k, v in cfg.items() if k not in ("consumer_secret", "webhook_secret", "consumer_key", "_id")}
    out["consumer_key_mask"] = _mascarar(cfg.get("consumer_key"))
    out["consumer_secret_definido"] = bool(cfg.get("consumer_secret"))
    out["webhook_secret_mask"] = _mascarar(cfg.get("webhook_secret"))
    out["webhook_secret_definido"] = bool(cfg.get("webhook_secret"))
    return out


async def get_site(raw: bool = False) -> dict:
    cfg = {**SITE_DEFAULT, **(await integracoes_repo.get(SITE_ID) or {})}
    if not raw:
        cfg = {k: v for k, v in cfg.items() if k != "_id"}
    return cfg


async def guardar_woo(dados: dict) -> dict:
    atual = await get_woo(raw=True)
    novo = dict(atual)
    if "url" in dados:
        url = (dados.get("url") or "").strip().rstrip("/")
        if url and not re.match(r"^https://", url):
            raise HTTPException(400, "O endereço do site tem de começar por https://")
        novo["url"] = url
    for k in ("consumer_key", "consumer_secret", "webhook_secret"):
        v = (dados.get(k) or "").strip()
        if v and not v.startswith("•"):
            novo[k] = v  # só substitui quando vem um valor novo
    if "ativo" in dados:
        novo["ativo"] = bool(dados.get("ativo"))
    if "criar_clientes" in dados:
        novo["criar_clientes"] = bool(dados.get("criar_clientes"))
    if dados.get("estados_importar") is not None:
        validos = {"pending", "processing", "on-hold", "completed"}
        est = [e for e in dados["estados_importar"] if e in validos]
        if not est:
            raise HTTPException(400, "Escolha pelo menos um estado de encomenda a importar")
        novo["estados_importar"] = est
    if novo.get("ativo") and not novo.get("webhook_secret"):
        novo["webhook_secret"] = secrets.token_urlsafe(24)
    await integracoes_repo.update_where({"id": WOO_ID}, novo, upsert=True)
    return await get_woo()


async def gerar_segredo_woo() -> str:
    cfg = await get_woo(raw=True)
    cfg["webhook_secret"] = secrets.token_urlsafe(24)
    await integracoes_repo.update_where({"id": WOO_ID}, cfg, upsert=True)
    return cfg["webhook_secret"]


async def guardar_site(dados: dict) -> dict:
    cfg = await get_site(raw=True)
    if "ativo" in dados:
        cfg["ativo"] = bool(dados.get("ativo"))
    if "origem" in dados:
        cfg["origem"] = (dados.get("origem") or "Site").strip()[:40] or "Site"
    if dados.get("novo_token") or (cfg.get("ativo") and not cfg.get("token")):
        cfg["token"] = secrets.token_urlsafe(24)
    await integracoes_repo.update_where({"id": SITE_ID}, cfg, upsert=True)
    return await get_site()


# ---------------------------------------------------------------------------
# WooCommerce: assinatura do webhook e API REST
# ---------------------------------------------------------------------------
def assinatura_valida(corpo: bytes, assinatura: str, segredo: str) -> bool:
    if not segredo or not assinatura:
        return False
    calc = base64.b64encode(hmac.new(segredo.encode("utf-8"), corpo, hashlib.sha256).digest()).decode()
    return hmac.compare_digest(calc, assinatura.strip())


def _woo_get(cfg: dict, caminho: str, params: Optional[dict] = None):
    import requests
    if not cfg.get("url") or not cfg.get("consumer_key") or not cfg.get("consumer_secret"):
        raise HTTPException(400, "Preencha o endereço do site e as chaves da API do WooCommerce")
    try:
        r = requests.get(
            f"{cfg['url']}/wp-json/wc/v3/{caminho.lstrip('/')}",
            params=params or {},
            auth=(cfg["consumer_key"], cfg["consumer_secret"]),
            timeout=25,
            headers={"User-Agent": "Velocely-ERP/1.0"},
        )
    except requests.RequestException as ex:
        raise HTTPException(502, f"Não foi possível ligar ao site: {ex.__class__.__name__}")
    if r.status_code == 401:
        raise HTTPException(400, "O site recusou as chaves da API (401). Confirme a chave e o segredo, com permissão de leitura.")
    if r.status_code == 404:
        raise HTTPException(400, "Não encontrei a API do WooCommerce neste endereço (404). Confirme o URL do site.")
    if r.status_code >= 400:
        raise HTTPException(502, f"O site respondeu com erro {r.status_code}")
    return r.json(), r.headers


async def testar_woo() -> dict:
    cfg = await get_woo(raw=True)
    pedidos, headers = _woo_get(cfg, "orders", {"per_page": 1})
    total = headers.get("X-WP-Total")
    ultimo = pedidos[0] if pedidos else None
    return {
        "ok": True,
        "total_encomendas": int(total) if total and str(total).isdigit() else None,
        "ultima": {"numero": ultimo.get("number"), "data": (ultimo.get("date_created") or "")[:10],
                   "estado": ultimo.get("status")} if ultimo else None,
    }


async def sincronizar_woo(desde: Optional[str], user: dict) -> dict:
    """Importa da loja as encomendas desde uma data (as que já existem são atualizadas)."""
    cfg = await get_woo(raw=True)
    params: Dict[str, Any] = {"per_page": 50, "orderby": "date", "order": "asc"}
    if desde:
        params["after"] = f"{desde[:10]}T00:00:00"
    resumo = {"criadas": 0, "atualizadas": 0, "ignoradas": 0, "erros": []}
    pagina = 1
    while pagina <= 40:  # até 2000 encomendas por importação
        params["page"] = pagina
        pedidos, headers = _woo_get(cfg, "orders", params)
        if not pedidos:
            break
        for o in pedidos:
            try:
                acao, _enc = await importar_pedido_woo(o, user=user, cfg=cfg)
                resumo[{"criada": "criadas", "atualizada": "atualizadas"}.get(acao, "ignoradas")] += 1
            except HTTPException as ex:
                resumo["erros"].append(f"#{o.get('number')}: {ex.detail}")
        total_paginas = int(headers.get("X-WP-TotalPages") or 1)
        if pagina >= total_paginas:
            break
        pagina += 1
    cfg["ultima_sincronizacao"] = now_iso()
    cfg["ultimo_erro"] = "; ".join(resumo["erros"][:3])
    await integracoes_repo.update_where({"id": WOO_ID}, cfg, upsert=True)
    return resumo


# ---------------------------------------------------------------------------
# WooCommerce: pedido → encomenda
# ---------------------------------------------------------------------------
METODO_WOO = [
    (r"mbway|mb_way|mb-way", "mbway"),
    (r"multibanco|mb_ref|ifthenpay_mb|eupago_mb|_mb$", "multibanco"),
    (r"bacs|transfer", "transferencia"),
    (r"cod|cash|dinheiro|pagamento_na_loja|local", "numerario"),
    (r"cheque", "cheque"),
    (r"stripe|card|cartao|credit|paypal|redsys|apple|google|klarna", "cartao"),
]


def metodo_pagamento_woo(o: dict) -> str:
    chave = f"{o.get('payment_method') or ''} {o.get('payment_method_title') or ''}".lower()
    for padrao, metodo in METODO_WOO:
        if re.search(padrao, chave):
            return metodo
    return "outro"


def _meta(o: dict, *chaves: str) -> str:
    for m in o.get("meta_data") or []:
        if (m.get("key") or "").lower().lstrip("_") in chaves and m.get("value"):
            return str(m.get("value")).strip()
    return ""


def _nif_woo(o: dict) -> str:
    nif = _meta(o, "billing_nif", "billing_vat", "vat_number", "nif", "billing_nif_pt", "wcpfc_nif")
    nif = re.sub(r"\D", "", nif)
    return nif if len(nif) == 9 else ""


def _morada(b: dict) -> Tuple[str, str, str, str]:
    linha = ", ".join(x for x in (b.get("address_1"), b.get("address_2")) if x)
    return linha, (b.get("postcode") or "").strip(), (b.get("city") or "").strip(), (b.get("country") or "PT").strip()


def _pais(c: str) -> str:
    return {"PT": "Portugal", "ES": "Espanha", "FR": "França"}.get((c or "").upper(), c or "Portugal")


async def _cliente_do_pedido(o: dict, criar: bool) -> Optional[dict]:
    b = o.get("billing") or {}
    email = (b.get("email") or "").strip().lower()
    nif = _nif_woo(o)
    cli = None
    if nif:
        cli = await clientes_repo.find_one({"nif": nif})
    if not cli and email:
        cli = await clientes_repo.find_one({"email": email})
    if cli or not criar:
        return cli
    nome_pessoa = " ".join(x for x in ((b.get("first_name") or "").strip(), (b.get("last_name") or "").strip()) if x)
    empresa = (b.get("company") or "").strip()
    morada, cp, cidade, pais = _morada(b)
    doc = {
        "id": new_id(),
        "codigo": await next_codigo("cliente"),
        "nome": empresa or nome_pessoa or email or "Cliente loja online",
        "tipo": "empresa" if (empresa and nif) else "particular",
        "morada": morada, "codigo_postal": cp, "cidade": cidade, "pais": _pais(pais),
        "contacto": re.sub(r"[^\d+]", "", b.get("phone") or ""),
        "email": email,
        "nif": nif or None,
        "notas": "Criado automaticamente a partir da loja online",
        "contactos": [],
        "campos_extra": {},
        "created_at": now_iso(),
    }
    if empresa and nome_pessoa:
        doc["contactos"] = [{"id": new_id(), "nome": nome_pessoa, "email": email, "telefone": doc["contacto"],
                             "cargo": "", "departamento": "", "papeis": ["decisor"], "notas": "", "ativo": True,
                             "user_id": None, "portal_ativo": False}]
    await clientes_repo.insert(doc)
    return doc


async def _artigo_por_sku(sku: str) -> Optional[dict]:
    sku = (sku or "").strip()
    if not sku:
        return None
    for campo in ("codigo", "codigo_produto", "cod_fabricante", "cod_fornecedor"):
        a = await artigos_repo.find_one({campo: sku})
        if a:
            return a
    return None


def _observacoes_item(it: dict) -> str:
    partes = []
    for m in it.get("meta_data") or []:
        k = str(m.get("display_key") or m.get("key") or "").strip()
        v = m.get("display_value") if m.get("display_value") is not None else m.get("value")
        if not k or k.startswith("_") or isinstance(v, (dict, list)):
            continue
        v = re.sub(r"<[^>]+>", "", str(v)).strip()
        if v:
            partes.append(f"{k}: {v}")
    return " · ".join(partes)[:500]


def _obs_linha(it: dict, art: Optional[dict]) -> str:
    obs = _observacoes_item(it)
    nome_loja = (it.get("name") or "").strip()
    if art and nome_loja and nome_loja != (art.get("nome") or ""):
        obs = " · ".join(x for x in (nome_loja, obs) if x)
    return obs


async def _linhas_do_pedido(o: dict) -> List[dict]:
    linhas = []
    for it in o.get("line_items") or []:
        qtd = float(it.get("quantity") or 0) or 1.0
        bruto = float(it.get("total") or 0) + float(it.get("total_tax") or 0)
        art = await _artigo_por_sku(it.get("sku"))
        linhas.append({
            "id": new_id(),
            "artigo_id": art.get("id") if art else None,
            "artigo_nome": (art or {}).get("nome") or it.get("name") or "Artigo da loja",
            "artigo_codigo": (art or {}).get("codigo") or (it.get("sku") or ""),
            "imagem": (art or {}).get("imagem") or "",
            "quantidade": qtd,
            "preco_unit": round2(bruto / qtd),
            "desconto": 0.0,
            "desconto_tipo": "pct",
            "personalizacoes": [],
            "observacoes": _obs_linha(it, art),
        })
    for f in o.get("fee_lines") or []:
        v = float(f.get("total") or 0) + float(f.get("total_tax") or 0)
        if abs(v) > 0.004:
            linhas.append({"id": new_id(), "artigo_id": None, "artigo_nome": f.get("name") or "Taxa",
                           "quantidade": 1, "preco_unit": round2(v), "desconto": 0.0, "desconto_tipo": "pct",
                           "personalizacoes": [], "observacoes": ""})
    return linhas


def _notas_pedido(o: dict) -> str:
    partes = []
    if (o.get("customer_note") or "").strip():
        partes.append(f"Nota do cliente: {o['customer_note'].strip()}")
    s = o.get("shipping") or {}
    morada, cp, cidade, _ = _morada(s)
    if morada:
        nome = " ".join(x for x in (s.get("first_name"), s.get("last_name")) if x)
        partes.append(f"Entregar a: {nome} — {morada}, {cp} {cidade}".strip())
    envios = ", ".join(x.get("method_title") or "" for x in (o.get("shipping_lines") or []) if x.get("method_title"))
    if envios:
        partes.append(f"Envio: {envios}")
    if o.get("payment_method_title"):
        partes.append(f"Pagamento: {o['payment_method_title']}")
    return "\n".join(partes)


def _origem(o: dict, cfg: dict) -> dict:
    return {
        "canal": "woocommerce",
        "id": str(o.get("id")),
        "numero": str(o.get("number") or o.get("id")),
        "estado": o.get("status") or "",
        "url": f"{cfg.get('url')}/wp-admin/post.php?post={o.get('id')}&action=edit" if cfg.get("url") else "",
        "metodo": o.get("payment_method_title") or "",
        "atualizado_at": now_iso(),
    }


async def _registar_pagamento_woo(enc: dict, o: dict) -> Optional[dict]:
    """Regista o pagamento da loja uma única vez (identificado pela origem)."""
    pagamentos = list(enc.get("pagamentos") or [])
    ref = f"woo:{o.get('id')}"
    if any(p.get("origem_ref") == ref for p in pagamentos):
        return None
    valor = round2(float(o.get("total") or 0))
    if valor <= 0:
        return None
    pag = Pagamento(
        valor=valor,
        metodo=metodo_pagamento_woo(o),
        nota=f"Loja online #{o.get('number') or o.get('id')}"
             + (f" · {o.get('transaction_id')}" if o.get("transaction_id") else ""),
        data=(o.get("date_paid") or o.get("date_created") or now_iso())[:10],
        origem="encomenda",
        tipo="pagamento",
    ).model_dump()
    pag["origem_ref"] = ref
    pag["recibo_numero"] = await next_sequence("REC")
    pagamentos.append(pag)
    await encomendas_repo.update(enc["id"], {"pagamentos": pagamentos, "valor_pago": soma_valor_pago(pagamentos)})
    enc["pagamentos"] = pagamentos
    return pag


_LOCKS: Dict[str, asyncio.Lock] = {}


async def importar_pedido_woo(o: dict, *, user: Optional[dict] = None, cfg: Optional[dict] = None) -> Tuple[str, Optional[dict]]:
    """Cria ou atualiza a encomenda do ERP para um pedido WooCommerce.

    Devolve ("criada" | "atualizada" | "ignorada", encomenda). O WooCommerce envia
    order.created e order.updated quase em simultâneo — o lock evita duplicados.
    """
    chave = str((o or {}).get("id") or "")
    lock = _LOCKS.setdefault(chave, asyncio.Lock())
    async with lock:
        try:
            return await _importar_pedido_woo(o, user=user, cfg=cfg)
        finally:
            if len(_LOCKS) > 500:
                _LOCKS.clear()


async def _importar_pedido_woo(o: dict, *, user: Optional[dict] = None, cfg: Optional[dict] = None) -> Tuple[str, Optional[dict]]:
    cfg = cfg or await get_woo(raw=True)
    user = user or SYSTEM_USER
    if not o or not o.get("id"):
        return "ignorada", None
    estado_woo = o.get("status") or ""
    existente = await encomendas_repo.find_one({"origem_externa.canal": "woocommerce", "origem_externa.id": str(o["id"])})

    if existente:
        patch: Dict[str, Any] = {"origem_externa": {**(existente.get("origem_externa") or {}), **_origem(o, cfg)}}
        msgs = []
        if estado_woo in WOO_ESTADOS_PAGOS or o.get("date_paid"):
            pag = await _registar_pagamento_woo(existente, o)
            if pag:
                msgs.append(f"pagamento de {pag['valor']:.2f}€ registado")
        if estado_woo in WOO_ESTADOS_CANCELADOS and existente.get("estado") not in ("cancelada", "concluida"):
            from app.repositories import ordens_repo
            tem_of = await ordens_repo.find_one({"encomenda_id": existente["id"]})
            if tem_of:
                msgs.append(f"⚠ cancelada na loja ({estado_woo}) mas já tem OF — rever")
            else:
                patch["estado"] = "cancelada"
                msgs.append(f"cancelada na loja ({estado_woo})")
        if estado_woo == "completed" and not existente.get("entregue"):
            patch["entregue"] = True
            patch["data_entrega"] = (o.get("date_completed") or now_iso())[:10]
            msgs.append("concluída na loja (marcada como entregue)")
        await encomendas_repo.update(existente["id"], patch)
        if msgs:
            await audit.registar("encomenda", existente["id"], "editado", user,
                                 f"Loja online #{o.get('number')}: {', '.join(msgs)}", existente.get("numero"))
        return "atualizada", {**existente, **patch}

    if estado_woo not in (cfg.get("estados_importar") or WOO_ESTADOS_DEFAULT):
        return "ignorada", None

    cliente = await _cliente_do_pedido(o, bool(cfg.get("criar_clientes", True)))
    b = o.get("billing") or {}
    nome_cliente = (cliente or {}).get("nome") or (b.get("company") or "").strip() or \
        " ".join(x for x in (b.get("first_name"), b.get("last_name")) if x) or "Cliente loja online"
    envio = round2(sum(float(s.get("total") or 0) + float(s.get("total_tax") or 0) for s in (o.get("shipping_lines") or [])))
    enc = Encomenda(
        cliente=nome_cliente,
        cliente_id=(cliente or {}).get("id"),
        descricao=f"Loja online #{o.get('number') or o.get('id')}",
        referencia_cliente=f"#{o.get('number') or o.get('id')}",
        data=(o.get("date_created") or now_iso())[:10],
        notas=_notas_pedido(o),
        envio=envio,
        artigos=await _linhas_do_pedido(o),
    ).model_dump()
    enc["numero"] = await next_sequence("ENC")
    enc["origem_externa"] = _origem(o, cfg)
    # Garante que o total bate certo com a loja (arredondamentos, cupões de carrinho)
    soma = round2(sum(a["quantidade"] * a["preco_unit"] for a in enc["artigos"]) + envio)
    total_loja = round2(float(o.get("total") or 0))
    if total_loja and abs(soma - total_loja) > 0.01:
        enc["valor_total"] = total_loja
        enc["valor_total_manual"] = True
    await encomendas_repo.insert(enc)
    if estado_woo in WOO_ESTADOS_PAGOS or o.get("date_paid"):
        await _registar_pagamento_woo(enc, o)
    await audit.registar(
        "encomenda", enc["id"], "criado", user,
        f"Encomenda {enc['numero']} importada da loja online (#{o.get('number')}, {estado_woo})",
        enc["numero"],
    )
    cfg2 = await get_woo(raw=True)
    cfg2["ultimo_pedido"] = {"numero": str(o.get("number")), "at": now_iso(), "encomenda": enc["numero"]}
    await integracoes_repo.update_where({"id": WOO_ID}, cfg2, upsert=True)
    return "criada", enc


# ---------------------------------------------------------------------------
# Pedidos do site (formulários) → leads do CRM
# ---------------------------------------------------------------------------
CAMPOS_LEAD = {
    "nome": ("nome", "name", "your-name", "first_name", "nome_completo", "fullname", "full_name"),
    "apelido": ("apelido", "last_name", "surname"),
    "empresa": ("empresa", "company", "your-company", "organizacao", "organization"),
    "email": ("email", "e-mail", "your-email", "mail"),
    "telefone": ("telefone", "telemovel", "telemóvel", "phone", "tel", "your-phone", "contacto", "mobile"),
    "mensagem": ("mensagem", "message", "your-message", "descricao", "pedido", "comentarios", "comments", "detalhes"),
    "assunto": ("assunto", "subject", "your-subject", "servico", "serviço", "service"),
}


def _achatar(dados: Any, prefixo: str = "") -> Dict[str, str]:
    """Aceita JSON simples, aninhado (Elementor: fields[x][value]) ou formulário."""
    out: Dict[str, str] = {}
    if isinstance(dados, dict):
        if "value" in dados and isinstance(dados.get("value"), (str, int, float)) and prefixo:
            chave = str(dados.get("id") or dados.get("title") or prefixo)
            out[chave] = str(dados["value"])
            return out
        for k, v in dados.items():
            out.update(_achatar(v, str(k)))
    elif isinstance(dados, list):
        for i, v in enumerate(dados):
            out.update(_achatar(v, f"{prefixo}{i}"))
    elif dados is not None:
        out[prefixo] = str(dados)
    return out


def _norm_chave(k: str) -> str:
    k = re.sub(r"^(form_fields|fields)\[?|\]?\[?value\]?$", "", k.lower())
    return re.sub(r"[\[\]\s]+", "", k).strip("_-")


def interpretar_formulario(dados: Any) -> Dict[str, str]:
    plano = {_norm_chave(k): v.strip() for k, v in _achatar(dados).items() if str(v).strip()}
    lead = {}
    usados = set()
    for campo, chaves in CAMPOS_LEAD.items():
        for k in chaves:
            if k in plano:
                lead[campo] = plano[k]
                usados.add(k)
                break
    extras = {k: v for k, v in plano.items() if k not in usados and not k.startswith("_")
              and k not in ("token", "form_id", "form_name", "referer", "post_id", "queried_id", "action")}
    lead["_extras"] = extras
    return lead


async def receber_pedido_site(dados: Any, origem_pagina: str = "") -> dict:
    cfg = await get_site(raw=True)
    f = interpretar_formulario(dados)
    nome = " ".join(x for x in (f.get("nome"), f.get("apelido")) if x).strip()
    empresa = f.get("empresa", "")
    email = (f.get("email") or "").lower()
    telefone = re.sub(r"[^\d+]", "", f.get("telefone") or "")
    if not (nome or empresa or email or telefone):
        raise HTTPException(400, "O formulário não trouxe nome, email nem telefone")
    linhas = []
    if f.get("assunto"):
        linhas.append(f"Assunto: {f['assunto']}")
    if f.get("mensagem"):
        linhas.append(f["mensagem"])
    for k, v in (f.get("_extras") or {}).items():
        linhas.append(f"{k}: {v}")
    if origem_pagina:
        linhas.append(f"Página: {origem_pagina}")
    descricao = "\n".join(linhas)[:4000]
    ts = now_iso()
    interacao = {"id": new_id(), "tipo": "mensagem", "texto": f"Pedido pelo site:\n{descricao}" if descricao else "Pedido pelo site",
                 "at": ts, "created_at": ts, "autor_id": None, "autor_nome": cfg.get("origem") or "Site"}

    # Mesmo contacto com lead em aberto → junta a mensagem em vez de duplicar
    estados = await crm_estados_repo.find({}, sort=("ordem", 1), limit=200)
    abertos = {e["id"] for e in estados if e.get("tipo") == "aberto"}
    existente = None
    if email:
        existente = await leads_repo.find_one({"email": email})
    if not existente and telefone:
        existente = await leads_repo.find_one({"telefone": telefone})
    if existente and existente.get("estado_id") in abertos:
        await leads_repo.col.update_one(
            {"id": existente["id"]},
            {"$push": {"interacoes": interacao}, "$set": {"updated_at": ts}},
        )
        return {"ok": True, "lead_id": existente["id"], "novo": False}

    estado = next((e for e in estados if e.get("tipo") == "aberto"), estados[0] if estados else None)
    if not estado:
        raise HTTPException(503, "O CRM ainda não tem estados configurados")
    ultimo = await leads_repo.find({"estado_id": estado["id"]}, sort=("ordem", -1), limit=1)
    lead = {
        "id": new_id(),
        "nome": nome, "empresa": empresa, "telefone": telefone, "email": email,
        "origem": cfg.get("origem") or "Site",
        "descricao": (f.get("assunto") or f.get("mensagem") or "")[:300],
        "valor_estimado": None,
        "estado_id": estado["id"],
        "ordem": ((ultimo[0].get("ordem") or 0) + 1) if ultimo else 0,
        "responsavel_id": None, "responsavel_nome": "",
        "proxima_acao_at": None, "proxima_acao_nota": "", "motivo_perda": "",
        "cliente_id": None, "cliente_nome": "", "orcamento_ids": [],
        "campos_extra": {},
        "interacoes": [interacao],
        "criado_por_id": None, "criado_por_nome": cfg.get("origem") or "Site",
        "created_at": ts, "updated_at": ts, "estado_desde": ts, "fechado_at": None,
    }
    await leads_repo.insert(lead)
    cfg["ultimo_pedido"] = {"at": ts, "nome": nome or empresa or email}
    await integracoes_repo.update_where({"id": SITE_ID}, cfg, upsert=True)
    return {"ok": True, "lead_id": lead["id"], "novo": True}
