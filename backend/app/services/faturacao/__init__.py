"""Ligação a programas de faturação certificados pela AT (FIZ, TOConline, Moloni).

Com a ligação ativa, "Assinar" uma fatura ou fatura-recibo envia-a ao programa escolhido, que lhe dá o
número oficial, o ATCUD e o PDF certificado. Sem ligação, o ERP continua a numerar internamente.

Configuração na coleção `integracoes` (id "faturacao"); os segredos nunca vão inteiros para o browser.
"""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import HTTPException

from app.core.database import now_iso
from app.repositories import documentos_financeiros_repo, empresa_repo, faturacao_mapas_repo, integracoes_repo
from app.services.faturacao import fiz, moloni, toconline
from app.services.faturacao.base import (
    MOTIVOS_ISENCAO, MOTIVOS_ISENCAO_TEXTO, FaturacaoErro, FaturacaoNaoSuportado, ResultadoEmissao,
)

FATURACAO_ID = "faturacao"
FORNECEDORES = {
    "fiz": {"nome": "FIZ", "modulo": fiz},
    "toconline": {"nome": "TOConline", "modulo": toconline},
    "moloni": {"nome": "Moloni", "modulo": moloni},
}
# Tipos de documento do ERP que passam a ser emitidos no programa certificado
TIPOS_CERTIFICADOS = ("fatura", "fatura_recibo", "nota_credito")

SEGREDOS = {
    "fiz": ("api_key",),
    "toconline": ("client_secret", "access_token", "refresh_token", "state"),
    "moloni": ("client_secret", "password", "access_token", "refresh_token"),
}

DEFAULT = {
    "id": FATURACAO_ID,
    "ativo": False,
    "fornecedor": "",
    "cae": "",
    "motivo_isencao": "M10",
    "toconline_motivo_isencao_id": "",
    # Por programa: {"fiz": {"fatura": id, "fatura_recibo": id, "recibo": id}, ...}
    "series": {},
    # Por programa: método do ERP → código/id no programa
    "metodos": {},
    "fiz": {"api_key": ""},
    "toconline": {"client_id": "", "client_secret": "", "oauth_url": "", "api_url": "", "redirect_uri": "",
                  "retorno": "", "access_token": "", "refresh_token": "", "expira_em": 0, "state": "",
                  "autorizado_em": None},
    "moloni": {"client_id": "", "client_secret": "", "username": "", "password": "", "company_id": "",
               "produto_referencia": "", "tax_id": "", "access_token": "", "refresh_token": "", "expira_em": 0,
               "refresh_expira_em": 0},
    "ultimo_teste": None,
    "ultimo_erro": "",
}


def _mascarar(v: str) -> str:
    v = str(v or "")
    return "" if not v else ("•" * 6 + v[-4:])


async def get_config(raw: bool = False) -> dict:
    guardado = await integracoes_repo.get(FATURACAO_ID) or {}
    cfg = {**DEFAULT, **guardado}
    for k in ("fiz", "toconline", "moloni"):
        cfg[k] = {**DEFAULT[k], **(guardado.get(k) or {})}
    for k in ("series", "metodos"):
        cfg[k] = {f: dict(v) for f, v in (guardado.get(k) or {}).items() if f in FORNECEDORES and isinstance(v, dict)}
    if raw:
        return cfg
    out = {k: v for k, v in cfg.items() if k != "_id"}
    for forn, chaves in SEGREDOS.items():
        sub = dict(out[forn])
        for ch in chaves:
            valor = sub.pop(ch, "")
            if ch in ("access_token", "refresh_token", "state"):
                continue
            sub[f"{ch}_definido"] = bool(valor)
            sub[f"{ch}_mask"] = _mascarar(valor) if ch == "api_key" else ""
        out[forn] = sub
    out["toconline"]["autorizado"] = bool(cfg["toconline"].get("refresh_token"))
    out["fornecedores"] = [{"id": k, "nome": v["nome"]} for k, v in FORNECEDORES.items()]
    out["motivos_isencao"] = MOTIVOS_ISENCAO
    return out


