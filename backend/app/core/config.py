import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]  # backend/
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "velocely")
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")
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
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "uploads"))

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
