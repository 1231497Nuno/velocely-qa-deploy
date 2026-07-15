# PRD — Velocely (Production Costing ERP)

> **Branding:** O software chama-se **Velocely**. Logótipo (wordmark) integrado em login/sidebar/mobile (clicável → Dashboard); subtítulo "Gestão de Produção".

## Iteração 24 (2026-07-14) — Página de detalhe do Cliente (360º) + gráfico Rentabilidade
- Backend: `GET /api/clientes/{cid}/resumo` (auth) — devolve dados do cliente + orçamentos, encomendas e OFs associados (match por `cliente_id` ou, em legado sem id, por nome) + estatísticas (nº orçamentos/aceites, nº encomendas/OFs, faturado, pago, pendente, custo real, margem).
- Frontend: nova `features/clientes/ClienteDetail.jsx` (rota `/clientes/:id`) com cartão de contactos, 6 KPIs e tabelas de Encomendas/Orçamentos/OFs com linhas clicáveis → navegam para o detalhe respetivo. Nome do cliente na lista (`Clientes.jsx`) passou a link.
- Rentabilidade por Cliente: adicionado gráfico de barras Faturado vs. Custo Real (recharts, top 8).
- Testado: endpoint (401 sem token + associações corretas) e UI (navegação lista→cliente→itens).

## Iteração 23 (2026-07-14) — Relatório de Rentabilidade por Cliente
- Backend: `GET /api/relatorios/rentabilidade-clientes` (auth) em `analytics.py` — agrega encomendas por cliente (exclui canceladas) via `compute_encomenda`: nº encomendas/OFs, valor faturado, pago, pendente, custo estimado/real, margem (faturado − custo real) e margem_pct. Ordenado por faturado desc.
- Frontend: nova feature `src/features/relatorios/RentabilidadeClientes.jsx` (KPIs + tabela + pesquisa), rota `/rentabilidade-clientes` (módulo `analise_producao`) e item de navegação `nav-rentabilidade` (PiggyBank).
- Testado: endpoint (401 sem token, dados corretos) + UI (KPIs, linha, nav presente).

## Iteração 22 (2026-07-14) — Refactor Clean Architecture (backend + frontend) — PARIDADE TOTAL

Objetivo: reorganizar o código para arquitetura limpa, sem alterar comportamento (paridade funcional confirmada 19/19 backend + todos os fluxos UI, iteration_21.json). NOTA: base de dados relacional NÃO é suportada nesta plataforma (só MongoDB); introduzida em vez disso uma **camada de repositórios agnóstica à BD**.

**Backend** — `server.py` (monólito ~2880 linhas) dividido em pacote `app/`:
- `app/core/` — `config.py` (env), `database.py` (client/db + helpers now_iso/new_id/round2/next_sequence), `security.py` (bcrypt/JWT, get_current_user, require_admin, auth_router /api/auth).
- `app/domain/models.py` — todos os modelos Pydantic + RBAC (perms_all/perms_colaborador) + constantes (STATUS_PT, PAY_PT, ENC_ESTADO_PT, PDF_SECOES).
- `app/repositories/__init__.py` — `Repository` genérico (find/get/insert/update/delete/count/...) que exclui `_id` via projection; instâncias por coleção. **Trocável por BD relacional sem tocar em serviços/rotas.**
- `app/services/` — `costing.py` (custeio, orçamento, OF build, encomenda), `pdf.py` (reportlab), `bootstrap.py` (seed perfis/admin).
- `app/api/routes/` — `catalog.py, orcamentos.py, ordens_fabrico.py, clientes.py, encomendas.py, settings.py, analytics.py, admin.py`.
- `server.py` fica como raiz de composição (~60 linhas): monta `api_router` prefix `/api`, inclui auth_router, CORS, seed no startup.

**Frontend** — páginas movidas de `src/pages/` para `src/features/<dominio>/` (dashboard, orcamentos, ordens_fabrico, encomendas, clientes, artigos, catalogo, producao, definicoes, utilizadores, auth). Componentes de funcionalidade (widgets, ArtigoForm, OrcamentoPanels, OFRoteiroPanel, OFItemOperacoes) movidos para o respetivo feature. Camada partilhada mantida em `src/components/` (ui + Layout/Combobox/etc.), `src/lib`, `src/context`, `src/hooks`, `src/constants`. Imports normalizados para alias `@/`.
- Rotas HTTP e contratos de dados inalterados. Nenhuma regressão.

