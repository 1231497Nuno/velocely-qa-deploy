"""Pesquisa global, preferências do utilizador, cópias de segurança e RGPD."""
import json
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.core.security import get_current_user, require_admin, require_perm
from app.services import utilidades as svc

router = APIRouter()


@router.get("/me/preferencias")
async def prefs_get(user: dict = Depends(get_current_user)):
    return await svc.get_preferencias(user)


@router.put("/me/preferencias")
async def prefs_put(dados: dict, user: dict = Depends(get_current_user)):
    return await svc.guardar_preferencias(user, dados)


# ---------------- Cópias de segurança ----------------
@router.get("/backups")
async def backups(_a: dict = Depends(require_admin)):
    return await svc.listar_backups()


@router.post("/backups")
async def backup_agora(_a: dict = Depends(require_admin)):
    return await svc.backup_automatico(forcar=True)


@router.get("/backups/{bid}/download")
async def backup_download(bid: str, _a: dict = Depends(require_admin)):
    dados = await (svc.gerar_backup() if bid == "agora" else svc.ler_backup(bid))
    return StreamingResponse(BytesIO(dados), media_type="application/gzip",
                             headers={"Content-Disposition": 'attachment; filename="velocely-copia.json.gz"'})


@router.post("/backups/restaurar")
async def backup_restaurar(ficheiro: UploadFile = File(...), confirmar: str = Form(""), admin: dict = Depends(require_admin)):
    if confirmar.strip().upper() != "RESTAURAR":
        raise HTTPException(400, "Escreva RESTAURAR para confirmar")
    return await svc.restaurar(await ficheiro.read(), admin)


# ---------------- RGPD ----------------
@router.get("/clientes/{cid}/rgpd/exportar")
async def rgpd_exportar(cid: str, _u: dict = Depends(require_perm("clientes", "view"))):
    dados = await svc.exportar_cliente(cid)
    corpo = json.dumps(dados, default=str, ensure_ascii=False, indent=2).encode("utf-8")
    return StreamingResponse(BytesIO(corpo), media_type="application/json",
                             headers={"Content-Disposition": f'attachment; filename="dados-cliente-{cid[:8]}.json"'})


@router.put("/clientes/{cid}/rgpd/consentimento")
async def rgpd_consentimento(cid: str, dados: dict, user: dict = Depends(require_perm("clientes", "edit"))):
    return await svc.consentimento(cid, dados, user)


@router.post("/clientes/{cid}/rgpd/anonimizar")
async def rgpd_anonimizar(cid: str, admin: dict = Depends(require_admin)):
    return await svc.anonimizar(cid, admin)