async def guardar(dados: dict) -> dict:
    cfg = await get_config(raw=True)
    patch: dict = {}
    if "fornecedor" in dados:
        f = (dados.get("fornecedor") or "").strip()
        if f and f not in FORNECEDORES:
            raise HTTPException(400, "Programa de faturação desconhecido")
        patch["fornecedor"] = f
    for k in ("cae", "motivo_isencao", "toconline_motivo_isencao_id"):
        if k in dados and dados[k] is not None:
            patch[k] = str(dados[k]).strip()
    alvo = patch.get("fornecedor", cfg.get("fornecedor"))
    for k in ("series", "metodos"):
        if dados.get(k) is not None:
            if not alvo:
                raise HTTPException(400, "Escolha o programa de faturação")
            valores = {c: str(v or "").strip() for c, v in dados[k].items() if str(v or "").strip()}
            patch[k] = {**cfg[k], alvo: valores}
    for forn in FORNECEDORES:
        novo = dados.get(forn)
        if not isinstance(novo, dict):
            continue
        sub = dict(cfg[forn])
        for k, v in novo.items():
            if k not in DEFAULT[forn] or k in ("access_token", "refresh_token", "expira_em", "refresh_expira_em", "state", "autorizado_em"):
                continue
            v = "" if v is None else str(v).strip()
            if k in SEGREDOS[forn] and not v:
                continue  # campo de segredo vazio = manter o que está
            if k in ("oauth_url", "api_url"):
                v = v.rstrip("/")
            sub[k] = v
        # Mudar de conta invalida os tokens
        if forn in ("toconline", "moloni") and any(
            novo.get(k) and str(novo[k]).strip() != str(cfg[forn].get(k) or "")
            for k in ("client_id", "client_secret", "username", "password", "oauth_url", "api_url", "company_id")
        ):
            sub.update({"access_token": "", "expira_em": 0})
            if forn == "toconline" or any(novo.get(k) for k in ("client_id", "username", "password")):
                sub.update({"refresh_token": "", "refresh_expira_em": 0})
        patch[forn] = sub
    if "ativo" in dados and dados["ativo"] is not None:
        ativo = bool(dados["ativo"])
        forn = patch.get("fornecedor", cfg.get("fornecedor"))
        if ativo and not forn:
            raise HTTPException(400, "Escolha o programa de faturação antes de ativar")
        patch["ativo"] = ativo
    await integracoes_repo.update_where({"id": FATURACAO_ID}, {**patch, "id": FATURACAO_ID}, upsert=True)
    return await get_config()


# ---------------------------------------------------------------------------
# Contexto para os adaptadores (cache de ids, tokens, gravação parcial)
# ---------------------------------------------------------------------------
async def _cache_get(chave: str) -> Optional[str]:
    d = await faturacao_mapas_repo.get(chave)
    return (d or {}).get("valor")


async def _cache_set(chave: str, valor: str) -> None:
    await faturacao_mapas_repo.update_where({"id": chave}, {"id": chave, "valor": valor, "updated_at": now_iso()}, upsert=True)


def _ctx(cfg: dict, settings: Optional[dict] = None, doc_id: Optional[str] = None) -> dict:
    forn = cfg.get("fornecedor")

    async def guardar_tokens(novos: dict) -> None:
        atual = await get_config(raw=True)
        await integracoes_repo.update_where({"id": FATURACAO_ID}, {forn: {**atual[forn], **novos}}, upsert=True)

    async def guardar_parcial(info: dict) -> None:
        if not doc_id:
            return
        d = await documentos_financeiros_repo.get(doc_id) or {}
        atual = d.get("faturacao") or {}
        await documentos_financeiros_repo.update(doc_id, {"faturacao": {
            **atual, "fornecedor": forn, "estado": "pendente", **info,
            "extra": {**(atual.get("extra") or {}), **(info.get("extra") or {})},
        }})

    s = settings or {}
    return {
        "iva_isento": bool(s.get("iva_isento")),
        "iva_taxa": float(s.get("iva_taxa") or 0),
        "cache_get": _cache_get,
        "cache_set": _cache_set,
        "guardar_tokens": guardar_tokens,
        "guardar_parcial": guardar_parcial,
    }


def _para(cfg: dict, forn: Optional[str] = None) -> dict:
    """Configuração vista por um programa: séries e métodos desse programa."""
    forn = forn or cfg.get("fornecedor") or ""
    return {**cfg, "fornecedor": forn, "series": (cfg.get("series") or {}).get(forn) or {},
            "metodos": (cfg.get("metodos") or {}).get(forn) or {}}


def _modulo(cfg: dict):
    f = FORNECEDORES.get(cfg.get("fornecedor") or "")
    if not f:
        raise HTTPException(400, "Escolha o programa de faturação")
    return f["modulo"]


