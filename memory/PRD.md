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

## Iteração (2026-06-27) — Múltiplas personalizações por linha
- Cada linha do orçamento permite **várias personalizações** (não só uma). Modelo `PersonalizacaoSel{id,nome,valor}` em `OrcamentoLinha.personalizacoes` e `OFItem.personalizacoes` (campos legados mantidos p/ retrocompat + migração no load do frontend).
- Decisão do utilizador: cada personalização é **acréscimo ao PREÇO final** (não custo, sem margem) e **por unidade** (× quantidade).
- Helpers `pers_valor_unit`/`pers_nomes`; `compute_orcamento_totais`, PDFs (orçamento + OF) e conversão Orçamento→OF atualizados para somar/propagar as personalizações.
- UI: célula "Personalização" com chips editáveis (€/un + remover) e dropdown "+ Adicionar"; coluna "Pers. €/un" mostra a soma. OF mostra todas as personalizações no roteiro.
- Validado via curl (total = (6+3.5)×2 = 19,00€; ['P1','P2'] propagadas para OF) e screenshot.

## Iteração (2026-06-27) — Design responsivo (Mobile-First)
- **Menu**: barra de topo com hambúrguer no mobile + drawer lateral retrátil (overlay + X), sidebar fixa no desktop (`Layout.jsx`).
- **Listas Orçamentos e OFs**: tabela no desktop (`hidden md:block`) + cartões empilhados no mobile (`md:hidden`), incluindo bola de cronómetro nos cartões de OF.
- **Tabelas CRUD** (Artigos, Materiais, Máquinas, Mão de Obra, Tipos): `overflow-x-auto` + `min-w` para scroll horizontal sem partir a página.
- **Detalhes**: cabeçalhos e botões com `flex-col sm:flex-row`/`flex-wrap`; grelhas de meta `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; tabela de linhas do orçamento em `overflow-x-auto`; banner do cronómetro da OF empilha no mobile.
- **Formulários** (diálogos Artigos/Materiais/Máquinas): grelhas passam a coluna única no mobile.
- **Dashboard**: gráficos recharts `ResponsiveContainer` à largura total; link obsoleto `/tempos`→`/analise-producao` corrigido.
- Tested: iteration_6.json — frontend 100% (8/8 requisitos, mobile 390px + desktop 1440px, body overflow=0).

## Iteração (2026-06-27) — Auth/RBAC + Materiais no Orçamento + Pesquisa global
- **Autenticação JWT + RBAC**: login por email (`/api/auth/login`, `/me`), bcrypt, perfis `admin`/`colaborador`. Admin seed via `ADMIN_EMAIL`/`ADMIN_PASSWORD` (admin@prodcost.pt / Admin123!, nome "Admin Geral"). Token em localStorage (Bearer). Frontend gate (`Protected`/`adminOnly`); `/api/users*` exige admin (403 colaborador). PDFs continuam públicos (links `<a>`).
- **Gestão de Utilizadores** (`/utilizadores`, admin-only): CRUD de utilizadores (criar/editar/eliminar, definir perfil/password).
- **Materiais soltos no Orçamento**: secção em `OrcamentoDetail` com dropdown de consumíveis; se unidade `m²` mostra campos Comprimento/Largura (mm). Custo = (C/1000)·(L/1000)·custo_unit·qtd; valor adicionado = custo×1.5 (markup 50%). Backend `material_custo`/`fill_materiais`; totais incluem `custo_materiais`/`total_materiais`; incluído no PDF do orçamento.
- **Pesquisa global** (`SearchBar`): filtragem em tempo real em Orçamentos, Ordens de Fabrico, Artigos, Materiais e Máquinas (por nome/cliente/nº encomenda/código).
- Tested: iteration_7.json — backend 8/8, frontend 100%. test_credentials.md atualizado.
