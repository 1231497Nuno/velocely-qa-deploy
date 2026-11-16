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
