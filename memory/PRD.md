# PRD — Velocely (Production Costing ERP)

> **Branding:** O software chama-se **Velocely**. Logótipo (wordmark) integrado em login/sidebar/mobile (clicável → Dashboard); subtítulo "Gestão de Produção".

## Iteração 38 (2026-07-15) — Progresso de produção da Encomenda + Página de detalhe do Artigo + Barras de pesquisa por secção
Concluídas e testadas (iteration_28.json — backend 6/6, frontend 7/7, sem bugs):
- **Progresso de produção da Encomenda**: `compute_encomenda` calcula `progresso_producao`, `qtd_em_ofs` e `qtd_total` (qtd lançada em OFs vs total da encomenda, capado por artigo a min(of_qty, enc_qty)). Lista de Encomendas ganhou coluna "Produção" com barra + % (`enc-progresso-{id}`); detalhe da encomenda mostra barra "Produção lançada em OFs" (`enc-detail-progresso`).
- **Página de detalhe do Artigo** (como nos Clientes): nova rota `/artigos/:id` → `ArtigoDetail.jsx`. Clicar no **nome do artigo** na lista (`artigo-nome-link-{id}`) abre o detalhe (imagem, custo/margem/preço, 6 KPIs, secções de Encomendas/Orçamentos/OFs com quantidades + histórico). Novo endpoint `GET /api/artigos/{aid}/resumo` (auth). O antigo botão "olho" de utilizações do artigo foi **removido** (substituído pela página de detalhe); os botões "olho" em Máquinas/Materiais/Mão de Obra/Personalizações mantêm-se.
- **Barras de pesquisa por secção**: novo componente reutilizável `components/SeccaoPesquisavel.jsx` (render-prop com filtro client-side). Aplicado às secções Encomendas/Orçamentos/OFs no `ArtigoDetail` (`artigo-*-search`) e no `ClienteDetail` (`cliente-*-search`).
- Nota (não bloqueante): `artigo_resumo` e `compute_encomenda` fazem varreduras completas / N+1 — OK para o volume atual; otimizar com filtros Mongo/batching se escalar.


## Iteração 37 (2026-07-15) — OFs faseadas + "Onde é usado" (referências inversas) + pesquisa global no mobile
Concluídas e testadas (iteration_27.json — backend 14/14, frontend 100%, sem bugs):
- **OFs faseadas**: no detalhe da Encomenda, "Criar Ordem de Fabrico" abre diálogo (`of-faseada-dialog`) com uma linha por artigo e quantidade pré-preenchida com a **quantidade em falta** (total − já em OFs). Cria OF só com linhas de qtd>0. Por decisão do utilizador, NÃO impede ultrapassar o total (apenas sugere). A tabela de artigos mostra `em OFs X/total` (`enc-artigo-emofs-{i}`). Lógica: `ofQtyByArtigo`, `remaining`, `openCriarOF`, `criarOF`.
- **"Onde é usado" (referências inversas)**: novo serviço `app/services/referencias.py` + rota `app/api/routes/referencias.py` (registada em server.py). Endpoints (auth): `GET /api/maquinas/{id}/utilizacoes`, `/api/mao-obra/{id}/utilizacoes`, `/api/consumiveis/{id}/utilizacoes` → `{artigos}`; `GET /api/tipos-personalizacao/{id}/utilizacoes` e `GET /api/artigos/{id}/utilizacoes` → `{orcamentos, encomendas, ordens_fabrico}`.
- Frontend: componente reutilizável `components/UtilizacoesDialog.jsx` (grupos artigos/orçamentos/encomendas/OFs; orçamentos/encomendas/OFs são clicáveis e navegam para o detalhe). Botão de olho (`Eye`) adicionado a Máquinas (`uso-maquina-{id}`), Materiais (`uso-material-{id}`), Mão de Obra (`uso-maoobra-{id}`), Tipos de Personalização (`uso-tipo-{id}`) e Artigos (`uso-artigo-{id}`).
- **Pesquisa global no mobile**: `Layout.jsx` ganhou botão `mobile-search-toggle` no header mobile que expande `mobile-search-bar` com `GlobalSearch` (prop nova `onNavigate` fecha a barra ao navegar).
- Nota (não bloqueante): serviço de referências faz varredura completa das coleções por chamada — OK para o volume atual; indexar/aggregation se escalar. Warning pré-existente `<option><span>` mantém-se (não é regressão).


