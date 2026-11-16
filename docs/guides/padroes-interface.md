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
