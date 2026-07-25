# Getting started

Guia rápido para arrancar o Velocely em desenvolvimento.

## Checklist

1. Clonar o repositório  
2. Ter **MongoDB** a correr (`mongodb://localhost:27017`)  
3. Configurar `backend/.env` a partir de `backend/.env.example`  
4. Configurar `frontend/.env` a partir de `frontend/.env.example`  
5. Arrancar backend e frontend (ver abaixo)  
6. Entrar na app com o admin do `.env`

## Arranque

### Backend (porta 8000)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # se ainda não existir
uvicorn server:app --reload --port 8000
```

### Frontend (porta 3000)

```bash
cd frontend
npm install --legacy-peer-deps   # ou yarn install
cp .env.example .env
npm start
```

## Onde abrir o quê (localhost)

| URL | O que é |
|-----|---------|
| **http://localhost:3000** | **Aplicação** (interface React) — usa isto no dia a dia |
| **http://localhost:3000/login** | Ecrã de login |
| **http://localhost:8000/docs** | **Swagger UI** — documentação interativa da API (testar endpoints) |
| **http://localhost:8000/redoc** | **ReDoc** — documentação da API em modo leitura |
| **http://localhost:8000/openapi.json** | Especificação OpenAPI em JSON |
| **http://localhost:8000/api** | Prefixo dos endpoints JSON (não é documentação) |

Mais detalhe: [api/overview.md](../api/overview.md).

## Contas de desenvolvimento

Definidas em `backend/.env` (não commits passwords no Git):

| Campo | Valor típico (exemplo) |
|-------|-------------------------|
| Email / login | `admin@velocely.local` ou `admin` |
| Password | valor de `ADMIN_PASSWORD` no `.env` |

Por defeito no `.env.example`: `Admin123!` (alterar em ambientes reais).

## Dados de teste

Com o MongoDB a correr (e o venv do backend ativo):

```bash
# Na raiz do repo
./scripts/seed-dev.sh

# Ou a partir de backend/
python scripts/seed_dev.py
```

| Comando | Efeito |
|---------|--------|
| `./scripts/seed-dev.sh` | Cria catálogo + clientes/orçamentos/encomendas/OFs se ainda não existirem |
| `./scripts/seed-dev.sh --reset` | Apaga esses dados e volta a criar (não mexe em users/perfis) |
| `./scripts/seed-dev.sh --api` | Idem via `POST /api/seed` (backend tem de estar em `:8000`) |

Também podes chamar **Authorize** no Swagger e `POST /api/seed` (requer admin).

## Problemas comuns

| Sintoma | Verificar |
|---------|-----------|
| CORS no browser | `CORS_ORIGINS` no backend (incluir `http://localhost:3000`) |
| MongoDB inacessível | `MONGO_URL` e se o `mongod` está a correr |
| Frontend sem dados | `REACT_APP_BACKEND_URL=http://localhost:8000` no frontend `.env` |
| 401 em tudo | Fazer login; JWT válido no header `Authorization` |
| “Não vejo Swagger em /api” | Abrir **/docs**, não `/api` |