## Iteração 21 (2026-07-14) — Preço unitário editável + notas por operação na OF
- **Preço unitário editável no Orçamento:** coluna "Preço Unit." passou a input editável. `OrcamentoLinha.preco_unit_manual` (bool); `fill_linha_custos` respeita o valor manual (não recalcula por custo×margem) e mantém o auto quando `false`. UI badge "manual · auto X" + botão repor. Propaga para Encomenda e OF na conversão.
- **Notas por operação na OF (no Roteiro):** `OFOperacao.nota`; endpoint `POST /api/ordens-fabrico/{id}/operacao/nota`; `OpNota` (textarea, guarda no blur), testid `op-nota-{op.id}`.

## Iteração 20 (2026-06-29) — Tempos da OF × quantidade + editor de operações
- **Tempos × quantidade:** cada operação da OF tem agora `tempo_maquina_base`/`tempo_mao_obra_base` (por unidade) e os tempos/custos estimados são `base × quantidade`, recalculados em cada save (`_apply_pers_tempo`, idempotente). Personalização continua a somar `tempo×qtd` à operação responsável.
- **Editor de operações na OF:** novo `OFItemOperacoes` por artigo no detalhe da OF — adicionar/editar/remover operações (nome, máquina, mão de obra, tempos por unidade), incluindo em OFs geradas automaticamente. Taxas €/h resolvidas no backend via `maquina_id`/`mao_obra_id` (fallback: derivar do custo antigo). `OFOperacao` ganhou `maquina_id`, `maquina_custo_hora`, `manual`.
- **Nota:** OFs antigas recalculam os tempos ×qtd no próximo save (comportamento esperado).
- Tested: iteration_20.json — backend 7/7 pytest, frontend 100%. Dados de teste limpos.

## Iteração 19 (2026-06-29) — Correções de qualidade
- **AuthContext:** `value` do Provider envolvido em `useMemo`; `login`/`logout` em `useCallback` (estabilidade referencial total, evita re-renders em cascata). Validado: login/logout/RBAC/sessão sem regressões (iteration_19.json, frontend 6/6).
- **Testes:** credenciais deixaram de estar hardcoded em `test_iteration17/18.py` (leem de env `TEST_ADMIN_*` ou `test_credentials.md`), alinhado com it15/it16.
- **Unidade de medida no artigo:** passou a `<select>` (lista igual aos materiais: un/kg/g/m/cm/m²/L/ml/folha/par/h). Logótipo clicável → Dashboard.
- **Falsos positivos do Code Quality Report (não alterados):** `is True/False/None` (idiomático), `secrets.token_urlsafe` em it11:71, "8 undefined vars" (pyflakes=0), index-keys em formulários editáveis, localStorage (decisão JWT-SPA), complexidade PDF/componentes (já refatorados nas it16-17).

## Iteração 18 (2026-06-29) — Personalizações na Encomenda + Unidade de medida + Logótipo
- **Encomenda como Orçamento:** secção de artigos permite adicionar/editar/remover personalizações por linha (chips + select + valor editável), com auto-save. Reflete no subtotal e valor total. `pers_valor_unit` suporta lista e formato legacy.
- **Unidade de medida no Artigo:** campo `unidade` (un/m²/kg/…) em `Artigo`/`ArtigoInput`; aparece junto à quantidade em Orçamentos, Encomendas e OFs. `OFItem.unidade`+`preco_unit` preenchidos em `build_of_itens` com backfill runtime em GET OF.
- **Logótipo Velocely:** wordmark integrado (login/sidebar/mobile), substitui texto.
- Tested: iteration_18.json — backend 12/12 pytest, frontend 100%. Title 'Velocely · Gestão de Produção' confirmado. Dados de teste limpos.

