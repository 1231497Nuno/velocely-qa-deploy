# API REST — visão geral

> Placeholder. Documentar endpoints, autenticação e códigos de erro.

## Autenticação

- JWT via header `Authorization: Bearer <token>`
- Login: `POST /api/auth/login` *(confirmar path exacto no código)*

## Módulos previstos para documentar

- [ ] Auth e utilizadores
- [ ] Catálogo (artigos, máquinas, materiais, mão de obra)
- [ ] Orçamentos
- [ ] Encomendas e pagamentos
- [ ] Ordens de fabrico
- [ ] Clientes
- [ ] Analytics / dashboard
- [ ] Uploads de imagens
- [ ] Histórico / auditoria
- [ ] Definições e templates PDF

## Convenções

- Prefixo base: `/api`
- Datas em ISO 8601
- Valores monetários em euros (decimal)