def nome_fornecedor(forn: Optional[str]) -> str:
    return (FORNECEDORES.get(forn or "") or {}).get("nome") or (forn or "")


async def config_ativa() -> Optional[dict]:
    cfg = await get_config(raw=True)
    return _para(cfg) if cfg.get("ativo") and cfg.get("fornecedor") in FORNECEDORES else None


async def testar() -> dict:
    cfg = _para(await get_config(raw=True))
    mod = _modulo(cfg)
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    try:
        r = await mod.testar(cfg, _ctx(cfg, settings))
    except HTTPException as ex:
        await integracoes_repo.update_where({"id": FATURACAO_ID}, {"ultimo_erro": str(ex.detail), "ultimo_teste": now_iso()}, upsert=True)
        raise
    await integracoes_repo.update_where({"id": FATURACAO_ID}, {"ultimo_erro": "", "ultimo_teste": now_iso()}, upsert=True)
    return {**r, "fornecedor": nome_fornecedor(cfg["fornecedor"])}


async def dados_fornecedor() -> dict:
    cfg = _para(await get_config(raw=True))
    mod = _modulo(cfg)
    return await mod.dados(cfg, _ctx(cfg))


# ---------------------------------------------------------------------------
# TOConline — autorização OAuth
# ---------------------------------------------------------------------------
async def toconline_autorizar(api_publica: str, retorno: str) -> dict:
    cfg = await get_config(raw=True)
    state = secrets.token_urlsafe(24)
    redirect = f"{api_publica.rstrip('/')}/integracoes/faturacao/toconline/callback"
    sub = {**cfg["toconline"], "state": state, "redirect_uri": redirect, "retorno": retorno or ""}
    await integracoes_repo.update_where({"id": FATURACAO_ID}, {"toconline": sub}, upsert=True)
    cfg["toconline"] = sub
    return {"url": toconline.url_autorizacao(cfg, state), "redirect_uri": redirect}


async def toconline_callback(code: str, state: str) -> str:
    """Troca o código por tokens. Devolve o endereço do ERP para onde voltar."""
    cfg = await get_config(raw=True)
    sub = cfg["toconline"]
    retorno = sub.get("retorno") or ""
    if not state or not secrets.compare_digest(str(state), str(sub.get("state") or "")):
        raise HTTPException(400, "Pedido de autorização inválido ou expirado — volte a carregar em «Autorizar»")
    tokens = await toconline.trocar_codigo(cfg, code)
    await integracoes_repo.update_where({"id": FATURACAO_ID}, {"toconline": {
        **sub, **tokens, "state": "", "autorizado_em": now_iso()}, "ultimo_erro": ""}, upsert=True)
    return retorno


# ---------------------------------------------------------------------------
# Emissão, PDF, recibos e anulação
# ---------------------------------------------------------------------------
def certificado(doc: Optional[dict]) -> bool:
    f = (doc or {}).get("faturacao") or {}
    return bool(f.get("externo_id")) and f.get("estado") == "emitido"


async def emitir_documento(doc: dict, cliente: dict) -> dict:
    """Envia o documento ao programa certificado. Devolve o bloco `faturacao` a gravar no documento."""
    cfg = await config_ativa()
    if not cfg:
        raise HTTPException(400, "Ligação à faturação desativada")
    mod = _modulo(cfg)
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    ctx = _ctx(cfg, settings, doc.get("id"))
    if cfg.get("fornecedor") != ((doc.get("faturacao") or {}).get("fornecedor") or cfg.get("fornecedor")):
        doc = {**doc, "faturacao": {}}  # rascunho tentado noutro programa: recomeça
    if doc.get("tipo") == "nota_credito":
        mae = await documentos_financeiros_repo.get(doc.get("fatura_id") or "") or {}
        ctx["fatura_origem"] = mae.get("faturacao") or {}
    try:
        res: ResultadoEmissao = await mod.emitir(cfg, doc, cliente or {}, ctx)
    except HTTPException as ex:
        atual = (await documentos_financeiros_repo.get(doc["id"]) or {}).get("faturacao") or {}
        await documentos_financeiros_repo.update(doc["id"], {"faturacao": {
            **atual, "fornecedor": cfg["fornecedor"], "fornecedor_nome": nome_fornecedor(cfg["fornecedor"]),
            "estado": atual.get("estado") or "erro", "erro": str(ex.detail), "erro_em": now_iso(),
        }})
        raise
    atual = (await documentos_financeiros_repo.get(doc["id"]) or {}).get("faturacao") or {}
    bloco = {
        **atual,
        **res.to_dict(),
        "extra": {**(atual.get("extra") or {}), **(res.extra or {})},
        "fornecedor": cfg["fornecedor"],
        "fornecedor_nome": nome_fornecedor(cfg["fornecedor"]),
        "estado": "emitido",
        "erro": "",
        "emitido_em": now_iso(),
    }
    if res.total is not None and abs(float(res.total) - float(doc.get("total") or 0)) > 0.02:
        bloco["aviso"] = (f"O total no {bloco['fornecedor_nome']} ({res.total:.2f}€) é diferente do ERP "
                          f"({float(doc.get('total') or 0):.2f}€) — verifique arredondamentos.")
    return bloco


