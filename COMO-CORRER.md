# Como correr o Velocely (sem ser programador)

Dois PCs (Mac e Windows) partilham a **mesma base de dados na cloud**.

## O que precisas (uma vez)

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/  
   Instala, abre e espera ficar verde / *Running*.
2. A **pasta do projeto** (com o ficheiro `.env.shared` dentro).

## Arrancar

| PC | O que fazer |
|----|-------------|
| **Mac** | Pasta `iniciar/Mac` → duplo-clique em **`INICIAR.command`** |
| **Windows** | Pasta `iniciar\Windows` → duplo-clique em **`INICIAR.bat`** |

Na primeira vez pode demorar 10–20 minutos. Depois o browser abre em **http://localhost:3080**.

Login: `ADMIN_EMAIL` e `ADMIN_PASSWORD` no ficheiro `.env.shared`.

## Parar

| PC | Ficheiro |
|----|----------|
| **Mac** | `iniciar/Mac/PARAR.command` |
| **Windows** | `iniciar\Windows/PARAR.bat` |

## Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| “Docker não está a correr” | Abre o Docker Desktop e espera 1 minuto; volta a clicar em INICIAR |
| Página não abre | Espera mais na 1.ª vez; depois abre http://localhost:3080 |
| Erro de configuração | Confirma que `.env.shared` existe na pasta raiz do projeto |

## Importante

- Não apagues nem publiques o ficheiro `.env.shared`.
- O que um PC grava, o outro vê (depois de atualizar a página).
