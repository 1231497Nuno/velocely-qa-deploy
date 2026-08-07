# Ambientes e deploy — Velocely

## Correr em qualquer PC (Mac / Windows + Atlas)

Guia simples: **[COMO-CORRER.md](../../COMO-CORRER.md)**  
Scripts: pasta **`iniciar/Mac`** e **`iniciar/Windows`**.

Resumo:
1. MongoDB Atlas (M0 free) + ficheiro `.env.shared`
2. Docker Desktop
3. Duplo-clique em `iniciar/Mac/INICIAR.command` ou `iniciar/Windows/INICIAR.bat`
4. Mesma base de dados na cloud nos dois PCs

---

| Ambiente | O quê | Base de dados |
|----------|--------|----------------|
| **Local** | `uvicorn` + `npm start` no teu Mac | Mongo em `localhost:27017` |
| **Staging (Docker)** | App num contentor, acessível em `http://localhost:3080` | Mongo no Docker **ou** MongoDB Atlas |
| **Produção** | Mesmo stack Docker num VPS / cloud | Atlas (recomendado) — BD separada |

O objectivo do staging: **testar com dados reais/demo sem misturar com a BD local**, e poder partilhar o ambiente (ou só a BD remota).

---

## Opção rápida — tudo no Docker (recomendado para começar)

Precisas de [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
# 1) Configurar
cp .env.staging.example .env.staging
# Edita JWT_SECRET e ADMIN_PASSWORD (gera: openssl rand -hex 32)

# 2) Subir Mongo + API + UI
chmod +x scripts/staging-up.sh scripts/seed-staging.sh
./scripts/staging-up.sh

# 3) Inserir dados de teste
./scripts/seed-staging.sh
```

Abre **http://localhost:3080**  
Login: valores de `ADMIN_EMAIL` / `ADMIN_PASSWORD` no `.env.staging`.

API docs: http://localhost:8000/docs

### Recriar dados do zero

```bash
./scripts/seed-staging.sh --direct --reset
```

(`--direct` fala com o Mongo na porta `27018`; `--reset` apaga catálogo/negócio e volta a criar.)

### Parar

```bash
docker compose --env-file .env.staging down
# Apagar também os dados do Mongo:
docker compose --env-file .env.staging down -v
```

---

## Opção remota — MongoDB Atlas + app em Docker

Ideal para testar “como produção” com a base **na cloud** (não no teu PC).

### 1. Criar cluster Atlas (grátis M0)

1. Conta em https://www.mongodb.com/cloud/atlas  
2. Create cluster → **M0 Free**  
3. **Database Access** → user + password  
4. **Network Access** → Add IP (`0.0.0.0/0` para testes; restringe depois)  
5. **Connect** → Drivers → copia o URI `mongodb+srv://...`

### 2. Configurar `.env.staging`

```bash
cp .env.staging.example .env.staging
```

```env
MONGO_URL=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
DB_NAME=velocely_staging
JWT_SECRET=<openssl rand -hex 32>
ADMIN_EMAIL=admin@staging.teu-dominio.com
ADMIN_PASSWORD=<password-forte>
CORS_ORIGINS=http://localhost:3080
```

### 3. Arrancar só API + UI (sem Mongo local)

```bash
./scripts/staging-up.sh --remote
./scripts/seed-staging.sh
```

Os dados ficam no Atlas. Podes apontar outra máquina / VPS ao mesmo `MONGO_URL`.

---

## Desenvolvimento local a apontar para Atlas

Sem Docker — só a BD remota:

```bash
# backend/.env
MONGO_URL=mongodb+srv://...
DB_NAME=velocely_staging
JWT_SECRET=...
CORS_ORIGINS=http://localhost:3000

cd backend && source .venv/bin/activate
uvicorn server:app --reload --port 8000

# noutro terminal
cd frontend
# .env → REACT_APP_BACKEND_URL=http://localhost:8000
npm start

# seed
cd backend && python scripts/seed_dev.py --env-file ../.env.staging
# ou
python scripts/seed_dev.py --api --url http://localhost:8000
```

---

## O que o seed cria

- Catálogo: máquinas, materiais, mão de obra, personalização, artigos, categorias  
- Negócio: 4 clientes, orçamentos (vários estados), encomendas, OFs  
- **Não** apaga utilizadores/perfis (excepto com fluxo de reset das collections de negócio)

Também podes, com a app aberta e login admin: Dashboard → **Criar dados demo**.

---

## Checklist antes de “produção a sério”

- [ ] `JWT_SECRET` único e forte  
- [ ] `ADMIN_PASSWORD` alterada  
- [ ] `DB_NAME` diferente de staging (`velocely` vs `velocely_staging`)  
- [ ] Atlas Network Access restrito aos IPs do servidor  
- [ ] Backup Atlas activo  
- [ ] `CORS_ORIGINS` só com o domínio real do frontend  
- [ ] HTTPS (Caddy / nginx / Cloudflare) à frente do `web`  
- [ ] Nunca correr `--reset` na BD de produção  

---

## Ficheiros relevantes

| Ficheiro | Função |
|----------|--------|
| `docker-compose.yml` | Mongo + API + UI |
| `docker-compose.remote.yml` | API + UI (BD externa) |
| `.env.staging.example` | Modelo de variáveis |
| `scripts/staging-up.sh` | Sobe o ambiente |
| `scripts/seed-staging.sh` | Dados de teste |
| `backend/scripts/seed_dev.py` | Motor do seed |