## Iteração 17 (2026-06-29) — Descontos + preços unitários + rebranding Velocely
- **Descontos (% ou €, toggle):** por linha de artigo e no total — em Orçamentos e Encomendas (não nas OFs). Backend: `desconto_valor()`, `compute_orcamento_totais()` (campos `desconto_linhas`/`subtotal_liquido`/`desconto_total_valor`), `encomenda_artigos_breakdown()`. Descontos de linha aplicados antes do desconto total (sobre subtotal líquido). PDFs de orçamento/encomenda mostram linhas de desconto.
- **Preços unitários:** colunas "Preço Unit." (artigo) + "Unit. c/Pers" (preço + personalizações/un) em Orçamentos e Encomendas; OF mostra preço unitário + total c/ personalizações (só leitura) via `OFItem.preco_unit`. Backfill runtime em `GET /api/ordens-fabrico/{id}` para OFs antigas.
- **Rebranding Velocely:** Layout (sidebar + mobile), Login, `index.html` title.
- Tested: iteration_17.json — backend 9/9 pytest, frontend 100%. Dados de teste limpos; contas reais intactas.

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

## Iteração (2026-06-27) — Pesquisa extra + Margem materiais por linha + Perfis/Permissões (RBAC)
- **Pesquisa** adicionada em Mão de Obra, Tipos de Personalização e Análise da Produção (vista Por OF).
- **Margem dos materiais editável por linha** no orçamento (campo Margem %, default 50%): valor = custo×(1+margem/100). Backend `material_margem_factor`; PDF mostra coluna Margem.
- **Perfis & Permissões (RBAC)**: perfis personalizáveis (`/api/perfis` CRUD) com permissões por módulo (10 módulos) e ação (view/create/edit/delete). Perfis de sistema: Administrador (acesso total, bloqueado) e Colaborador. `resolve_perfil`, `user_public` async devolve `perfil.permissoes`; `require_admin` = admin OU utilizadores.edit. Frontend: `can(modulo,acao)` no AuthContext, nav filtrada, rotas com `modulo`, gating de botões criar/editar/eliminar nas páginas; Gestão de Utilizadores com tabs Utilizadores + Perfis & Acessos (matriz de permissões).
- ⚠️ Contas reais do utilizador: `geral@famarte.pt` (admin), `m-p@live.com.pt` (colaborador). Admin de recuperação: `admin@prodcost.pt`/`Admin123!`.
- Tested: iteration_8.json — backend 8/8, frontend 100%, sem regressões.

## Iteração 15 (2026-06-28) — Tempo nas personalizações + Calendário de prazos
- **Tempo nas personalizações**: `TipoPersonalizacao.tempo` (min de mão de obra por unidade) e `MaoObra.responsavel_personalizacoes` (flag). Na OF, `_apply_pers_tempo` soma `Σ(tempo personalizações) × quantidade` à mão de obra da operação cuja mão de obra está marcada como responsável (fallback: 1ª operação). Idempotente via `OFOperacao.tempo_mao_obra_base` (repõe a base antes de somar — PUT não duplica). `OFOperacao.mao_obra_id` adicionado para identificar a operação. `PersonalizacaoSel.tempo` propagado. Verificado: base 2min + 5min×2 = 12min, custo 2,40€.
- **Calendário de prazos**: `GET /api/prazos` (auth) devolve encomendas (não concluídas/canceladas) e OFs (não concluídas) com `prazo_entrega`, `dias_restantes`, `estado_prazo` (atrasada/proxima≤7d/futura). Dashboard ganhou `prazos_atrasadas`/`prazos_proximos_7` + banner `dash-prazos-banner`→/calendario. Nova página `Calendario.jsx` (rota `/calendario`, nav `nav-calendario`): calendário (react-day-picker com modifiers de cor) + listas agrupadas (atrasados/próximos 7d/futuros).
- Frontend config: `MaoObra.jsx` (checkbox + coluna Personalizações), `TiposPersonalizacao.jsx` (campo + coluna Tempo M.O.).
- Tested: iteration_15.json — backend 6/6 PASS, frontend 100%, sem issues. Contas reais intactas.

