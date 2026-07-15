"""Raiz de composição da aplicação (FastAPI).

A lógica está organizada em camadas (Clean Architecture):
  app/core         — config, base de dados, segurança/JWT
  app/domain       — modelos/entidades (Pydantic)
  app/repositories — acesso a dados (MongoDB, trocável por relacional)
  app/services     — regras de negócio (custeio, PDF, seed)
  app/api/routes   — endpoints HTTP (finos)
"""
import logging

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from app.core import config
from app.core.database import client
from app.core.security import auth_router
from app.services.bootstrap import seed_perfis, seed_admin, seed_user_logins
from app.repositories import users_repo
from app.api.routes.catalog import router as catalog_router
from app.api.routes.orcamentos import router as orcamentos_router
from app.api.routes.ordens_fabrico import router as ordens_router
from app.api.routes.clientes import router as clientes_router
from app.api.routes.encomendas import router as encomendas_router
from app.api.routes.settings import router as settings_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.admin import router as admin_router

app = FastAPI()

api_router = APIRouter(prefix="/api")
for r in (
    catalog_router, orcamentos_router, ordens_router, clientes_router,
    encomendas_router, settings_router, analytics_router, admin_router,
):
    api_router.include_router(r)

app.include_router(auth_router)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup_seed_admin():
    await users_repo.create_index("email", unique=True)
    await seed_perfis()
    await seed_admin()
    await seed_user_logins()
    try:
        await users_repo.create_index("login", unique=True)
    except Exception:
        pass


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