async def pdf_url(doc: dict) -> str:
    f = (doc or {}).get("faturacao") or {}
    cfg = await get_config(raw=True)
    mod = (FORNECEDORES.get(f.get("fornecedor") or "") or {}).get("modulo")
    if not mod:
        raise HTTPException(400, "Documento sem programa de faturação")
    cfg = _para(cfg, f["fornecedor"])
    url = await mod.pdf_url(cfg, f, _ctx(cfg))
    if not url:
        raise FaturacaoErro("O programa de faturação não devolveu o PDF")
    return url


async def pdf_bytes(doc: dict) -> bytes:
    from app.services.faturacao.base import http
    url = await pdf_url(doc)
    r = await http("GET", url)
    if r.status_code >= 400 or not r.content:
        raise FaturacaoErro(f"Não foi possível descarregar o PDF certificado (erro {r.status_code})")
    return r.content


async def registar_recebimento(fatura: dict, valor: float, metodo: str, data: str) -> Optional[dict]:
    """Recibo de uma fatura certificada. Devolve o bloco `faturacao` do recibo, ou None se não se aplica."""
    if not certificado(fatura) or fatura.get("tipo") != "fatura":
        return None
    f = fatura["faturacao"]
    cfg = await get_config(raw=True)
    mod = (FORNECEDORES.get(f.get("fornecedor") or "") or {}).get("modulo")
    if not mod:
        return None
    cfg = _para(cfg, f["fornecedor"])
    try:
        res = await mod.registar_recebimento(cfg, f, valor, metodo, data, _ctx(cfg))
    except FaturacaoNaoSuportado as ex:
        return {"fornecedor": f["fornecedor"], "fornecedor_nome": nome_fornecedor(f["fornecedor"]),
                "estado": "manual", "aviso": str(ex.detail)}
    return {**res.to_dict(), "fornecedor": f["fornecedor"], "fornecedor_nome": nome_fornecedor(f["fornecedor"]),
            "estado": "emitido", "emitido_em": now_iso()}


async def anular(doc: dict, motivo: str, ja_tratado_no_programa: bool = False) -> Optional[dict]:
    """Anula no programa certificado. Se o programa não deixar, pede confirmação de que foi feito lá."""
    if not certificado(doc):
        return None
    f = doc["faturacao"]
    if ja_tratado_no_programa:
        return {**f, "anulado_em": now_iso(), "anulado_no_programa": "manual"}
    cfg = await get_config(raw=True)
    mod = FORNECEDORES[f["fornecedor"]]["modulo"]
    cfg = _para(cfg, f["fornecedor"])
    try:
        await mod.anular(cfg, f, motivo, _ctx(cfg))
    except FaturacaoNaoSuportado as ex:
        raise HTTPException(409, {"codigo": "anular_no_programa", "mensagem": str(ex.detail),
                                  "fornecedor": nome_fornecedor(f["fornecedor"])})
    return {**f, "anulado_em": now_iso(), "anulado_no_programa": "api"}


def texto_isencao(cfg: dict) -> str:
    return MOTIVOS_ISENCAO_TEXTO.get(cfg.get("motivo_isencao") or "", "")


__all__ = [
    "FaturacaoErro", "TIPOS_CERTIFICADOS", "anular", "certificado", "config_ativa", "dados_fornecedor",
    "emitir_documento", "get_config", "guardar", "nome_fornecedor", "pdf_bytes", "pdf_url", "registar_recebimento",
    "testar", "texto_isencao", "toconline_autorizar", "toconline_callback",
]
