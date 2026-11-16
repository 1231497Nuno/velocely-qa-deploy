"""Conta corrente, extrato, previsão de tesouraria, extrato bancário e exportação para o contabilista."""
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.core.security import require_perm
from app.repositories import extrato_bancario_repo
from app.services import tesouraria as svc

router = APIRouter()


async def _empresa() -> dict:
    from app.repositories import empresa_repo
    return await empresa_repo.find_one({"id": "empresa"}) or {}


@router.get("/conta-corrente/{tipo}/{eid}")
async def conta_corrente(tipo: str, eid: str, de: str = Query(""), ate: str = Query(""), formato: str = Query("json"),
                         _u: dict = Depends(require_perm("contas", "view"))):
    if tipo not in ("cliente", "fornecedor"):
        raise HTTPException(404, "Tipo inválido")
    cc = await (svc.conta_corrente_cliente if tipo == "cliente" else svc.conta_corrente_fornecedor)(eid, de[:10], ate[:10])
    if formato != "pdf":
        return cc
    pdf = svc.extrato_pdf(cc, await _empresa())
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote('Extrato ' + (cc['entidade'].get('nome') or ''))}.pdf"})


@router.post("/conta-corrente/cliente/{cid}/enviar")
async def enviar_extrato(cid: str, dados: dict, _u: dict = Depends(require_perm("contas", "view"))):
    import asyncio
    from app.services.email import _branded_html, send_email
    cc = await svc.conta_corrente_cliente(cid, (dados.get("de") or "")[:10], (dados.get("ate") or "")[:10])
    to = (dados.get("to") or cc["entidade"].get("email") or "").strip()
    if "@" not in to:
        raise HTTPException(400, "O cliente não tem email")
    emp = await _empresa()
    saldo = f"{cc['saldo']:.2f} €".replace(".", ",")
    texto = (dados.get("mensagem") or f"Olá,\n\nSegue em anexo o extrato da sua conta corrente. Saldo em aberto: {saldo}.\n\n"
             "Se já efetuou o pagamento, por favor ignore esta mensagem.\n\nObrigado,\n" + (emp.get("nome") or ""))
    ok, err = await asyncio.to_thread(send_email, to, f"Extrato de conta corrente — {emp.get('nome') or ''}", texto,
                                      html=_branded_html("".join(f"<p>{p}</p>" for p in texto.split("\n\n"))),
                                      attachments=[("extrato.pdf", svc.extrato_pdf(cc, emp), "application/pdf")])
    if not ok:
        raise HTTPException(400, "Servidor de email não configurado" if err == "no_smtp" else f"Falhou: {err}")
    return {"ok": True, "to": to}


@router.get("/tesouraria/previsao")
async def previsao(semanas: int = Query(12, ge=4, le=26), _u: dict = Depends(require_perm("contas", "view"))):
    return await svc.previsao(semanas)


@router.put("/tesouraria/config")
async def config(dados: dict, _u: dict = Depends(require_perm("contas", "edit"))):
    return await svc.guardar_config(dados)


@router.post("/extrato-bancario/importar")
async def importar(ficheiro: UploadFile = File(...), _u: dict = Depends(require_perm("contas", "edit"))):
    return await svc.importar_extrato(ficheiro.filename or "extrato.csv", await ficheiro.read())


@router.get("/extrato-bancario")
async def listar(estado: str = Query("por_conciliar"), _u: dict = Depends(require_perm("contas", "view"))):
    if estado == "por_conciliar":
        return await svc.sugestoes_conciliacao()
    return await extrato_bancario_repo.find({"estado": estado}, sort=("data", -1), limit=500)


@router.post("/extrato-bancario/{mid}/conciliar")
async def conciliar(mid: str, dados: dict, user: dict = Depends(require_perm("contas", "edit"))):
    return await svc.conciliar(mid, dados.get("tipo") or "", dados.get("id") or "", user)


@router.get("/contabilidade/exportar")
async def exportar(de: str = Query(...), ate: str = Query(...), _u: dict = Depends(require_perm("financeiro", "view"))):
    dados = await svc.exportar_contabilista(de[:10], ate[:10])
    return StreamingResponse(BytesIO(dados), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="contabilidade-{de[:10]}-a-{ate[:10]}.xlsx"'})
