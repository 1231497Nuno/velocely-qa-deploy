# Padrões de interface do Velocely

Regras para que todos os separadores tenham o mesmo aspeto e funcionem da mesma maneira.
Antes de criar uma página nova, copie o padrão de uma listagem/ficha existente.

## Cores e aparência

- Nunca usar `bg-black`, `bg-gray-900`, etc. para botões principais ou elementos ativos.
  Usar as cores da marca, editáveis em **Definições → Aparência**:
  - `bg-brand text-brand-fg hover:bg-brand-hover` — botão principal, filtro ativo, item de menu ativo
  - `border-brand`, `ring-brand/20` — foco e realces
  - `text-destaque` — ligações e pequenos realces
  - `bg-sidebar`, `text-sidebar-fg`, `bg-appbg` — reservados ao layout
- Os cantos (`rounded-sm`, `rounded-md`…) seguem a opção «Cantos» da aparência via `--radius`.
- A implementação está em `src/lib/tema.js` (variáveis CSS) e `tailwind.config.js` (cores `brand`, `sidebar`…).

## Listagens

Estrutura: `ListPage` → `PageHeader` (título + Excel + botão Novo) → toolbar → tabela + cartões no telemóvel.

- Pesquisa: `SearchBar`, sempre **pelo início** do texto (backend: `text_search` em `core/pagination.py`).
- Filtros: dentro de `MobileFiltersButton`.
  - Estado → botões `FiltroChip` (de `components/Filtros.jsx`) com contagem no ativo.
  - Outros filtros → `FiltroSelect`.
- Ordenação: `useSort` + `SortTh` (`components/table.jsx`) em todas as colunas relevantes.
- Exportação: `ExportExcelButton` com os ids da página (`services/excel_io.py` → `SHEETS`/`GENERIC_EXPORT`).
- Telemóvel: `ScrollableTable className="hidden md:flex md:flex-col"` + `MobileCards`/`MobileCard`.
- Cores das linhas: `style={estiloCor(corLinha("<modulo>", registo))}` na `<tr>` e no `MobileCard`
  (`context/CamposContext.jsx`), configuradas em **Definições → Campos e cores**.
- Campos personalizados marcados «Mostrar na listagem»: `<ExtrasResumo modulo registo />` na primeira célula.

## Fichas (detalhe)

- Edição com botão **«Editar»** (Artigos, Ordens de Compra, Pedidos de Cotação, Fornecedores):
  a ficha abre em consulta; «Editar» abre os campos; «Guardar» / «Cancelar» (ou «Concluir edição» quando grava ao sair do campo).
- Cabeçalho fixo: `StickyDetailHeader`; separadores: `DetailTabs`.
- Campos personalizados: `<CamposPersonalizados modulo value onChange [onCommit] />` e enviar `campos_extra` no PUT.
- Confirmações: `useConfirm()` — nunca `window.confirm`.

## Artigos nos documentos

Um único seletor: `components/ArtigoCombobox.jsx` (pesquisa sem acentos por código ou nome, grupo «Diversos»,
variantes e criação de artigo). Com `modo="adicionar"` + `onChangeMulti` permite escolher **vários artigos de uma vez**,
cada um com a sua quantidade (Orçamentos, Encomendas, Ordens de Fabrico, Compras, Pedidos de Cotação). Nas compras e pedidos de cotação as linhas têm de ser artigos do catálogo
(`_exigir_artigos_nas_linhas` no backend). Cada linha pode ter uma cor (`CorLinhaPicker`).

## Campos obrigatórios e personalizados (backend)

- Catálogo de campos por módulo: `domain/campos.py` (`MODULOS_CAMPOS`).
- Validação: `services/campos.py → aplicar(modulo, doc, momento, existente)` chamado nas rotas de criar/guardar/finalizar.
- Um módulo novo precisa de: entrada em `MODULOS_CAMPOS`, `campos_extra: dict` no modelo `…Input`
  e a chamada a `campos_svc.aplicar` nas rotas.
- **Campos dependentes**: `CampoExtra.depende_de = {campo, valores}` mostra o campo só quando o campo "pai" tem um dos valores
  (lista: opções do pai, vazio = qualquer; sim/não: `["sim"]`/`["nao"]`; outros: preenchido). Numa lista que depende de outra lista,
  cada opção pode ter `pais` (as opções do pai em que aparece). Sem ciclos. No backend, campos escondidos são limpos e só são
  obrigatórios quando visíveis; uma opção que não pertence ao pai dá erro. No frontend, `lib/camposDependentes.js` (mesma lógica)
  esconde os campos, filtra as opções e limpa em cascata quando o pai muda.

## Botões

Todos os botões usam as classes de componente definidas em `frontend/src/index.css`:

