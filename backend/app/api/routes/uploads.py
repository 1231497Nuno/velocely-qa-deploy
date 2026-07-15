import uuid

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Header, Query
from fastapi.responses import Response

from app.core import config
from app.core.security import get_current_user
from app.core.database import new_id, now_iso
from app.repositories import Repository
from app.services import storage
import jwt

router = APIRouter()

files_repo = Repository("files")

MIME_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/upload/imagem")
async def upload_imagem(file: UploadFile = File(...), _u: dict = Depends(get_current_user)):
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
    if ext not in MIME_TYPES:
        raise HTTPException(400, "Formato inválido. Use JPG, PNG, GIF ou WEBP.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "Imagem demasiado grande (máx. 5 MB).")
    content_type = MIME_TYPES[ext]
    path = f"{storage.APP_NAME}/uploads/{uuid.uuid4()}.{ext}"
    try:
        result = storage.put_object(path, data, content_type)
    except Exception as e:
        raise HTTPException(500, f"Falha ao carregar imagem: {e}")
    stored_path = result.get("path", path)
    await files_repo.insert({
        "id": new_id(),
        "storage_path": stored_path,
        "original_filename": file.filename or "",
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"path": stored_path}


def _valid_token(auth_header):
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    try:
        jwt.decode(auth_header[7:], config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        return True
    except jwt.InvalidTokenError:
        return False


@router.get("/files/{path:path}")
async def download_file(path: str, authorization: str = Header(None), auth: str = Query(None)):
    header = authorization or (f"Bearer {auth}" if auth else None)
    if not _valid_token(header):
        raise HTTPException(401, "Não autenticado")
    record = await files_repo.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "Ficheiro não encontrado")
    try:
        data, content_type = storage.get_object(path)
    except Exception:
        raise HTTPException(404, "Ficheiro não encontrado")
    return Response(content=data, media_type=record.get("content_type") or content_type)
