# Arquitectura — visão geral

> Documento em construção. Preencher com diagramas e decisões da equipa.

## Camadas (backend)

```
HTTP (api/routes)
    ↓
Serviços (services) — regras de negócio
    ↓
Repositórios (repositories) — acesso a dados
    ↓
MongoDB
```

| Pasta | Responsabilidade |
|-------|------------------|
| `app/core` | Configuração, ligação à BD, JWT/RBAC |
| `app/domain` | Modelos Pydantic e constantes de domínio |
| `app/repositories` | Persistência MongoDB |
| `app/services` | Custeio, PDF, uploads, auditoria, seed |
| `app/api/routes` | Endpoints HTTP finos |

## Frontend

Organização por domínio em `src/features/<módulo>/`, com componentes partilhados em `src/components/`.

## Fluxo de negócio principal

```
Orçamento → Encomenda → Ordem de Fabrico
```

## Decisões pendentes

- [ ] Estratégia de deploy (Docker, VM, cloud)
- [ ] Backup e retenção de uploads
- [ ] Observabilidade (logs, métricas)
