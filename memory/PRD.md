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
- Foundation: Máquinas, Artigos, Tipos de Personalização — full CRUD.
- Fase 2: Orçamentos + Fase 3: Ordens de Fabrico (auto-load roteiro, conversão, estados).
- Iteração: módulo de custeio completo — **Materiais/Consumíveis** (nome, unidade por seleção, custo unitário), **Mão de Obra** (custo/hora), Artigo com receita de materiais + roteiro de operações.
- Iteração 3: **Máquinas** com custo de amortização/hora + energia/hora (opcional); **operações** com tempo em min OU horas (máquina e mão de obra independentes); **Artigo com margem de lucro → Preço de Venda** calculado. Custo lido ao vivo das bases (alterações de preço propagam-se).
- Tested: iteration_3.json 12/12 backend, 100% frontend.

## Backlog
- P1: Edição manual de estado da OF; impressão/PDF do orçamento; cálculo de tempo total de máquina por OF agregado.
- P2: Margem por linha (opcional); filtros/pesquisa nas listagens; histórico/auditoria; autenticação se necessário.

## Next Tasks
- Aguardar feedback do utilizador sobre Fase 2/3 e priorizar PDF de orçamento ou impressão de OF para o chão de fábrica.

## Iteração (2026-06-27)
- **Análise da Produção**: página `Tempos` renomeada para `AnaliseProducao.jsx` (rota `/analise-producao`, nav `nav-analise-producao`). Duas vistas: "Por Ordem de Fabrico" (tabela por OF + sub-tabs Tempos/Custos, vista existente) e "Análise Mensal" (gráfico recharts + tabela de desvios mensais estimado vs real, tempo e custo) ligada a `GET /api/producao/analise`.
- **Editor de operações por linha no Orçamento**: cada linha permite editar o `roteiro` (operações, máquina, mão de obra, tempos min/h) em `OrcamentoDetail.jsx`.
- **Bug fix**: `converter_orcamento` (server.py) agora propaga o `roteiro` personalizado de cada linha para `OF.itens[*].operacoes` (antes carregava sempre o roteiro default do artigo).
- **Bug fix**: import `Fragment` em falta em `OrcamentoDetail.jsx` (quebrava a página).
- Tested: iteration_5.json — frontend 100%; conversão com roteiro personalizado verificada via curl (CUSTOM_OP 7/11min herdada na OF).