## Iteração 16 (2026-06-28) — Refactor de qualidade (PDF builders + split de componentes)
- **Backend PDF**: extraídos helpers partilhados `_th_row`, `_data_table` (com `_TABLE_BASE_STYLE`) e `_totais_table`; usados por `build_orcamento_pdf`/`build_of_pdf`/`build_encomenda_pdf` — complexidade reduzida, output PDF idêntico.
- **Frontend split**: Dashboard→`components/dashboard/widgets.jsx` (Stat/PrazosBanner/charts), Artigos→`components/artigos/ArtigoForm.jsx`, OrdemFabricoDetail→`components/of/OFRoteiroPanel.jsx`, OrcamentoDetail→`components/orcamento/OrcamentoPanels.jsx` (OrcamentoMateriais+OrcamentoTotais). Reduções: Dashboard 258→~100, Artigos 335→168, OF detail 333→281, Orçamento detail 448→363.
- **Hooks**: `load` envolvido em `useCallback` + adicionado às deps do `useEffect` em 12 páginas de listagem (corrige avisos exhaustive-deps reais).
- **Code Quality Report — falsos positivos** (não alterados): `is True/False/None` (idiomático), "secret" em test_iteration11.py:71 (= `secrets.token_urlsafe`), index-keys em linhas de formulário totalmente editáveis (decisão), token em localStorage (padrão JWT SPA aceitável).
- Tested: iteration_16.json — backend 15/15, frontend 0 console errors em todas as páginas. ZERO regressões.



## Iteração (2026-06-28) — Prazo de entrega, prioridade de OFs e filtro de encomendas
- **Encomendas concluídas saem dos pendentes**: filtro "Pendentes | Concluídas | Todas" em `Encomendas.jsx` (default Pendentes). Concluída/cancelada não aparecem em Pendentes.
- **Prazo de entrega** (`EncomendaInput.prazo_entrega`): campo na criação e no detalhe (auto-guardado), coluna na lista (a vermelho se vencido e não concluído).
- **OFs ordenadas pelo prazo da encomenda**: `list_ofs` junta a encomenda e ordena por `(prioritaria, prazo_entrega asc, created_at)`; cada OF mostra a coluna "Prazo entrega" herdada.
- **OFs prioritárias**: `OrdemFabricoInput.prioritaria` + endpoint `POST /api/ordens-fabrico/{id}/prioridade`. Estrela na lista (salta para o topo), badge + botão "Prioridade" no detalhe; preservada no PUT.
- Tested: iteration_14.json — backend 6/6 PASS, frontend sem issues.


- **OFs — várias personalizações por artigo**: editor de itens passou a permitir adicionar/remover várias personalizações (chips + select "+ Adicionar personalização"), como nos Orçamentos. O modelo `OFItem.personalizacoes` já existia; UI em `OrdemFabricoDetail.jsx` (`addItemPers`/`delItemPers`). Persiste em POST/PUT; o roteiro mostra todas.
- **PDFs — seleção campo-a-campo + dados cruzados**:
  - `PDF_SECOES`: a secção `dados_cliente` ganhou subcampos selecionáveis (`cliente_nome/nif/morada/codigo_postal/cidade/pais/telefone/email`); OF e Encomenda ganharam a secção `orcamento_origem`.
  - Helpers `cliente_meta_pairs()` (puxa dados do registo Cliente — cross-data) e `orcamento_origem_pairs()`. Builders recebem `cliente`/`orcamento`; endpoints `/pdf` fazem `_fetch_cliente`/`_fetch_orcamento`.
  - `Definicoes.jsx` Modelos: subcheckboxes indentados por campo; desligar a secção esmaece os subcampos; `allOn()` inclui subcampos.
- Tested: iteration_13.json — backend 11 PASS/1 skip, frontend sem issues. Contas reais intactas.


