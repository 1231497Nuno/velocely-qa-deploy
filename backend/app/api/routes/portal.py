"""Link do cliente (público, sem login) e pagamentos online (Multibanco / MB WAY)."""
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.security import get_current_user, require_admin, require_perm
from app.repositories import pagamentos_online_repo
from app.services import pagamentos_online, portal

router = APIRouter()


# ---------------- Interno ----------------
@router.post("/portal/links")
async def criar_link(dados: dict, user: dict = Depends(get_current_user)):
    tipo = dados.get("tipo")
    from app.core.security import resolve_perfil
    perfil = await resolve_perfil(user)
    mod = "orcamentos" if tipo == "orcamento" else "encomendas"
    if not perfil.get("admin") and not ((perfil.get("permissoes") or {}).get(mod) or {}).get("view"):
        raise HTTPException(403, "Sem permissão")
    l = await portal.criar_link(tipo, dados.get("id") or "", user)
    return {"token": l["token"], "caminho": f"/p/{l['token']}", "expira": l["expira"], "visto_at": l.get("visto_at")}


@router.get("/pagamentos-online/config")
async def config_get(_a: dict = Depends(require_admin)):
    cfg = await pagamentos_online.get_config(publica=True)
    cfg["callback_ifthenpay"] = pagamentos_online.url_callback("ifthenpay", await pagamentos_online.get_config())
    cfg["callback_eupago"] = pagamentos_online.url_callback("eupago", cfg)
    return cfg


@router.put("/pagamentos-online/config")
async def config_put(dados: dict, _a: dict = Depends(require_admin)):
    return await pagamentos_online.guardar_config(dados)


@router.get("/encomendas/{eid}/pagamentos-online")
async def listar_online(eid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    return await pagamentos_online_repo.find({"encomenda_id": eid}, sort=("created_at", -1), limit=50)


@router.post("/encomendas/{eid}/pagamentos-online")
async def gerar_online(eid: str, dados: dict, _u: dict = Depends(require_perm("encomendas", "edit"))):
    return await pagamentos_online.pedir(eid, dados.get("metodo") or "multibanco", dados.get("telemovel") or "", dados.get("valor"))


# ---------------- Público ----------------
@router.get("/publico/pagamentos/{fornecedor}")
@router.post("/publico/pagamentos/{fornecedor}")
async def callback(fornecedor: str, request: Request):
    if fornecedor not in ("ifthenpay", "eupago"):
        raise HTTPException(404, "Desconhecido")
    params = dict(request.query_params)
    try:
        if request.method == "POST":
            ct = request.headers.get("content-type", "")
            params.update(await request.json() if "json" in ct else dict(await request.form()))
    except Exception:
        pass
    return await pagamentos_online.confirmar(fornecedor, params)


@router.get("/publico/{token}")
async def ver(token: str):
    return await portal.ver(token)


@router.post("/publico/{token}/resposta")
async def resposta(token: str, dados: dict, request: Request):
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "") or "").split(",")[0]
    return await portal.responder_orcamento(token, bool(dados.get("aceitar")), dados.get("nome") or "", dados.get("comentario") or "", ip)


@router.post("/publico/{token}/arte/{linha_id}")
async def decidir_arte(token: str, linha_id: str, dados: dict):
    return await portal.decidir_arte(token, linha_id, bool(dados.get("aprovada")), dados.get("comentario") or "")


@router.get("/publico/{token}/arte/{linha_id}")
async def ver_arte(token: str, linha_id: str):
    dados, ct, nome = await portal.arte(token, linha_id)
    return StreamingResponse(BytesIO(dados), media_type=ct or "application/octet-stream",
                             headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(nome)}"})


@router.get("/publico/{token}/pdf")
async def ver_pdf(token: str):
    pdf, numero = await portal.pdf(token)
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(numero)}.pdf"})


@router.post("/publico/{token}/pagar")
async def pagar(token: str, dados: dict):
    return await portal.pagar(token, dados.get("metodo") or "multibanco", dados.get("telemovel") or "")
