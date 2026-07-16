"""Armazenamento local de ficheiros (uploads de imagens)."""
from pathlib import Path

from app.core import config

APP_NAME = "velocely"


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


def put_object(path: str, data: bytes, content_type: str) -> dict:
    init_storage()
    full = _safe_path(path)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    meta = full.with_suffix(full.suffix + ".meta")
    meta.write_text(content_type or "application/octet-stream", encoding="utf-8")
    return {"path": path, "size": len(data), "content_type": content_type}


def get_object(path: str):
    full = _safe_path(path)
    if not full.is_file():
        raise FileNotFoundError(path)
    data = full.read_bytes()
    meta = full.with_suffix(full.suffix + ".meta")
    content_type = "application/octet-stream"
    if meta.is_file():
        content_type = meta.read_text(encoding="utf-8").strip() or content_type
    return data, content_type
