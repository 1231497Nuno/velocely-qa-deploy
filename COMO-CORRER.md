# Como correr o Velocely (sem ser programador)

Dois ambientes no **mesmo cluster Mongo Atlas**, com bases **separadas**:

| Ambiente | Branch git | Ficheiro env | Base de dados |
|----------|------------|--------------|---------------|
| **DEV**  | `DEV`      | `.env.dev`   | `velocely` (dados de trabalho) |
| **QA**   | `QA`       | `.env.qa`    | `velocely_qa` (vazia / testes) |
| **PROD** | `PROD`     | `.env.prod`  | `velocely_prod` (futuro) |

## O que precisas (uma vez)

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/  
   Instala, abre e espera ficar verde / *Running*.
2. A **pasta do projeto** (git clone ou cópia).
3. O ficheiro de ambiente certo (não vai para o git — pede a quem configurou):
   - DEV → `.env.dev`
   - QA → `.env.qa`

## Arrancar (QA noutro PC)

1. Abre um terminal na pasta do projeto e corre:
   ```bash
   git fetch
   git checkout QA
   git pull
   ```
2. Confirma que existe `.env.qa` na raiz (com `DB_NAME=velocely_qa`).
3. Duplo-clique:

| PC | Ficheiro |
|----|----------|
| **Mac** | `iniciar/Mac/INICIAR.command` |
| **Windows** | `iniciar\Windows\INICIAR.bat` |

Na primeira vez pode demorar 10–20 minutos. Depois o browser abre em **http://localhost:3080**.

Login: `ADMIN_EMAIL` e `ADMIN_PASSWORD` no ficheiro `.env.qa` (ou `.env.dev`).

## Parar

| PC | Ficheiro |
|----|----------|
| **Mac** | `iniciar/Mac/PARAR.command` |
| **Windows** | `iniciar\Windows\PARAR.bat` |

## Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| “Docker não está a correr” | Abre o Docker Desktop e espera 1 minuto; volta a clicar em INICIAR |
| Página não abre | Espera mais na 1.ª vez; depois abre http://localhost:3080 |
| “Falta o ficheiro de ambiente” | Copia `.env.qa.example` → `.env.qa` (ou `.env.dev`) e preenche `MONGO_URL` |
| Branch errada | `git checkout QA` (ou `DEV`) antes de INICIAR |

## Importante

- Não apagues nem publiques os ficheiros `.env.dev` / `.env.qa` / `.env.prod`.
- **DEV e QA não partilham dados** — são bases diferentes no mesmo cluster.
- O script `scripts/ensure-qa-db.sh` cria/marca a base `velocely_qa` (vazia de negócio).