## Iteração 36 (2026-07-15) — 6 Features (Kanban, Minhas Tarefas, Pesquisa Global, Notificações, Pagamentos Parciais+Recibos, Histórico de Preços) + 2 bugfixes críticos
Concluída a batch das 6 funcionalidades pedidas (todas testadas em iteration_26.json). Corrigidos os 2 bugs críticos que restavam:
- **BUG 1 (frontend)**: `EncomendaDetail.jsx:42` usava `api.delete` (inexistente) → trocado por `api.del`. Remoção de pagamento parcial via UI voltou a funcionar (sem overlay de erro).
- **BUG 2 (backend)**: `GET /api/encomendas/{eid}/pagamentos/{pid}/recibo` só aceitava header `Authorization` → devolvia 401 ao abrir o link `?auth=<token>` em nova aba. Replicado o padrão de `uploads.py` (`Header(None)` + `Query(None)` + `_valid_token`). Recibo PDF abre corretamente.
- Verificado via curl: recibo `?auth=` → 200 (application/pdf, %PDF), sem auth → 401, add/delete pagamento → valor_pago recalculado. UI sem error overlay (dashboard mostra eventos de auditoria dos pagamentos).
- Features entregues: Kanban de OFs (3 colunas por status), filtro "As minhas tarefas", pesquisa global no topo (`GlobalSearch`), sino de notificações (`NotificationsBell`), pagamentos parciais com geração de recibo PDF (`build_recibo_pdf`, coleção `pagamentos` na Encomenda), histórico de preços por cliente (`/api/clientes/{id}/historico-precos`) + hint na encomenda.


## Iteração 35 (2026-07-15) — Code Quality: correções seguras aplicadas
Aplicadas as correções críticas e de baixo risco do relatório de qualidade:
- **Segredos em testes**: `ADMIN_PASSWORD` hardcoded → `os.environ.get("TEST_ADMIN_PASSWORD", ...)` em test_iteration25_imagens, test_iteration21, test_iteration20, test_historico_audit.
- **Imports não usados removidos**: security.py (`now_iso`), pdf.py (`PDF_SECOES`), admin.py (`perms_colaborador`), catalog.py (`artigo_custo_total`), e `time`/`io` em testes.
- **Keys por índice → IDs estáveis**: OrcamentoDetail (linhas `l.id`, roteiro `op.id`), ArtigoForm (materiais `m.id`, roteiro `op.id`).
- **Type hints**: return types em bootstrap.py (seed_perfis/seed_admin/seed_user_logins) e server.py (startup/shutdown).
- Verificado: backend saudável, PDF/dashboard/rbac OK; frontend compila sem erros de consola.

Deferido (com justificação, não aplicado):
- **localStorage → httpOnly cookies**: decisão de arquitetura do SPA; alteração de auth grande e de alto risco. Mantido.
- **Refactors de complexidade** (dashboard() cc=51, converter_orcamento, componentes >300 linhas): alto risco de regressão vs. baixo valor para o utilizador; adiado.
- **"10 variáveis possivelmente indefinidas"** e **40 hook-deps**: falsos positivos — pyflakes não encontra variáveis indefinidas; AuthContext useMemo já lista todas as deps; os `load` useCallback usam `api`/setState estáveis (idiomático manter `[]`).
- Keys por índice em sub-listas estáticas de `alteracoes` (nunca reordenadas): mantidas.

- **Moeda** em Definições passou de campo de texto para **menu de seleção** (Euro, Dólar, Libra, Real, Franco suíço, Kwanza, Metical, Escudo CV); mantém valor personalizado existente como opção. Guarda em `moeda_simbolo`.
- **Imagem de fundo do login**: campo `login_bg_base64` (base64) em `EmpresaSettings` + secção "Ecrã de login" em Definições (upload máx. 3MB, preview, remover — `login-bg-input`/`login-bg-remove`).
- Novo endpoint **público** `GET /api/branding` (sem auth) devolve `{nome, login_bg_base64}` para o ecrã de login. `Login.jsx` busca o branding e aplica a imagem como fundo (cover + overlay `bg-black/45`); fallback para fundo escuro `#0A0A0A`.
- Verificado: curl (`/branding` público 200; PUT settings 200) + screenshots (login com imagem aplicada; select de moeda é `<select>`; campo de fundo presente). Fundo de teste limpo no fim.

- Tabela de **Artigos** (`Artigos.jsx`): miniatura só-leitura na 1ª coluna (data-testid `artigo-row-imagem-{id}`), clicável para pré-visualizar.
- **Roteiro de produção da OF** (`OFRoteiroPanel.jsx`): miniatura do artigo no cabeçalho de cada item (data-testid `of-roteiro-imagem-{idx}`), para o chão de fábrica identificar cada peça num relance.
- Ambas usam `ImagemUpload editable={false}`. Verificado por screenshot (14 miniaturas na tabela). Limpos dados de teste antigos (`teste-`).

- **Imagem da linha do artigo** passou a **só-leitura** em Orçamentos, Encomendas e OFs (herda do catálogo do artigo; edita-se apenas no Artigo). `ImagemUpload editable={false}`.
- **Nova área de imagens ao nível do documento** (`components/ImagensGaleria.jsx` — upload múltiplo, miniaturas, remover, preview). Campo `imagens: List[str]` adicionado a OrcamentoInput/OrdemFabricoInput/EncomendaInput (herdado por Orcamento/OrdemFabrico/Encomenda).
- **Propagação**: `converter_orcamento` copia `orc.imagens` → OF.imagens e Encomenda.imagens; `create_of_for_encomenda` copia `enc.imagens` → OF.imagens (com fallback no backend). Frontend envia imagens ao criar OF.
- Frontend: galeria integrada em OrcamentoDetail (guarda via `saveImagens`/`bodyFrom`), EncomendaDetail (via `persist`, `bodyFrom` inclui imagens) e OrdemFabricoDetail (via `saveImagens`/`bodyFrom`). testids: imagens-galeria, galeria-add, galeria-input, galeria-remove, galeria-preview.
- Verificado: curl end-to-end (auto-fill de linha + propagação de imagens de documento orçamento→OF+encomenda e encomenda→OF, todos OK) + screenshot (galeria presente, linha read-only, sem erros da app).
- Nota: warning `<option> em <span>` na consola é artefacto da instrumentação dev do editor (todos os `<select>` com texto dinâmico), não é bug de produção.

- Integração **object storage Emergent** (`app/services/storage.py`, usa `EMERGENT_LLM_KEY`, adicionada à `.env` + `config.py`). Rotas `app/api/routes/uploads.py`: `POST /api/upload/imagem` (multipart, valida imagem+≤5MB, guarda em `velocely/uploads/`, metadados na coleção `files`) e `GET /api/files/{path}` (auth via header OU `?auth=<jwt>`, devolve bytes). Init no arranque do server.
- Campo `imagem` (path) adicionado a: Artigo/ArtigoInput (imagem de catálogo), OrcamentoLinha, EncomendaArtigo, OFItem.
- **Auto-preenchimento**: `fill_linha_custos` e `build_of_itens` copiam a imagem do catálogo do artigo para a linha/item se esta estiver vazia (respeita override manual).
- **Propagação**: `converter_orcamento` passa `imagem` das linhas para itens da OF e artigos da Encomenda; `criarOF` na encomenda envia `imagem` nos itens.
- Frontend: componente reutilizável `components/ImagemUpload.jsx` (thumbnail + preview grande + upload/remover; URL `${API}/files/{path}?auth=${token}`). Integrado em ArtigoForm (imagem de catálogo), OrcamentoDetail (por linha), EncomendaDetail (por linha), OrdemFabricoDetail (por item). testids: artigo-imagem, line-imagem-{i}, enc-artigo-imagem-{i}, of-item-imagem-{i}.
- Testado: iteration_25.json — backend 11/11 pytest, frontend 100%, propagação e auto-fill validados. Sem bugs.
- Nota: backend aceita também GIF/WEBP (mais permissivo que JPG/PNG pedido). Warning de hidratação `<option> em <span>` pré-existente, independente desta feature.

- Novos widgets em `features/dashboard/widgets.jsx`: `Greeting` (saudação + data PT), `QuickActions` (Novo Orçamento/Nova Encomenda criam+navegam; Novo Cliente/OFs navegam — gated por permissão, com try/catch+toast), `AttentionCenter` (cartões clicáveis: por autorizar, pagamentos pendentes, prazos atrasados/próximos, OFs atrasadas/em produção; "Tudo em dia" quando vazio), `RecentActivity` (últimos 8 eventos de `/historico` com utilizador + tempo relativo + links), `QuickAnalysis` (gráfico horizontal financeiro: Faturado/Recebido/Pendente/Custo real/Margem).
- `Dashboard.jsx` reescrito: busca `/dashboard` + `/alertas` em paralelo; **adaptação ao perfil (RBAC)** — KPIs, gráficos e secções só aparecem conforme `can(modulo,'view')`/isAdmin (encomendas/orçamentos/artigos/ordens_fabrico/analise_producao/calendario/historico). Gráficos existentes mantidos por baixo como análise aprofundada.
- Testado: iteration_24.json — frontend 100%, 0 erros de consola; ações rápidas criam+eliminam sem lixo; cartões de atenção e atividade recente navegam corretamente. testids: dash-greeting, dash-quick-actions (qa-*), dash-attention (att-*), dash-recent-activity, dash-attention-clear.
- Nota (fora de âmbito): warning de hidratação pré-existente em OrcamentoPanels (`<span>` dentro de `<option>`) — não corrigido.

- `RBAC_MODULES` passou de 12 → 16 módulos: adicionados `rentabilidade`, `calendario`, `historico`, `definicoes`. Labels adicionados em `GET /api/rbac/modulos`.
- `perms_colaborador()`: novos módulos com `view=True` exceto `historico`/`definicoes` (e `utilizadores`) que ficam a False por defeito. Migração `seed_perfis` (arranque) adiciona os novos módulos aos perfis existentes (Admin=tudo True; Colaborador=defaults; perfis custom=False).
- Frontend: rotas `/calendario` (modulo `calendario`), `/rentabilidade-clientes` (`rentabilidade`), `/historico` (`historico`), `/definicoes` (`definicoes`) passaram de adminOnly/dashboard para **gating por módulo**. Nav (`Layout.jsx`): Histórico e Definições passaram a itens gated por módulo (visíveis a quem tiver a permissão); Utilizadores mantém-se admin-only. A matriz de perfis (dinâmica via `/rbac/modulos`) mostra agora os 16 módulos.
- Verificado: curl (16 módulos com labels; admin cobre novos módulos; Colaborador migrado) + screenshot do diálogo "Novo Perfil".
- ⚠️ CONFIRMADO o bug P0 pendente: perfil de sistema "Colaborador" tem `admin=True` na BD (dá acesso total). A corrigir na próxima tarefa (Segurança RBAC).

- Novo serviço `app/services/audit.py`: `registar(...)` (tolerante a falhas), `diff_campos(antes,depois,campos)` (com labels PT e tolerância float), `historico(...)`. Coleção Mongo `historico`.
- Nova rota `app/api/routes/historico.py`: `GET /api/historico?tipo=&limit=` (global) e `GET /api/historico/{tipo}/{id}` (por entidade) — ambos exigem auth.
- Logging integrado (com utilizador+timestamp) em: clientes, orçamentos (criado/editado/estado_alterado/duplicado/convertido/eliminado), encomendas (criado/pagamento/producao_autorizada/estado_alterado/editado/duplicado/eliminado), ordens de fabrico (criado/estado_alterado/prioridade/concluido/eliminado), catálogo (artigo/consumível/máquina/mão de obra/tipo personalização — criar/editar/eliminar/duplicar). Rotas de catalog/orcamentos/ordens passaram a exigir `get_current_user` nas escritas.
- Frontend: componente reutilizável `components/HistoricoTimeline.jsx` (secção "Histórico de alterações" em ClienteDetail, OrcamentoDetail, EncomendaDetail, OrdemFabricoDetail). Nova página global admin-only `features/historico/Historico.jsx` (rota `/historico`, nav `nav-historico`, ícone History) com pesquisa + filtro por módulo.
- Testado: iteration_23.json — backend 15/15 pytest, frontend 100% (após fix de import em OFDetail). Eventos de teste limpos.
- PENDENTE Fase 3: [2/3] Auditoria RBAC (corrigir perfil sistema "Colaborador" com admin=True na BD + enforce backend em todas as rotas + esconder botões no frontend); [3/3] matriz de permissões ao criar/editar perfis deve mostrar TODOS os módulos em falta (ex.: Definições, Rentabilidade/Análise, Calendário/Histórico).


