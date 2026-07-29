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
from fastapi.openapi.utils import get_openapi
from starlette.middleware.cors import CORSMiddleware

from app.core import config
from app.core.database import client
from app.core.security import auth_router
from app.services.bootstrap import seed_perfis, seed_admin, seed_user_logins, seed_categorias
from app.services.numeracao import backfill_codigos
from app.repositories import users_repo
from app.api.routes.catalog import router as catalog_router
from app.api.routes.orcamentos import router as orcamentos_router
from app.api.routes.ordens_fabrico import router as ordens_router
from app.api.routes.clientes import router as clientes_router
from app.api.routes.encomendas import router as encomendas_router
from app.api.routes.financeiro import router as financeiro_router
from app.api.routes.settings import router as settings_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.admin import router as admin_router
from app.api.routes.historico import router as historico_router
from app.api.routes.uploads import router as uploads_router
from app.api.routes.referencias import router as referencias_router
from app.api.routes.io_excel import router as io_excel_router
from app.services.storage import init_storage

API_DESCRIPTION = """
## Velocely API

API de gestão de produção (orçamentos, encomendas, ordens de fabrico).

### Como autenticar no Swagger

1. Chama **`POST /api/auth/login`** com email/login e password
2. Copia o campo **`token`** da resposta
3. Clica em **Authorize** (cadeado no topo)
4. Cola o token (só o valor JWT — o Swagger acrescenta `Bearer` sozinho)
5. Confirma e testa os endpoints protegidos

O Swagger fala **diretamente com este backend** (`localhost:8000`).

### Público (sem token)

- `POST /api/auth/login`
- `GET /api/branding`
"""

app = FastAPI(
    title="Velocely API",
    description=API_DESCRIPTION,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    swagger_ui_parameters={
        "persistAuthorization": True,
    },
)

api_router = APIRouter(prefix="/api")
for r in (
    catalog_router, orcamentos_router, ordens_router, clientes_router,
    encomendas_router, financeiro_router, settings_router, analytics_router, admin_router,
    historico_router, uploads_router, referencias_router, io_excel_router,
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


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    schema.setdefault("components", {}).setdefault("securitySchemes", {})
    schema["components"]["securitySchemes"]["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Cole o JWT devolvido por POST /api/auth/login",
    }
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.on_event("startup")
async def _startup_seed_admin() -> None:
    try:
        init_storage()
    except Exception as e:
        logger.error(f"Storage init falhou: {e}")
    await users_repo.create_index("email", unique=True)
    await seed_perfis()
    await seed_admin()
    await seed_user_logins()
    try:
        await seed_categorias()
    except Exception as e:
        logger.error(f"Seed categorias falhou: {e}")
    try:
        await users_repo.create_index("login", unique=True)
    except Exception:
        pass
    try:
        stats = await backfill_codigos()
        assigned = sum(stats.values())
        if assigned:
            logger.info(f"Backfill códigos: {stats}")
    except Exception as e:
        logger.error(f"Backfill códigos falhou: {e}")


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    client.close()