| Classe | Uso |
|---|---|
| `btn btn-primario` | Ação principal (Guardar, Criar, Confirmar) — cor da marca |
| `btn btn-secundario` | Ações secundárias (Cancelar, Exportar, Editar) |
| `btn btn-perigo` / `btn-perigo-contorno` | Apagar / anular |
| `btn btn-sucesso` | Aprovar, concluir, marcar como pago |
| `btn btn-aviso` | Ações que requerem atenção |
| `btn-sm` | Variante compacta (dentro de tabelas, linhas) |

Classes de layout (`w-full`, `ml-auto`, etc.) podem ser acrescentadas, mas não se redefinem cores nem padding.

### Botões de adicionar

Para adicionar linhas, artigos, materiais, operações, personalizações, medidas ou contactos usa-se sempre `components/BotaoAdicionar.jsx`:

- `<BotaoAdicionar onClick={...}>Adicionar linha</BotaoAdicionar>` — contorno tracejado na cor da marca e círculo "+" preenchido; `tamanho="sm"` dentro de linhas; `largo` ocupa a largura toda.
- `<SelectAdicionar label="Adicionar material" onChange={...}>…options…</SelectAdicionar>` — o mesmo aspeto quando a ação é escolher de uma lista.
- O `ArtigoCombobox` em `modo="adicionar"` já usa este aspeto e permite escolher vários artigos de uma vez.

## Edição nas fichas

As fichas abrem em modo de leitura. Para alterar dados carrega-se em **Editar** (`components/BotoesEdicao.jsx` + `hooks/useModoEdicao.js`):

- Fichas com gravação explícita (Orçamento, Encomenda, OF, Conta, NC): **Editar** → **Cancelar** / **Guardar**.
- Fichas que gravam ao sair de cada campo (Cliente, Fornecedor): **Editar** → **Concluir edição**.
- Documentos acabados de criar (`nav(url, { state: { edit: true } })`) e orçamentos em rascunho abrem já em edição.
- Ações de fluxo (mudar estado, registar pagamentos, marcar entregue, iniciar/parar operações, emitir documentos) não dependem do modo de edição.

Estados finais bloqueiam a edição (aparece "Bloqueado" com o motivo):

| Documento | Bloqueado quando | Como desbloquear |
|---|---|---|
| Orçamento | Criado, enviado, ganho ou perdido | Criar nova versão |
| Encomenda | Concluída, entregue ou cancelada | Desmarcar "Material entregue" |
| Ordem de fabrico | Finalizada (todas as operações concluídas) | Desmarcar uma operação (pede confirmação) |
| Conta | Anulada | — |
| Não conformidade | Fechada | Botão **Reabrir** |

O backend recusa (409) edições a OF finalizadas e NC fechadas; os orçamentos já tinham a grelha bloqueada fora de rascunho/negociação.

## Fornecedores e responsáveis

- Fornecedor escolhe-se sempre da lista com `components/FornecedorSelect.jsx` (pesquisa por nome, código ou NIF; mostra telefone/email e o atalho para a ficha). Texto livre só aparece como aviso em registos importados sem ligação.
- Responsável escolhe-se da lista de utilizadores (`/utilizadores-lista`) com `Combobox`.

## Importação / exportação Excel

- Os modelos (Definições → Dados) incluem uma linha EXEMPLO (ignorada) e listas de escolha.
- Campos personalizados entram como colunas `campo_<chave>` (cabeçalho azul); célula vazia não altera o valor.
- Clientes trazem a folha `Cliente_contactos` (ligada por `cliente_codigo`); encomendas trazem `Encomenda_linhas` com a coluna `cor`.
- Leads do CRM: folha `Leads_CRM`, estado pelo nome da coluna do funil; duplicados pelo email/telefone.

## Pagamentos e faturas

- **Pagamentos** (`/pagamentos`): lista igual às encomendas (colunas ordenáveis, filtros, totais) e vista **Por cliente**
  (`?vista=clientes`: total, recebido, em falta e por faturar, com as encomendas de cada cliente).
- Cada pagamento tem **ficha própria** (`/pagamentos/:encomenda/:pagamento`): dados editáveis com «Editar», encomenda
  (total, pago, em falta), documento fiscal, outros pagamentos e emissão da fatura. Na encomenda, cada recibo abre esta ficha.
- Um pagamento edita-se (data, valor, método, nota) enquanto não tiver documento fiscal assinado. Pagamentos criados por recibos fiscais ou já faturados ficam bloqueados — para corrigir anula-se o documento.
- A partir de um pagamento emite-se **fatura-recibo** ou **fatura (+ recibo)**: em rascunho (editável: data, notas, linhas) ou já assinada.
- **Assinar** atribui o número definitivo e um hash encadeado (assinatura interna, não certificada pela AT). Documento assinado não se edita — só se anula; ao anular/eliminar, o pagamento volta a ficar por faturar.
- **Faturação certificada** (Definições → Integrações → Faturação): FIZ, TOConline ou Moloni (`services/faturacao/`, um adaptador por programa).
  Com a ligação ativa, faturas e faturas-recibo nascem em rascunho e «Assinar»/«Emitir no …» envia-as ao programa; o número, ATCUD,
  hash e PDF oficiais ficam em `documento.faturacao` e o PDF passa a ser o do programa. Se o programa falhar, o documento fica em
  rascunho com o erro e pode voltar a ser emitido sem duplicar (o id externo fica guardado). Recibo de fatura: FIZ e Moloni pela API;
  no TOConline emite-se lá. Anular: FIZ pela API; TOConline/Moloni pedem confirmação de que já foi anulado no programa.
  Documentos certificados não se eliminam. Proformas continuam internas. Isenção de IVA: motivo configurável (M10 = art. 53.º).

## Acerto de tempos das OF

- `/ordens-fabrico/acerto-tempos?of=<id>` (botão «Acertar tempos» na OF): corrigir o tempo real de mão de obra e de máquina de cada operação, também em OFs finalizadas.
- Tempo de máquina vazio = usa o estimado. Exige motivo; cada acerto fica guardado na OF (`acertos_tempos`) e no histórico, com o custo real antes/depois.

## Integração com o site (Definições → Integrações)

- **Loja online (WooCommerce)**: webhook `POST /api/integracoes/woocommerce/webhook` (assinatura HMAC do WooCommerce) + importação manual pela API REST (chaves só de leitura). Cada pedido vira uma encomenda (referência `#nº da loja`, `origem_externa`), sem duplicar; o cliente é encontrado por NIF/email ou criado; os artigos ligam-se pelo SKU (código, código de produto ou de fabricante); personalizações da loja ficam em `observacoes` da linha e passam para a OF. Pedido pago → pagamento registado uma vez; cancelado na loja → encomenda cancelada (se ainda não tiver OF); concluído → marcado como entregue.
- **Formulários do site**: `POST /api/integracoes/site/pedido?token=…` (JSON ou formulário; Elementor/CF7) → lead no CRM com origem «Site»; o mesmo contacto com lead em aberto acrescenta uma mensagem em vez de duplicar.

## Encomendas em quadro (kanban)

- Botão Lista / Quadro nas Encomendas (fica guardado no browser). Colunas: Aberta, Em produção, Concluída, Entregue.
- Aberta → Em produção → Concluída seguem as ordens de fabrico (não se arrastam). Arrastar para/da coluna Entregue marca/desmarca
  a entrega (`POST /encomendas/{id}/entrega`). Entregues: só as dos últimos N dias (`GET /encomendas?quadro=true&entregues_dias=`).

## Relatórios (`/relatorios`)

- Catálogo e cálculo em `services/relatorios.py` (`RELATORIOS`): cada relatório devolve colunas tipadas, linhas (com `_link`
  para abrir o registo), totais, gráfico e notas. Parâmetros comuns: período, agrupamento (dia/semana/mês/trimestre/ano),
  comparação (período anterior / ano anterior), cliente e top N.
- Exportação: `GET /relatorios/gerar/{id}?formato=xlsx|pdf`. Módulo de permissões: `relatorios`.
- Para acrescentar um relatório: escrever a função `async def x(d: Dados, p: Params)` e registá-la em `RELATORIOS`.

## Aprovações, alertas e tarefas (Definições → Aprovações e alertas)

- `services/workflow.py`. Regras de aprovação: desconto/margem/total do orçamento (ao criar e ao enviar) e total da
  ordem de compra (ao dar como recebida). `exigir_aprovacao` responde 409 `{codigo: aprovacao_pedida|aprovacao_pendente}`
  e cria o pedido na coleção `tarefas`; a aprovação vale enquanto os valores não piorarem.
- Alertas: `workflow.evento(nome, …)` (encomenda nova/paga, pagamento, orçamento aceite, prazo a chegar, NC, pedido do site,
  bloqueio, decisão de aprovação). Destinatários configuráveis (vazio = administradores) e email opcional.
- Página `/tarefas` e ícone no topo (`/tarefas/contagem`). Erros `{codigo, mensagem}` chegam aos ecrãs como texto
  (`detail`) e o objeto fica em `response.data.detalhe` (interceptor do cliente HTTP).
- Bloqueio manual da encomenda (`POST /encomendas/{id}/bloquear|desbloquear`): impede criar/iniciar OF, faturar e
  marcar entrega. Desbloqueia quem bloqueou ou um administrador. Limite de crédito: bloquear ou só avisar.

## Perfis, restrições e listas

- Perfis (Gestão de Utilizadores → Perfis): além das permissões por módulo, `ver_custos` (esconde custos, margens e
  lucros — classe CSS `dado-custo` + relatórios de custos bloqueados no backend), `so_proprios` (CRM, orçamentos e
  encomendas: só os registos que criou/é responsável — `filtro_proprios` / `assert_proprio`) e `pagina_inicial`.
  Modelos prontos: Comercial, Produção, Financeiro, Compras, Atendimento/loja (`POST /perfis/modelos/{id}`).
- Orçamentos e encomendas guardam `created_by` (a encomenda herda o dono do orçamento).
- Listas (Definições → Listas, `services/listas.py`): condições de pagamento, origens dos leads, motivos de perda,
  motivos de bloqueio, tipos de compra e transportadoras. Frontend: `useListas()` / `opcoesLista()` em `lib/listas.js`.
- Numeração anual: em Definições → Referências, «incluir ano» recomeça a contagem em cada ano (ORC-2027-0001).

## Vendas: tabelas de preços, guias e notas de crédito

- Tabelas de preços (`/tabelas-precos`, `services/precos.py`): regras por artigo/categoria/todos, preço fixo ou desconto,
  escalões de quantidade, validade, clientes e prioridade. `POST /tabelas-precos/aplicar` devolve a regra para cada linha;
  aplicada ao adicionar artigos na encomenda e pelos botões «Tabelas de preços» (encomenda e orçamento).
- Revisões de orçamento: já existiam (Negociar → V2, V3… com a versão anterior arquivada).
- Guias (`services/guias.py`): entregas parciais por linha, locais de carga/descarga, PDF. Com o Moloni ligado, emite
  guia de transporte/remessa lá (série «Guias»); sem programa ligado é interna (sem código AT). Marca a encomenda como
  entregue quando tudo está enviado.
- Notas de crédito (`criar_nota_credito`): por linhas ou valor, motivo obrigatório, devolução opcional do dinheiro
  (pagamento tipo devolução na encomenda). Reduzem o pendente da fatura e devolvem quantidade faturável. Programa
  certificado: FIZ e Moloni pela API; TOConline emite-se lá.

## Compras e stock (`/stock`, `services/stock.py`)

- Gestão de stock é por artigo (`artigo.gere_stock`, «Gere stock» na ficha, no Excel e em Stock → ⚙). Só esses artigos
  têm movimentos, aparecem no Stock, no inventário e nas sugestões; nos outros (compra à medida, serviços) receções,
  consumos da OF e não conformidades não mexem na quantidade. Arranque: artigos antigos sem o campo ficam a gerir stock
  se tinham quantidade ou nível de reabastecimento (`migrar_gere_stock`, só uma vez).
- Toda a alteração de stock passa por `stock.movimentar()` (coleção `movimentos_stock`: entrada, ajuste, inventário,
  não conformidade). Entradas com custo atualizam `artigo.custo_medio` (média ponderada). Mudar `qtd_stock` na ficha do
  artigo gera um movimento «ajuste».
- Unidade de compra: `artigo.unidade_compra` + `fator_compra` (1 rolo = 50 m). As OC são em unidade de compra; o stock
  entra convertido. Configura-se em Stock → ⚙ (`PUT /stock/artigos/{id}/config`).
- OC → separador «Receção e fatura»: receções parciais (`POST /ordens-compra/{id}/rececoes`, `linha.qtd_recebida`; passa
  a «Recebida» quando tudo chegou, com a mesma aprovação de valor) e fatura do fornecedor
  (`POST …/fatura-fornecedor`): compara com o valor recebido (tolerância 0,50 €) e reparte os portes pelo custo médio.
- Sugestões de compra (`GET /stock/sugestoes`): projetado = stock + em OC abertas − reservado nas encomendas abertas;
  abaixo do nível → sugere (arredondado à unidade de compra). «Criar ordens de compra» faz uma OC por fornecedor.
- Inventários (`/inventarios`): fotografia do stock → contagens → fechar (acertos como movimentos, valor ao custo médio).
  `GET /inventarios/{id}/at.csv`: ficheiro de inventário para a AT (separador «;», categorias M/P/A).

## Produção: fecho da OF e carga das máquinas (`services/producao.py`)

- «Fechar OF» (`GET /ordens-fabrico/{id}/fecho` → `POST …/fechar`): por linha, quantidade produzida (boa) e refugo com
  motivo; materiais gastos (proposta = previsto). Custo fechado = operações com tempos reais + materiais gastos (+ custo
  de compra em linhas sem produção); guarda `of.fecho` com custo/unidade e desvio face ao estimado. Abate os materiais
  ao stock (movimento «consumo») e dá entrada do produzido em linhas sem encomenda (produção para stock). Conclui a OF.
  `POST …/fecho/anular` reverte os movimentos.
- Carga das máquinas (`/carga-maquinas`, `GET /producao/carga`): horas de máquina por fazer nas OF abertas, por semana do
  prazo da encomenda, vs `maquina.horas_semana` (Catálogo → Máquinas). Prazo passado → «Atrasado».

## Relatórios guardados e envio automático (`services/relatorios_guardados.py`)

- «Guardar» na área Relatórios grava relatório + período relativo (este mês, mês passado, trimestre…, ou datas fixas),
  agrupamento, comparação, cliente, top N e colunas (`/relatorios/guardados`). O período recalcula-se em cada abertura/envio.
  Partilhado = os colegas abrem mas não alteram; o dono ou um administrador edita/apaga.
- Colunas: botão «Colunas» escolhe o que se vê e exporta (`colunas=` em `/relatorios/gerar/{id}`; a 1.ª coluna fica sempre).
- Envio automático: diário/semanal/mensal, hora (Lisboa), PDF ou Excel, vários emails. O servidor verifica a cada 5 min
  (`ciclo()` arrancado no startup; `DESATIVAR_AGENDADOR=1` desliga) e reclama cada envio com `proximo_envio` para não
  duplicar. Precisa do SMTP configurado; o resultado fica em `ultimo_envio` (visível no relatório). «Enviar agora» testa.

## Dados de simulação (Definições → Dados, só administradores)

- `POST /simulacao` cria um conjunto completo marcado `simulacao: true` e «[SIM]» no nome (catálogo com/sem stock,
  máquinas, clientes, leads, orçamentos, encomendas com pagamentos ao longo de 6 meses, OF fechadas/em curso, compras com
  receções e fatura, NC, relatório guardado) usando os serviços reais (custos, fecho da OF, stock). `DELETE /simulacao`
  apaga tudo isso, os movimentos de stock desses artigos e o histórico. Não emite documentos fiscais nem envia emails.

## Link do cliente e pagamentos online (`services/portal.py`, `services/pagamentos_online.py`)

- «Link do cliente» (orçamento e encomenda): `POST /portal/links` cria um token (120 dias) → página pública `/p/{token}`
  (sem login). Orçamento: ver linhas, PDF, aprovar maquetas / pedir alteração, aceitar ou recusar (fica em
  `resposta_cliente` e no histórico; alertas `orcamento_aceite` / `portal_cliente`). Encomenda: estado, prazo, pago/por
  pagar e pagamento online. Enviar por WhatsApp (wa.me), email ou copiar.
- Pagamentos online (Definições → Integrações): ifthenpay ou Eupago, Multibanco e MB WAY. Callback público
  `/api/publico/pagamentos/{ifthenpay|eupago}` (ifthenpay com chave anti-phishing) → pagamento entra na encomenda
  (método multibanco/mbway, recibo, `apos_pagamento`). Precisa de `BACKEND_PUBLIC_URL` para o URL do callback.
- Lembretes de orçamentos (alerta «orcamento_follow_up», dias configuráveis): enviados sem resposta há X dias ou a
  expirar em X dias. Verificado no ciclo de 5 minutos, com prazos.

## Calculadora, custos de fornecedor e loja online

- Calculadora de preços (`/calculadora`, botão no orçamento que aplica a uma linha): técnicas em
  `services/tecnicas_preco.py` (DTF ao metro linear com encaixe na largura útil, área, tempo de máquina, fornecedor
  custo+IVA+margem); cálculo em `lib/calculadoraPreco.js`. Administradores editam os parâmetros na página.
- Custos de fornecedor (`/precos-fornecedor`): Excel/CSV → escolher colunas (deteta «Ref» e «-500») → compara com
  `artigo.cod_fornecedor` do fornecedor → aplica `custo_artigo` (e `preco_compra`). O preço de venda segue a margem.
- WooCommerce do ERP para a loja: `enviar_stock`, `enviar_preco` (produto pelo SKU = código do artigo; guarda
  `woo_id`), `concluir_no_site` (encomenda entregue → pedido «completed»). Artigos alterados ficam `woo_pendente` e são
  enviados no ciclo de 5 minutos; «Enviar tudo agora» em Integrações. Chaves com permissão de escrita.

## Oficina, planeamento e manutenção

- Oficina (`/oficina`, tablet): ler o QR da OF (câmara, `BarcodeDetector`) ou escrever o número → botões grandes Iniciar /
  Parar / Concluir (mesmos endpoints da OF). O PDF da OF traz o QR (`pdf.texto_qr_of`: `FRONTEND_URL/oficina?of=id` ou
  `VELOCELY-OF:id`); `GET /oficina/of/{ref}` aceita id, número ou o código.
- Planeamento (`/planeamento`): grelha máquina × dia com as operações por fazer das OF abertas; arrastar grava
  `op.planeado_data` (`POST /ordens-fabrico/{id}/operacao/planear`). Barra de ocupação = horas ÷ (horas_semana / 5).
- Manutenção (`/manutencao`, `services/manutencao.py`): planos por horas de trabalho (tempo de máquina das OF) ou por dias;
  «Feita» regista data/custo/notas e reinicia a contagem; alerta «manutencao» no ciclo de 5 minutos.

## Tesouraria e conta corrente (`services/tesouraria.py`)

- Conta corrente (separador no cliente e no fornecedor; `GET /conta-corrente/{cliente|fornecedor}/{id}`): cliente =
  encomendas (débito) e pagamentos (crédito); fornecedor = OC/fatura do fornecedor, pagamentos e contas a pagar. Extrato
  PDF (`formato=pdf`) e envio ao cliente por email.
- Tesouraria (`/tesouraria`): previsão semanal (saldo do banco indicado + pendentes das encomendas na data de entrega/
  prazo + condições de pagamento do cliente + contas; saídas = OC por pagar no vencimento + contas a pagar).
  Extrato bancário: importar CSV/Excel do banco (deteta data, descrição, montante ou débito/crédito; sem duplicados por
  hash) → sugestões por valor/número/nome → conciliar regista o pagamento (encomenda) ou `valor_pago` (OC).
  Contabilista: Excel com documentos de venda, recebimentos, compras e contas do período.
- Lembrete de cobrança (alerta «cobranca»): entregue há mais de N dias (Tesouraria → configuração) e ainda por pagar.

## Reservas, centros de custo e objetivos

- Stock: `stock.reservas()` = encomendas abertas por entregar (artigos com stock não produzidos) + materiais das OF por
  fechar; o ecrã Stock mostra Reservado e Disponível; as sugestões de compra usam as mesmas reservas.
  `artigo.localizacao` (Stock → ⚙).
- Centros de custo: lista «centros_custo» (Definições → Listas); `categoria.centro_custo` (Objetivos → Centros de
  custo; `PUT /categorias/{id}/centro-custo`) e `ordem_compra.centro_custo`. Relatório «Resultado por centro de custo».
- Objetivos (`/objetivos`, `services/objetivos.py`): vendas e despesas previstas por mês vs real (encomendas sem IVA e
  ordens de compra), acumulado e % atingida; «Partir do ano anterior» com crescimento.

## Utilidades: pesquisa, atalhos, painel, cópias e RGPD

- Pesquisa global (barra do topo, Ctrl+K): `GET /search` agora respeita as permissões do perfil e inclui fornecedores,
  ordens de compra e leads (com «só os próprios» no CRM).
- Atalhos (estrela no topo): guardam a página atual com os filtros do endereço (`users.preferencias.atalhos`,
  `GET/PUT /me/preferencias`).
- Painel: «Personalizar» esconde/mostra blocos por utilizador (`preferencias.painel_ocultos`); bloco «Objetivo do mês».
- Cópias de segurança (Definições → Dados, admin): uma por dia no armazenamento de ficheiros (últimas 14, ciclo de 5 min),
  descarregar (JSON gz de todas as coleções) e restaurar (escrever RESTAURAR; faz cópia antes).
- RGPD (separador no cliente): consentimento de marketing com histórico (`cliente.rgpd`), exportar dados (JSON) e
  anonimizar (admin; mantém encomendas e documentos fiscais, sem dados pessoais nas encomendas/orçamentos/leads).

## Seleções com pesquisa

- Listas vindas da base de dados usam sempre pesquisa: `components/EntitySelect.jsx` (Combobox; pesquisa em qualquer
  parte do nome e do código; `clearLabel` para opção vazia; `size="sm"` em linhas/tabelas). Máquinas, mão de obra,
  categorias, subcategorias, fornecedores, materiais.
- `SelectAdicionar` (botões «Adicionar material/personalização…») passou a abrir uma lista com pesquisa (mesma API com
  `<option>`). `InlineSelect` com mais de 6 opções também.
- Fornecedor do artigo escolhido da base de dados (`fornecedor_id`, `FornecedorSelect`, `lib/useFornecedores`).
- Responsável (clientes, fornecedores, artigos): `components/UtilizadorSelect.jsx` (lista de utilizadores; guarda o nome).

## Localizações de stock

- `localizacoes` (Stock → Localizações): nome, código, descrição, por defeito (★), inativa. `stock.local_padrao()` cria
  «Armazém» na primeira utilização.
- Stock por localização em `artigo.stock_local {loc_id: qtd}`; `qtd_stock` continua a ser o total. `stock_por_local()`
  põe diferenças antigas na localização do artigo (`artigo.localizacao_id`, por defeito a da empresa).
- `movimentar(..., localizacao_id)`; movimentos guardam `localizacao_id` e `saldo_local`. Transferência:
  `POST /stock/transferir` (dois movimentos «transferencia»). Acerto por localização (`/stock/ajuste` com
  `localizacao_id`). Receção da OC: «Arrumar em». Inventário: uma linha por artigo × localização (`chave`); o CSV da AT soma.
- Ficha do artigo (bloco Stock): «Stock por localização» com reservado/disponível, transferir, acertar, localização das
  entradas e últimos movimentos (`GET /stock/artigos/{id}`).

## App móvel de armazém (`/m`)

- PWA dentro do mesmo frontend (`features/movel/`), sem o menu lateral: rotas `/m`, `/m/rececoes(/:id)`, `/m/inventario`,
  `/m/transferir`, `/m/consultar`, `/m/acertar` com `MovelProtected` (sem sessão → `/login?next=/m…`; o Login aceita
  `next` só com caminhos internos). `public/manifest.webmanifest` (start_url `/m`, ícones `icon-192/512.png`) permite
  «Adicionar ao ecrã principal». Atalho no menu: Operações → «App móvel (armazém)».
- Componentes em `features/movel/comum.jsx`: `MovelHeader`, `BotaoGrande` (≥ 52 px de altura), `Quantidade` (− / +),
  `Scanner` (BarcodeDetector: QR, EAN-13/8, Code 128/39, UPC…; Chrome/Android), `ArtigoPicker` (pesquisa em `/stock?q=`,
  incluindo `codigo_produto`; Enter = leitor de código de barras USB/Bluetooth; código exato escolhe logo o artigo),
  `LocalPicker` (chips; lê o QR/código da localização), `useLocalLembrado` (última localização por ecrã, em localStorage).
- Receções: `GET /movel/ocs-abertas` (OC «criada» com linhas por receber) → quantidades por linha, «Chegou tudo»,
  «Ler volumes» (cada leitura soma 1 à linha do artigo), «Arrumar em», guia → `POST /ordens-compra/{id}/rececoes`
  (excesso pede confirmação e envia `aceitar_excesso`).
- Inventário: `GET /movel/inventario-aberto`; contagem cega (não mostra o stock teórico) por localização →
  `POST /movel/inventario/{id}/contar` (`somar` para contar por partes; artigo num sítio não previsto acrescenta a linha
  com teórico 0 e `adicionada: true`). «Por contar aqui» lista as linhas da localização sem contagem. O fecho continua no
  computador (Stock → Inventários).
- Transferir (`/stock/transferir`), Consultar (`/stock/artigos/{id}`) e Acertar (`/stock/ajuste` com `nova_quantidade`,
  localização e motivo obrigatório).

## Criação de registos (padrão único)

- Clientes, fornecedores e artigos criam-se numa página própria (`/clientes/novo`, `/fornecedores/novo`, `/artigos/novo`)
  com `components/NovoRegisto.jsx` (barra fixa: Voltar · «Novo …» · Cancelar · Guardar) e o formulário em blocos
  (`BlocosShell`): `features/clientes/ClienteForm.jsx`, `features/fornecedores/FornecedorForm.jsx`. Ao guardar abre a ficha.
- O lápis das listas abre a ficha já em edição (`navigate(..., { state: { edit: true } })`); `?novo=1` redireciona para `/x/novo`.
- Sem diálogos de criação/edição para estes registos. A criação rápida dentro de outros documentos (`BotaoAdicionar`) mantém-se.

## PDFs

- `openAuthenticated` (lib) busca o ficheiro com o token e mostra PDFs/imagens no visualizador global
  `components/VisualizadorFicheiro.jsx` (Descarregar, Imprimir, Abrir noutro separador). Não usa `window.open` depois de
  um pedido assíncrono (o browser bloqueava o pop-up e o PDF não abria). Outros tipos são descarregados.
- `services/pdf.py`: cabeçalho com caixa do destinatário + caixa de dados do documento (datas dd/mm/aaaa), totais com a
  linha de total destacada (a última com rótulo em maiúsculas) e nota de isenção de IVA por baixo, rodapé de página com os
  dados da empresa. OF: prazo, encomenda, prioridade, caixa de instruções, observações e materiais por artigo, notas da oficina.

## Oficina (tablet)

- `features/producao/OficinaOF.jsx`: separadores «O que fazer» (artigos com foto, personalizações, observações, arte,
  materiais, operações com indicações e iniciar/parar/concluir), «Documentos» (`GET /oficina/of/{id}/documentos`: artes,
  ficheiros da OF, da encomenda e dos artigos; fotos em ecrã inteiro) e «Notas» (`POST/DELETE /oficina/of/{id}/notas`,
  ligadas à OF, a um artigo ou a uma operação; notas rápidas). «Foto» anexa fotos tiradas no tablet à OF.
  As notas aparecem também na ficha da OF e no PDF.

## Menu lateral

- Grupos pelo fluxo do negócio: Vendas, Compras, Stock, Produção, Financeiro, Análise, Dados base, Sistema; Dashboard e
  Calendário no topo. Grupos abertos/fechados ficam guardados no browser (`velocely_menu_grupos`).

## Modelos de PDF (orçamento em estilo proposta)

