# PRD — ProdCost (Production Costing ERP)

## Original Problem Statement
Fase 2 (Orçamentação) + Fase 3 (Ordens de Fabrico) sobre app de custeio de produção.
- Fase 2: CRUD Tipos de Personalização; Orçamento (cliente, data, validade, numeração ORC-2026-0001), linhas com artigo (seletor pesquisável), quantidade, tipo personalização; cálculo custo×qtd+margem%→preço; listagem/detalhe/edição.
- Fase 3: OrdemFabrico (cliente, OF-2026-0001, data, status Pendente/Em Produção/Concluído); seleção artigos+personalização; auto-load roteiro de operações (máquinas+tempos); marcar operações concluídas; botão Converter Orçamento→OF.

## User Choices
- Numeração reinicia por ano. Margem GLOBAL por orçamento. Estados orçamento: Rascunho/Enviado/Aceite/Rejeitado. Conversão herda artigos+personalização. SEM autenticação.

## Architecture
- Backend FastAPI + MongoDB (motor), uuid string ids, per-year sequential counters collection.
- Frontend React + react-router + shadcn/ui + Tailwind. Swiss/high-contrast design (Chivo + IBM Plex Sans/Mono).

## Implemented (2026-06)
- Foundation: Máquinas (custo/h), Artigos (custos + roteiro de operações, custo_producao_total computado), Tipos de Personalização — full CRUD.
- Fase 2: Orçamentos listagem + detalhe/edição, linhas com combobox pesquisável de artigos, margem global, totais ao vivo, numeração ORC-YYYY-NNNN.
- Fase 3: Ordens de Fabrico listagem + detalhe, auto-load do roteiro ao guardar item, checkboxes de operações com transição automática de estado (pendente→em_producao→concluido) e barra de progresso, numeração OF-YYYY-NNNN.
- Conversão Orçamento(Aceite)→OF com herança de artigos/personalização e link bidirecional.
- Dashboard com estatísticas; endpoint /api/seed para dados demo.
- Tested: 12/12 backend pytest pass; frontend E2E flows pass.

## Backlog
- P1: Edição manual de estado da OF; impressão/PDF do orçamento; cálculo de tempo total de máquina por OF agregado.
- P2: Margem por linha (opcional); filtros/pesquisa nas listagens; histórico/auditoria; autenticação se necessário.

## Next Tasks
- Aguardar feedback do utilizador sobre Fase 2/3 e priorizar PDF de orçamento ou impressão de OF para o chão de fábrica.
