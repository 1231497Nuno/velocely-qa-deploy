# Deploy QA no Render (grátis)

## Antes (1 vez)

1. Conta em https://render.com (já feita)
2. GitHub ligado ao Render (Account Settings → Connections → GitHub)
3. Repo `or-amentos` com branch **`QA`** actualizada
4. No Atlas: Network Access com IP `0.0.0.0/0` (ou IPs do Render) para a API chegar à BD `velocely_qa`

## No Render — Blueprint

1. Dashboard → **New** → **Blueprint**
2. Escolhe o repo **or-amentos**
3. Branch do Blueprint: **`QA`** (ou a que tiver o `render.yaml`)
4. **Apply**
5. Quando pedir variáveis, preenche:

| Serviço | Variável | Valor |
|---------|----------|--------|
| `velocely-qa-api` | `MONGO_URL` | o mesmo URI do `.env.qa` |
| | `JWT_SECRET` | o do `.env.qa` |
| | `ADMIN_EMAIL` | `admin@velocely.local` |
| | `ADMIN_PASSWORD` | password do `.env.qa` |
| | `CORS_ORIGINS` | `https://velocely-qa-web.onrender.com` (ajusta ao nome real do static; depois acrescenta `https://testes.famart.pt`) |
| `velocely-qa-web` | `REACT_APP_BACKEND_URL` | **depois** do 1.º deploy da API: `https://velocely-qa-api.onrender.com` (URL exacta do serviço API, **sem** `/api`) |

6. Espera o deploy da **API** ficar *Live*
7. Copia a URL da API → mete em `REACT_APP_BACKEND_URL` no static site → **Manual Deploy** do web

## Domínio testes.famart.pt

1. No serviço **velocely-qa-web** → Settings → Custom Domains → `testes.famart.pt`
2. No cPanel do famart.pt: **CNAME** `testes` → hostname que o Render indicar
3. Actualiza `CORS_ORIGINS` na API para incluir `https://testes.famart.pt`
4. Redeploy da API

## Pipeline no dia-a-dia

```text
trabalho local → push/merge para QA
                 → GitHub Actions (CI)
                 → Render faz auto-deploy (API + web)
```

Produção (mais tarde): serviço à parte na branch `PROD` + BD `velocely_prod`.

## Notas free

- A API **adormece** ~15 min sem tráfego; o 1.º pedido pode demorar ~1 min (o frontend faz 1 retry automático)
- **Uploads**: `STORAGE_BACKEND=gridfs` (no `render.yaml`) grava fotos/ficheiros no Mongo Atlas — **não se perdem** em redeploy. Em DEV local continua disco (`uploads/`)