- **Segurança (crítico)**: removidos secrets hardcoded de `tests/test_iteration9.py` e `test_iteration11.py` — credenciais admin lidas de `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` ou parse de `/app/memory/test_credentials.md` (`_load_admin_creds`). 29/29 testes a passar.
- **React**: `useMemo` para a morada completa do cliente em `EncomendaDetail.jsx`; keys de array estáveis em `OrdemFabricoDetail.jsx` (it.id, op.id, p.id), `AnaliseProducao.jsx` e chips de personalização em `OrcamentoDetail.jsx`. Corrigido bug de conflito de edição paralela (`moradaCompleta` em falta) — validado.
- **Decisão**: mantidas as index-keys em linhas de formulário totalmente editáveis (OrcamentoDetail linhas/roteiro, Artigos materiais/roteiro) porque todos os inputs são controlados por dados e os handlers são por índice — converter a IDs seria refactor de risco sem benefício funcional. NÃO se migrou o token de localStorage para cookies httpOnly (exigiria reescrita do fluxo de auth com integration_expert; padrão JWT em SPA é aceitável). Refactors de complexidade (PDF builders, componentes grandes) ficam como backlog P2.
- Tested: iteration_12.json — backend e frontend sem issues (regressão limpa).


- **Definições (admin)** — nova página `/definicoes` (`Definicoes.jsx`) com 2 tabs:
  - **Empresa**: nome, logótipo (upload base64, máx. 600KB), morada, CP, cidade, país, NIF, telefone, email, website, rodapé. Guardado em `empresa_settings` (singleton) via `GET/PUT /api/settings/empresa` (PUT só admin). Aparece no cabeçalho de todos os PDFs.
  - **Modelos PDF**: CRUD de modelos reutilizáveis por módulo (orçamento/of/encomenda). Cada modelo define `finalidade` (cliente/interno/ambos), `mostrar_branding` e que secções incluir (checkboxes). Endpoints `GET /api/pdf-secoes`, `GET/POST/PUT/DELETE /api/pdf-templates` (escrita só admin).
- **Geração de PDF parametrizada**: `build_orcamento_pdf`, `build_of_pdf` e o novo `build_encomenda_pdf` recebem `(data, settings, fields, show_branding)` e respeitam `section_on()` para incluir/omitir secções. `_header` desenha branding+logótipo (`_logo_flowable`) e `_pdf_footer` o rodapé. Endpoints `/pdf` aceitam `?template_id=`.
- **PDF de Encomenda novo** (`/api/encomendas/{id}/pdf`): cliente, artigos, valor total, pagamento (pago/pendente/estado), OFs associadas+estado, notas — secções configuráveis por modelo.
- **PdfExportButton** (`components/PdfExportButton.jsx`): popover em Orçamento/OF/Encomenda com "Completo (todos os campos)" + lista de modelos do módulo; abre o PDF em nova aba.
- Tested: iteration_11.json — backend 15/15 PASS (settings, secções, CRUD modelos, permissões 403 a colaborador, geração %PDF com/sem template em 3 módulos); UI Playwright OK (Definições, persistência, popovers nos 3 detalhes). Existem 3 modelos exemplo (1/módulo). Contas reais intactas.


- **Regra de tempos/custos**: o cronómetro de cada operação regista **apenas o tempo real de mão de obra** do colaborador; o **tempo de máquina é totalizado pela estimativa** (não cronometrado). **Custo real = custo de máquina (estimado) + custo de mão de obra (tempo real × custo/hora)**.
- `OFOperacao` ganhou `custo_maquina_estimado`, `custo_mao_obra_estimado`, `mao_obra_custo_hora` (gravados em build_of_itens e na conversão). Helpers `op_machine_cost_est`, `op_labor_rate`, `op_custo_real` com fallback para OFs antigas.
- Atualizados `producao/tempos` (tempo_maquina_total, tempo_mao_obra_real_min, tempo_real_min = máq.totalizada + m.obra real; custo_real via op_custo_real), `producao/analise`, `compute_encomenda` (custo_producao_real) e `dashboard` (tempo_por_of real = máq + m.obra real).
- Frontend OF: cronómetro rotulado "Tempo de mão de obra (real)"; bloco com "Tempo de máquina (totalizado)", "Mão de obra estimada" e estimativa total. Nota na Análise da Produção atualizada.
- Validado via script: op custo_real = custo_maq_est + (real_seg/3600)×custo/hora (ex.: 0,40 + 0,01 = 0,41€); OF tempo_real = máq totalizada + m.obra real.

