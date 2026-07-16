# Velocely

Plataforma de **gestão de produção** — orçamentos, encomendas e ordens de fabrico.

## Visão geral

| Módulo | Descrição |
|--------|-----------|
| Orçamentos | Cálculo de custos, margens e conversão em encomenda |
| Encomendas | Estados, pagamentos, recibos e alertas |
| Ordens de fabrico | Roteiros, progresso e calendário de produção |
| Catálogo | Artigos, máquinas, materiais, mão de obra, personalizações |
| Clientes | Ficha de cliente e rentabilidade |
| Administração | Utilizadores, perfis RBAC, branding e templates PDF |

## Stack

- **Frontend:** React 19, React Router, Tailwind CSS, Axios
- **Backend:** FastAPI, Motor (MongoDB), JWT, ReportLab
- **Base de dados:** MongoDB

## Estrutura do repositório

```
├── backend/           # API FastAPI
│   ├── app/
│   │   ├── api/       # Rotas HTTP
│   │   ├── core/      # Config, DB, segurança
│   │   ├── domain/    # Modelos
│   │   ├── repositories/
│   │   └── services/  # Custeio, PDF, storage, audit
│   ├── tests/
│   └── requirements.txt
├── frontend/          # Aplicação React
│   └── src/
│       ├── components/
│       ├── features/  # Módulos por domínio
│       └── lib/
├── docs/              # Documentação do projeto
└── README.md
```

## Pré-requisitos

- Node.js 18+ e Yarn
- Python 3.11+
- MongoDB 6+ em execução

## Configuração

### Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # ajustar variáveis
uvicorn server:app --reload --port 8000
```

### Frontend

```bash
cd frontend
yarn install
cp .env.example .env   # definir REACT_APP_BACKEND_URL
yarn start
```

A aplicação fica disponível em `http://localhost:3000`.

## Variáveis de ambiente

Ver ficheiros de exemplo:

- `backend/.env.example`
- `frontend/.env.example`

## Testes

```bash
cd backend
# com a API a correr em localhost:8000
set BACKEND_URL=http://localhost:8000
pytest tests/ -n 0
```

## Documentação

A documentação detalhada vive em [`docs/`](docs/). Alguns ficheiros estão preparados como estrutura vazia para preenchimento pela equipa.

## Licença

Proprietário — uso interno da equipa.
