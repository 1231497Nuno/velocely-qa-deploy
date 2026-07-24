# Arquitectura — visão geral

## Backend (Clean Architecture)

```
HTTP (api/routes)
    ↓
Serviços (services) — regras de negócio
    ↓
Repositórios (repositories) — acesso a dados
    ↓
MongoDB / storage local (uploads)
```

| Pasta | Responsabilidade |
|-------|------------------|
| `app/core` | Configuração, ligação à BD, JWT/RBAC |
| `app/domain` | Modelos Pydantic e constantes de domínio |
| `app/repositories` | Persistência MongoDB |
| `app/services` | Custeio, PDF, uploads, auditoria, seed, referências |
| `app/api/routes` | Endpoints HTTP finos |

Dependências: rotas → services/repositories → domain/core.  
Não importar `api` a partir de `domain`.

## Frontend

```
src/
  domain/              # formatadores e conceitos de UI-domínio
  infrastructure/api/  # cliente HTTP
  features/<módulo>/   # ecrãs por domínio de negócio
  components/          # UI partilhada
  lib/api.js           # fachada de compatibilidade
```

Novas features: `src/features/<nome>/`.  
Novos clientes HTTP: `src/infrastructure/api/`.

## Fluxo de negócio principal

```
Orçamento → Encomenda → Ordem de Fabrico
```

## Decisões pendentes

- [ ] Estratégia de deploy (Docker, VM, cloud)
- [ ] Backup e retenção de uploads
- [ ] Observabilidade (logs, métricas)
