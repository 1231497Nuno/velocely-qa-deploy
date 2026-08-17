import re
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

FILE_MIME_TYPES = {
    **MIME_TYPES,
    "pdf": "application/pdf",
    "txt": "text/plain",
    "csv": "text/csv",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "odt": "application/vnd.oasis.opendocument.text",
    "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "zip": "application/zip",
}
MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB


async def store_upload(file: UploadFile, *, image_only: bool = False) -> dict:
    raw_name = file.filename or ("img.png" if image_only else "ficheiro")
    ext = raw_name.rsplit(".", 1)[-1].lower() if "." in raw_name else ("png" if image_only else "")
    allowed = MIME_TYPES if image_only else FILE_MIME_TYPES
    if ext not in allowed:
        if image_only:
            raise HTTPException(400, "Formato inválido. Use JPG, PNG, GIF ou WEBP.")
        raise HTTPException(400, "Formato inválido. Use PDF, imagem, Word, Excel, CSV, TXT ou ZIP.")
    data = await file.read()
    limit = MAX_BYTES if image_only else MAX_FILE_BYTES
    if len(data) > limit:
        mb = limit // (1024 * 1024)
        raise HTTPException(400, f"Ficheiro demasiado grande (máx. {mb} MB).")
    content_type = allowed[ext]
    path = f"{storage.APP_NAME}/uploads/{uuid.uuid4()}.{ext}"
    try:
        result = storage.put_object(path, data, content_type)
    except Exception as e:
        raise HTTPException(500, f"Falha ao carregar ficheiro: {e}")
    stored_path = result.get("path", path)
    size = result.get("size", len(data))
    await files_repo.insert({
        "id": new_id(),
        "storage_path": stored_path,
        "original_filename": raw_name,
        "content_type": content_type,
        "size": size,
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"path": stored_path, "nome": raw_name, "content_type": content_type, "size": size}


@router.post("/upload/imagem")
async def upload_imagem(file: UploadFile = File(...), _u: dict = Depends(get_current_user)):
    stored = await store_upload(file, image_only=True)
    return {"path": stored["path"]}


@router.post("/upload/ficheiro")
async def upload_ficheiro(file: UploadFile = File(...), _u: dict = Depends(get_current_user)):
    return await store_upload(file)


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
    media = record.get("content_type") or content_type
    raw_name = record.get("original_filename") or path.rsplit("/", 1)[-1]
    safe_name = re.sub(r'[\r\n"]', "", str(raw_name))[:180] or "ficheiro"
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )
