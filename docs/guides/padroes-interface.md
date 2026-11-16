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

- **Pagamentos** (`/pagamentos`): todos os pagamentos/devoluções das encomendas, com totais (recebido, devolvido, líquido, por faturar) e filtros.
- Um pagamento edita-se (data, valor, método, nota) enquanto não tiver documento fiscal assinado. Pagamentos criados por recibos fiscais ou já faturados ficam bloqueados — para corrigir anula-se o documento.
- A partir de um pagamento emite-se **fatura-recibo** ou **fatura (+ recibo)**: em rascunho (editável: data, notas, linhas) ou já assinada.
- **Assinar** atribui o número definitivo e um hash encadeado (assinatura interna, não certificada pela AT). Documento assinado não se edita — só se anula; ao anular/eliminar, o pagamento volta a ficar por faturar.

## Acerto de tempos das OF

- `/ordens-fabrico/acerto-tempos?of=<id>` (botão «Acertar tempos» na OF): corrigir o tempo real de mão de obra e de máquina de cada operação, também em OFs finalizadas.
- Tempo de máquina vazio = usa o estimado. Exige motivo; cada acerto fica guardado na OF (`acertos_tempos`) e no histórico, com o custo real antes/depois.

## Integração com o site (Definições → Integrações)

- **Loja online (WooCommerce)**: webhook `POST /api/integracoes/woocommerce/webhook` (assinatura HMAC do WooCommerce) + importação manual pela API REST (chaves só de leitura). Cada pedido vira uma encomenda (referência `#nº da loja`, `origem_externa`), sem duplicar; o cliente é encontrado por NIF/email ou criado; os artigos ligam-se pelo SKU (código, código de produto ou de fabricante); personalizações da loja ficam em `observacoes` da linha e passam para a OF. Pedido pago → pagamento registado uma vez; cancelado na loja → encomenda cancelada (se ainda não tiver OF); concluído → marcado como entregue.
- **Formulários do site**: `POST /api/integracoes/site/pedido?token=…` (JSON ou formulário; Elementor/CF7) → lead no CRM com origem «Site»; o mesmo contacto com lead em aberto acrescenta uma mensagem em vez de duplicar.
