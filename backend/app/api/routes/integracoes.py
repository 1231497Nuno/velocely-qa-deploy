"""Integração com o site: encomendas da loja (WooCommerce) e pedidos de formulários (CRM)."""
import json
from html import escape
from typing import List, Optional
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from app.core.security import require_admin, require_perm
from app.services import faturacao as fat
from app.services import integracoes as svc

router = APIRouter()


# ---------------------------------------------------------------------------
# Configuração (Definições → Integrações)
# ---------------------------------------------------------------------------
@router.get("/integracoes")
async def get_integracoes(_u: dict = Depends(require_perm("definicoes", "view"))):
    return {"woocommerce": await svc.get_woo(), "site": await svc.get_site(), "faturacao": await fat.get_config()}


class WooBody(BaseModel):
    ativo: Optional[bool] = None
    url: Optional[str] = None
    consumer_key: Optional[str] = None
    consumer_secret: Optional[str] = None
    webhook_secret: Optional[str] = None
    estados_importar: Optional[List[str]] = None
    criar_clientes: Optional[bool] = None


@router.put("/integracoes/woocommerce")
async def put_woo(body: WooBody, _a: dict = Depends(require_admin)):
    return await svc.guardar_woo(body.model_dump(exclude_unset=True))


@router.post("/integracoes/woocommerce/segredo")
async def novo_segredo_woo(_a: dict = Depends(require_admin)):
    """Gera um segredo novo para o webhook — devolvido uma única vez para copiar para o WooCommerce."""
    return {"webhook_secret": await svc.gerar_segredo_woo()}


@router.post("/integracoes/woocommerce/testar")
async def testar_woo(_a: dict = Depends(require_admin)):
    return await svc.testar_woo()


class SincronizarBody(BaseModel):
    desde: Optional[str] = None


@router.post("/integracoes/woocommerce/sincronizar")
async def sincronizar_woo(body: SincronizarBody, user: dict = Depends(require_admin)):
    return await svc.sincronizar_woo(body.desde, user)


class SiteBody(BaseModel):
    ativo: Optional[bool] = None
    origem: Optional[str] = None
    novo_token: bool = False


@router.put("/integracoes/site")
async def put_site(body: SiteBody, _a: dict = Depends(require_admin)):
    return await svc.guardar_site(body.model_dump(exclude_unset=True))


# ---------------------------------------------------------------------------
# Entradas públicas (chamadas pelo site) — protegidas por assinatura / token
# ---------------------------------------------------------------------------
@router.post("/integracoes/woocommerce/webhook")
async def webhook_woo(request: Request):
    corpo = await request.body()
    cfg = await svc.get_woo(raw=True)
    # O WooCommerce envia um "ping" (formulário webhook_id=…) ao criar o webhook
    if not corpo.strip().startswith(b"{"):
        return {"ok": True, "ping": True}
    if not cfg.get("ativo"):
        raise HTTPException(503, "Integração com a loja desativada")
    if not svc.assinatura_valida(corpo, request.headers.get("x-wc-webhook-signature", ""), cfg.get("webhook_secret", "")):
        raise HTTPException(401, "Assinatura inválida")
    try:
        pedido = json.loads(corpo)
    except ValueError:
        raise HTTPException(400, "JSON inválido")
    acao, enc = await svc.importar_pedido_woo(pedido, cfg=cfg)
    return {"ok": True, "acao": acao, "encomenda": (enc or {}).get("numero")}


@router.post("/integracoes/site/pedido")
async def pedido_site(request: Request):
    cfg = await svc.get_site(raw=True)
    token = request.headers.get("x-velocely-token") or request.query_params.get("token") or ""
    corpo = await request.body()
    tipo = (request.headers.get("content-type") or "").lower()
    if "json" in tipo:
        try:
            dados = json.loads(corpo or b"{}")
        except ValueError:
            raise HTTPException(400, "JSON inválido")
    else:
        dados = {k: v[0] if len(v) == 1 else ", ".join(v) for k, v in parse_qs(corpo.decode("utf-8", "replace")).items()}
    if isinstance(dados, dict) and not token:
        token = str(dados.pop("token", "") or "")
    if not cfg.get("ativo") or not cfg.get("token"):
        raise HTTPException(503, "Receção de pedidos do site desativada")
    import hmac
    if not hmac.compare_digest(str(token), str(cfg["token"])):
        raise HTTPException(401, "Token inválido")
    return await svc.receber_pedido_site(dados, request.headers.get("referer", ""))


# ---------------------------------------------------------------------------
# Programa de faturação certificado (FIZ / TOConline / Moloni)
# ---------------------------------------------------------------------------
class FaturacaoBody(BaseModel):
    ativo: Optional[bool] = None
    fornecedor: Optional[str] = None
    cae: Optional[str] = None
    motivo_isencao: Optional[str] = None
    toconline_motivo_isencao_id: Optional[str] = None
    series: Optional[dict] = None
    metodos: Optional[dict] = None
    fiz: Optional[dict] = None
    toconline: Optional[dict] = None
    moloni: Optional[dict] = None


@router.get("/faturacao/estado")
async def estado_faturacao(_u: dict = Depends(require_perm("financeiro", "view"))):
    """Se as faturas são emitidas num programa certificado (para os botões das fichas)."""
    cfg = await fat.config_ativa()
    return {"ativo": bool(cfg), "fornecedor": (cfg or {}).get("fornecedor") or "",
            "fornecedor_nome": fat.nome_fornecedor((cfg or {}).get("fornecedor"))}


@router.put("/integracoes/faturacao")
async def put_faturacao(body: FaturacaoBody, _a: dict = Depends(require_admin)):
    return await fat.guardar(body.model_dump(exclude_unset=True))


@router.post("/integracoes/faturacao/testar")
async def testar_faturacao(_a: dict = Depends(require_admin)):
    return await fat.testar()


@router.get("/integracoes/faturacao/dados")
async def dados_faturacao(_a: dict = Depends(require_admin)):
    """Séries, métodos de pagamento e impostos do programa — para escolher nas Definições."""
    return await fat.dados_fornecedor()


class AutorizarBody(BaseModel):
    api_publica: str
    retorno: str = ""


@router.post("/integracoes/faturacao/toconline/autorizar")
async def autorizar_toconline(body: AutorizarBody, _a: dict = Depends(require_admin)):
    return await fat.toconline_autorizar(body.api_publica, body.retorno)


@router.get("/integracoes/faturacao/toconline/callback")
async def callback_toconline(code: str = "", state: str = "", error: str = ""):
    """Retorno do TOConline depois de o utilizador autorizar (público, validado pelo `state`)."""
    if error or not code:
        return HTMLResponse(f"<p>Autorização recusada no TOConline ({escape(error or 'sem código')}).</p>", status_code=400)
    try:
        retorno = await fat.toconline_callback(code, state)
    except HTTPException as ex:
        return HTMLResponse(f"<p>{escape(str(ex.detail))}</p>", status_code=ex.status_code)
    if retorno.startswith("http"):
        sep = "&" if "?" in retorno else "?"
        return RedirectResponse(f"{retorno}{sep}toconline=ok", status_code=302)
    return HTMLResponse("<p>TOConline autorizado. Pode fechar esta janela e voltar ao ERP.</p>")
