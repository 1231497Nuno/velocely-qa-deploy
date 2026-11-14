import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]  # backend/
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "velocely")
_JWT_DEFAULT = "change-me-in-production"
_ADMIN_PASS_DEFAULT = "Admin123!"
JWT_SECRET = os.environ.get("JWT_SECRET", _JWT_DEFAULT)
JWT_ALGORITHM = "HS256"
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@velocely.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", _ADMIN_PASS_DEFAULT)
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "uploads"))
# local | gridfs — no Render usa gridfs por omissão (uploads sobrevivem a redeploys)
STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "").strip().lower()
IS_RENDER = bool(os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID"))
# local | qa | prod — controla docs e política de segredos
APP_ENV = (os.environ.get("APP_ENV") or os.environ.get("ENV") or ("qa" if IS_RENDER else "local")).strip().lower()
ALLOW_INSECURE_DEFAULTS = os.environ.get("ALLOW_INSECURE_DEFAULTS", "").lower() in ("1", "true", "yes")
ENABLE_DOCS = os.environ.get("ENABLE_DOCS", "").lower() in ("1", "true", "yes") or APP_ENV == "local"


def assert_secure_secrets() -> None:
    """Em QA/PROD recusa JWT/admin default (a menos que ALLOW_INSECURE_DEFAULTS=1)."""
    if ALLOW_INSECURE_DEFAULTS or APP_ENV == "local":
        return
    problems = []
    if not JWT_SECRET or JWT_SECRET == _JWT_DEFAULT or len(JWT_SECRET) < 24:
        problems.append("JWT_SECRET fraco ou default (define um segredo ≥24 chars)")
    if ADMIN_PASSWORD == _ADMIN_PASS_DEFAULT:
        problems.append("ADMIN_PASSWORD ainda é o default Admin123!")
    if problems:
        msg = "Segurança: recusar arranque em " + APP_ENV + " — " + "; ".join(problems)
        print(msg, file=sys.stderr)
        raise SystemExit(msg)

# Email / SMTP (opcional — sem isto, códigos de password aparecem nos logs em dev)
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "") or SMTP_USER
SMTP_TLS = os.environ.get("SMTP_TLS", "true").lower() in ("1", "true", "yes")
EMAIL_LOGO_PATH = os.environ.get("EMAIL_LOGO_PATH", "")
# URL pública do logo (HTTPS). Se definido, o email usa <img src> sem embutir ficheiro.
EMAIL_LOGO_URL = os.environ.get("EMAIL_LOGO_URL", "")