- `services/pdf_proposta.py`: estilo «proposta» (predefinido para orçamentos) — cabeçalho com marca, título grande
  (descrição do orçamento), caixas Cliente/Detalhes, introdução, artigos com foto/arte, total destacado, «O que está
  incluído», «Maquete, prazos e entrega», «Condições», notas, agradecimento e caixa de aceitação.
- Modelo de PDF (Definições → Modelos PDF): `estilo` (proposta | classico), `cor`, `textos` (introducao, incluido,
  prazos, condicoes, agradecimento; variáveis {cliente} {numero} {data} {validade} {total} {descricao} {empresa}),
  `imagens`, `aceitacao`, `padrao` (um por módulo; usado quando não se escolhe modelo). «Pré-visualizar» gera o PDF com o
  último orçamento (`POST /pdf-templates/pre-visualizar`). `load_pdf_config(template_id, modulo)` põe a aparência em
  `fields["_modelo"]`.

## Menu e painel personalizáveis

- Menu lateral: «Personalizar menu» (rodapé da barra) abre `components/MenuEditor.jsx` — renomear/ordenar/criar grupos,
  ordenar e mover opções (arrastar ou setas), ocultar. Guardado por utilizador em `/me/preferencias` → `menu`
  (`{grupos:[{id,label,itens:[tid]}], ocultos:[tid]}`); `aplicarMenu()` junta opções novas ao grupo predefinido.
- Painel: «Personalizar» mostra/oculta e ordena os blocos (`painel_ocultos`, `painel_ordem`); «Repor predefinido».

## Ordem de compra a partir do PDF do fornecedor

- `services/oc_pdf.py`: `POST /ordens-compra/importar-pdf` lê o PDF (pypdf; com `ANTHROPIC_API_KEY` usa o Claude para a
  extração, `ANTHROPIC_MODEL` opcional), deteta o fornecedor (NIF/nome), as linhas (ref., descrição, qtd, preço, desconto
  — regra qtd × preço ≈ total) e associa artigos: associação aprendida (`referencias_fornecedor`), `cod_fornecedor`,
  código, nome (≥ 75% das palavras). Avisos: preço ≠ custo registado (> 5%), artigo de outro fornecedor, sem quantidade.
- Revisão em `features/ordens_compra/ImportarPdfOC.jsx`; `POST /ordens-compra/importar-pdf/criar` cria a OC (tipo compra)
  e aprende as associações confirmadas.

## App móvel — mais operações

- Início: pesquisa/leitura de artigo no topo, contadores (`GET /movel/resumo`: OC/fornecedores por receber, stock baixo,
  inventário aberto) e atalhos: Receções, Inventário, Localizações, Transferir, Entrada/saída, Acertar, Stock baixo,
  Movimentos, Consultar, Oficina.
- Receções por fornecedor: lista de fornecedores com o que têm por receber (pesquisa por fornecedor, OC ou artigo) →
  `/m/rececoes/f/:fid` com as linhas de todas as OC desse fornecedor; «Ler volumes» procura o artigo em todas; confirma
  uma receção por OC.
- Localizações: `LocalPicker` com chips (até 6), ou pesquisa + recentes; «Ler etiqueta» (QR com o código) e «Nova»
  (código único). `/m/localizacoes/:id` mostra o que está no sítio com Mover / Saída / Acertar e «Contar esta localização».
  Etiquetas A4 com QR: `GET /stock/localizacoes/etiquetas.pdf` (Stock → Localizações → «Etiquetas QR»).
- Entrada/saída avulsa: `POST /movel/movimento` (tipo entrada|saida, motivo obrigatório; a saída não deixa negativo).

- OC por PDF — artigos em falta: cada linha sem artigo mostra sugestões («É «…»?», por nome parecido) e «Criar artigo»;
  «Criar N artigos novos» cria-os de uma vez (categoria/subcategoria, tipo, unidade, margem, gere stock comuns; nome
  editável) com `cod_fornecedor` = ref. do PDF, fornecedor e custo = preço líquido do PDF, e associa-os às linhas.
- Pesquisa de artigos (`ArtigoCombobox`, `LinhaArtigoFields`, revisão do PDF) encontra também pela referência do
  fornecedor (`cod_fornecedor`) e pelo código de barras (`codigo_produto`, incluído em `artigo_lite`).

## Receção de várias OC (mesmo fornecedor)

- `POST /ordens-compra/rececoes-lote` (`stock.receber_lote`): `{ocs:[{oc_id, linhas:[{linha_id, quantidade}]}], data,
  guia_fornecedor, notas, localizacao_id, aceitar_excesso}`. Recusa OC de fornecedores diferentes, valida todas as
  quantidades antes de mexer no stock e regista uma receção por OC com a mesma guia.
- Computador: Ordens de Compra → «Receção» (escolher fornecedor, marcar as OC, quantidades) e, na OC, «Com outras do
  fornecedor» (`RececaoVariasOC.jsx`). A app móvel usa o mesmo endpoint.