## Iteração (2026-06-28) — Auto-guardar Encomenda + KPIs de tempos/custos no Dashboard
- **Auto-guardar** no detalhe da Encomenda: adicionar/remover artigos e alterar quantidade/preço/valor pago/autorização persistem automaticamente (PUT) e os KPIs recalculam de imediato (toasts discretos; botão Guardar mantido).
- **Dashboard**: reposto gráfico "Tempo de Produção · estimado vs real (min)" + cartão "Tempos & Custos (totais)" (tempo estimado/real + desvio, custo estimado/real + desvio).


- **Combobox genérico** (`components/Combobox.jsx`): dropdown pesquisável reutilizável. `ClienteSelector` passou a usá-lo (pesquisa por nome/cidade/NIF) em Orçamentos, OFs e Encomendas; selecção de artigos na Encomenda também é Combobox.
- **Clientes expandidos**: novos campos `codigo_postal`, `cidade`, `pais` (default "Portugal") no modelo + formulários (Clientes e criação inline). Lista mostra coluna Cidade.
- **Workflow avançado de Encomendas**:
  - Modelo `Encomenda` ganhou `artigos` (lista `EncomendaArtigo` com preco_unit+personalizacoes), `valor_total` (+`valor_total_manual`), `valor_pago`, `autorizada_producao`.
  - `compute_encomenda` (server.py): valor_total auto = total do orçamento associado (inclui operações/máquinas/personalizações) OU soma dos artigos; editável manualmente. status_pagamento derivado (pendente/parcial/pago) de valor_pago vs valor_total. `pode_produzir` = pago total OU autorizada_producao. estado auto (aberta/em_producao/concluida) a partir das OFs; auto-conclui quando todas as OFs concluídas.
  - **Gate de produção**: `iniciar_operacao` devolve 403 se a encomenda associada não estiver paga nem autorizada (frontend mostra toast).
  - Conversão Orçamento→Encomenda popula `enc.artigos` (das linhas) e `valor_total` (= total do orçamento).
  - `EncomendaDetail.jsx` revamp: KPIs (valor, pago/pendente, custo real vs estimado, margem), editor de artigos, gestão de pagamento (input + "Pago total"), toggle de autorização manual, indicador de produção. Lista de Encomendas mostra Valor + badge de Pagamento.
- **Dashboard revamp** (`Dashboard.jsx` + `GET /api/dashboard`): KPIs de encomendas (valor, recebido/pendente, custo produção real vs estimado, margem, por autorizar); gráfico Valor encomenda vs Custo produção (estimado/real); pie Encomendas por pagamento; mantém OFs por estado, valor de orçamentos/mês e top artigos.
- Tested: iteration_10.json — backend 7/7 PASS (incl. gate 403→200, valor auto, conversão). Combobox confirmado a filtrar com escrita real (artefacto só no `fill` do Playwright). Contas reais intactas.
- **Clientes** (novo módulo): CRUD (nome, morada, contacto, email, NIF, notas) com pesquisa. `/api/clientes` (protegido por auth).
- **Seletor de cliente** (`ClienteSelector`): dropdown de clientes existentes + botão "+ Novo" (criação inline), usado em Orçamentos, Ordens de Fabrico e Encomendas. Orçamento/OF guardam `cliente_id`.
- **Encomendas** (novo módulo): criação manual (numeração `ENC-2026-XXXX`) e **auto-criação na conversão Orçamento→OF** (encomenda com o cliente; OF ligada via `encomenda_id`/`encomenda_numero`). Detalhe da encomenda mostra info do cliente + OFs associadas + botão "Criar Ordem de Fabrico" (`POST /api/encomendas/{id}/ordens-fabrico`). `/api/encomendas` protegido por auth.
- **OF** mostra a encomenda a que pertence (link no cabeçalho).
- RBAC: novos módulos `clientes` e `encomendas` (com migração dos perfis existentes; Colaborador recebe view/create/edit por defeito).
- Tested: iteration_9.json — backend 14/14, frontend 100%. Endpoints clientes/encomendas passaram a exigir token (401 sem auth).
