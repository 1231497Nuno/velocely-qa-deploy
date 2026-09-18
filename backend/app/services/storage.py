"""Armazenamento de ficheiros: disco local (DEV) ou GridFS no Mongo (QA/PROD).

No Render o disco efémero perde uploads em cada redeploy. Com
STORAGE_BACKEND=gridfs os ficheiros ficam na mesma base Atlas e sobrevivem.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, Tuple

from app.core import config

APP_NAME = "velocely"
log = logging.getLogger("velocely.storage")

_fs = None
_mongo_client = None


def backend() -> str:
    raw = (getattr(config, "STORAGE_BACKEND", None) or "").strip().lower()
    if raw in ("gridfs", "mongo", "mongodb"):
        return "gridfs"
    if raw in ("local", "disk", "filesystem"):
        return "local"
    # Default: GridFS se estiver em Render / ambiente remoto sem override
    if getattr(config, "IS_RENDER", False):
        return "gridfs"
    return "local"


def _root() -> Path:
    return Path(config.UPLOAD_DIR)


def init_storage() -> Path:
    root = _root()
    root.mkdir(parents=True, exist_ok=True)
    (root / APP_NAME / "uploads").mkdir(parents=True, exist_ok=True)
    return root


def _safe_path(path: str) -> Path:
    """Resolve path within upload root; reject path traversal."""
    root = _root().resolve()
    full = (root / path).resolve()
    if not str(full).startswith(str(root)):
        raise ValueError("Caminho de ficheiro inválido")
    return full


def _gridfs():
    global _fs, _mongo_client
    if _fs is not None:
        return _fs
    from gridfs import GridFS
    from pymongo import MongoClient

    _mongo_client = MongoClient(config.MONGO_URL, serverSelectionTimeoutMS=8000)
    _fs = GridFS(_mongo_client[config.DB_NAME], collection="fs_uploads")
    return _fs


def put_object(path: str, data: bytes, content_type: str) -> dict:
    ct = content_type or "application/octet-stream"
    if backend() == "gridfs":
        fs = _gridfs()
        for old in fs.find({"filename": path}):
            try:
                fs.delete(old._id)
            except Exception:
                pass
        fs.put(data, filename=path, contentType=ct, metadata={"content_type": ct})
        return {"path": path, "size": len(data), "content_type": ct, "backend": "gridfs"}

    init_storage()
    full = _safe_path(path)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    meta = full.with_suffix(full.suffix + ".meta")
    meta.write_text(ct, encoding="utf-8")
    return {"path": path, "size": len(data), "content_type": ct, "backend": "local"}


def get_object(path: str) -> Tuple[bytes, str]:
    """Lê ficheiro; tenta GridFS e, se falhar, disco local (migração)."""
    if backend() == "gridfs":
        try:
            return _get_gridfs(path)
        except FileNotFoundError:
            # Fallback: ficheiros antigos ainda no disco efémero
            try:
                return _get_local(path)
            except FileNotFoundError:
                raise
    try:
        return _get_local(path)
    except FileNotFoundError:
        if backend() != "gridfs":
            try:
                return _get_gridfs(path)
            except Exception:
                raise FileNotFoundError(path)
        raise


def _get_gridfs(path: str) -> Tuple[bytes, str]:
    fs = _gridfs()
    grid_out = fs.find_one({"filename": path})
    if not grid_out:
        raise FileNotFoundError(path)
    data = grid_out.read()
    ct = (
        getattr(grid_out, "contentType", None)
        or (grid_out.metadata or {}).get("content_type")
        or "application/octet-stream"
    )
    return data, ct


def _get_local(path: str) -> Tuple[bytes, str]:
    full = _safe_path(path)
    if not full.is_file():
        raise FileNotFoundError(path)
    data = full.read_bytes()
    meta = full.with_suffix(full.suffix + ".meta")
    content_type = "application/octet-stream"
    if meta.is_file():
        content_type = meta.read_text(encoding="utf-8").strip() or content_type
    return data, content_type


def delete_object(path: str) -> None:
    if backend() == "gridfs":
        fs = _gridfs()
        for old in fs.find({"filename": path}):
            try:
                fs.delete(old._id)
            except Exception:
                pass
        return
    try:
        full = _safe_path(path)
        if full.is_file():
            full.unlink()
        meta = full.with_suffix(full.suffix + ".meta")
        if meta.is_file():
            meta.unlink()
    except Exception:
        pass
