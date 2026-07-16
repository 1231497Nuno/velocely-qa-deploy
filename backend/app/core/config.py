import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]  # backend/
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "velocely")
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@velocely.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "uploads"))
