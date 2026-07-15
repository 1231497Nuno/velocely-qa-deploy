import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]  # /app/backend
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@prodcost.pt")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