## Iteração 27 (2026-07-14) — [Fase 2/3] Login por utilizador + campos do utilizador
- Login passou de **email** para **utilizador** (`login`). `LoginInput` aceita `login` (e `email` como fallback → não bloqueia utilizadores reais). `create_access_token` inalterado.
- Migração no arranque: `seed_user_logins()` preenche `login` (derivado do email, único) para utilizadores legado; admin fica com login `admin`. Índice único em `login`.
- User: novos campos `login`, `cargo` (+ email/name/perfil/password). `UserCreate`/`UserUpdate`/`user_public`/`list_users` atualizados. Admin CRUD valida unicidade de login.
- Frontend: Login usa campo "Utilizador"; `AuthContext.login(loginId)` envia `{login}`; Gestão de Utilizadores com colunas Login/Nome/Email/Cargo/Perfil e formulário (Login, Nome, Email, Cargo, nova password, Perfil).
- Testado: login por "admin" + fallback email (200), criar/login/eliminar utilizador teste-, screenshot da tabela. test_credentials.md atualizado (login: admin).
- ⚠️ Detetado: perfil de sistema "Colaborador" está com `admin=True` na BD real (dá acesso total) → corrigir na Fase 3 (auditoria RBAC).
- PENDENTE: Fase 3 — histórico/timeline (orçamentos, encomendas, OFs, clientes, artigos, tipos personalização, mão de obra, máquinas, materiais) + auditoria RBAC (backend enforce + frontend) + separadores em falta.

## Iteração 26 (2026-07-14) — [Fase 1/3] IVA + Condições de pagamento + Moeda
- `EmpresaSettings`: novos campos `moeda_simbolo` (def "€"), `iva_taxa` (def 23), `iva_isento` (bool), `condicoes_pagamento`.
- IVA: `iva_calc()` em costing; `compute_encomenda` aplica IVA (total_com_iva) e o **pagamento/pendente passa a ser vs total c/IVA**. Orçamento detalhe calcula IVA client-side a partir das Definições. PDFs (orçamento+encomenda) mostram IVA/isenção e condições de pagamento (rodapé) + símbolo de moeda dinâmico (`_set_currency`).
- Moeda: `eur()` (lib/api) usa símbolo configurável via `setCurrency`, definido no `Layout` ao carregar `/settings/empresa`.
- Definições: nova secção "Fiscal e financeiro" (moeda, taxa IVA, isento toggle, condições). Testado (curl IVA + PDF + screenshot Definições).
- PENDENTE nesta funcionalidade: Fase 2 (login por utilizador + campos do user), Fase 3 (histórico/timeline em todos os módulos + auditoria RBAC + separadores em falta).

## Iteração 25 (2026-07-14) — Alertas no menu + Duplicar + Alerta de margem + Tabelas dinâmicas
- **Alertas dinâmicos no menu:** `GET /api/alertas` ({pagamentos_pendentes, prazos_atrasados, prazos_proximos, ofs_atrasadas}). `Layout.jsx` mostra badges (poll 60s) — Encomendas (âmbar, pagamentos), Calendário (vermelho atrasados / âmbar próximos), OFs (vermelho atrasadas). testids `nav-badge-nav-*`.
- **Duplicar/clonar:** endpoints `POST /{orcamentos|encomendas|artigos}/{id}/duplicar` (novo número, estado inicial reposto; artigo → "(cópia)"). Botões `duplicate-*-{id}` nas listas; orçamento/encomenda navegam para a cópia, artigo recarrega. Corrigido bug de serialização: `Repository.insert` remove agora o `_id` (ObjectId) do dict.
- **Alerta de margem mínima:** em `OrcamentoDetail`, se `preço unit < custo de produção` da linha → aviso vermelho por linha (`line-abaixo-custo-{i}`) + banner de topo (`orc-alerta-margem`).
- **Tabelas dinâmicas:** novo `components/table.jsx` (`useSort` + `SortTh`); ordenação por coluna (asc/desc, localeCompare pt numeric) em Orçamentos, Encomendas e Artigos.
- Testado via testing_agent (iteration_22.json): 6/6 fluxos 100%, zero regressões, dados de teste limpos.

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
