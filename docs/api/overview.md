# API REST — visão geral

A API do Velocely é feita com **FastAPI**. Em desenvolvimento, além dos endpoints JSON, o servidor expõe documentação interativa automática.

## URLs em localhost (backend na porta 8000)

| URL | O que é | Para que serve |
|-----|---------|----------------|
| [http://localhost:8000/docs](http://localhost:8000/docs) | **Swagger UI** | Interface visual para explorar e testar todos os endpoints (método, path, body, respostas). Podes fazer login e chamar rotas autenticadas a partir daqui. |
| [http://localhost:8000/redoc](http://localhost:8000/redoc) | **ReDoc** | Documentação da API em formato de leitura (mais limpa que o Swagger). Ideal para consultar contratos sem executar pedidos. |
| [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json) | **OpenAPI (JSON)** | Especificação formal da API (schema). Usada por ferramentas, geradores de cliente e o próprio Swagger/ReDoc. |
| [http://localhost:8000/api](http://localhost:8000/api) | **Prefixo da API** | Base de todos os endpoints de negócio (`/api/auth/login`, `/api/orcamentos`, …). **Não** é a documentação — devolve JSON. |

### O que **não** é documentação

- `http://localhost:8000/api` → API de dados  
- `http://localhost:3000` → aplicação React (interface do utilizador)

---

## Explicação rápida dos termos

### Swagger UI (`/docs`)
Página gerada automaticamente a partir do código FastAPI. Lista cada rota, parâmetros e modelos. Permite:
1. Clicar em **Authorize** e colar um JWT (`Bearer <token>`)
2. Executar pedidos (Try it out) contra o teu backend local

### ReDoc (`/redoc`)
Vista alternativa da mesma especificação OpenAPI, orientada a leitura. Não substitui o Swagger para testes interativos.

### OpenAPI
Standard (antes chamado Swagger Spec) que descreve a API em JSON/YAML. O ficheiro em `/openapi.json` é a “fonte” que o Swagger e o ReDoc usam.

### JWT (autenticação)
A maioria dos endpoints exige o header:

```http
Authorization: Bearer <token>
```

O token obtém-se em `POST /api/auth/login` com email/login e password.

---

## Autenticação

| Endpoint | Auth | Descrição |
|----------|------|-----------|
| `POST /api/auth/login` | Não | Devolve `{ token, user }` |
| `GET /api/auth/me` | Sim | Utilizador atual |
| `GET /api/branding` | Não | Branding público para o ecrã de login |
| Restantes `/api/...` | Sim (+ RBAC) | Requer JWT; permissões por módulo (`view` / `create` / `edit` / `delete`) |

### Testar no Swagger (ligado a este backend)

1. Abre http://localhost:8000/docs  
2. Expande **`POST /api/auth/login`** → Try it out, body exemplo:
   ```json
   { "login": "admin@velocely.local", "password": "Admin123!" }
   ```
3. Copia o campo **`token`** da resposta  
4. Clica o botão **Authorize** (cadeado no topo direito)  
5. Cola **só o token** (o Swagger adiciona `Bearer` automaticamente) → Authorize  
6. Os endpoints com cadeado passam a enviar o JWT para **este** servidor (`localhost:8000`)

O botão Authorize usa o esquema **HTTP Bearer (JWT)** definido no backend (`BearerAuth`).
A autorização fica guardada na sessão do browser (`persistAuthorization`).

---

## Prefixo e convenções

- Prefixo base: `/api`
- Datas em ISO 8601
- Valores monetários em euros (decimal)
- Códigos típicos: `200` OK, `401` não autenticado, `403` sem permissão, `404` não encontrado

## Módulos da API (por pasta de rotas)

| Área | Exemplos de paths |
|------|-------------------|
| Auth / utilizadores | `/api/auth/*`, `/api/users`, `/api/perfis` |
| Catálogo | `/api/artigos`, `/api/maquinas`, `/api/consumiveis`, `/api/mao-obra` |
| Orçamentos | `/api/orcamentos` |
| Encomendas | `/api/encomendas` |
| Ordens de fabrico | `/api/ordens-fabrico` |
| Clientes | `/api/clientes` |
| Analytics | `/api/dashboard`, `/api/producao/*`, `/api/search` |
| Uploads | `/api/upload/imagem`, `/api/files/...` |
| Definições | `/api/settings/empresa`, `/api/pdf-templates` |
| Histórico | `/api/historico` |

A lista completa e sempre atualizada está em **/docs** (Swagger) enquanto o backend estiver a correr.
