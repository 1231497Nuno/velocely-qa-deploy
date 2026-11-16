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

- Sempre editáveis para quem tem permissão — não há botão «Editar».
  Com alterações por guardar aparecem «Descartar alterações» e «Guardar» (ou gravação ao sair do campo).
- Cabeçalho fixo: `StickyDetailHeader`; separadores: `DetailTabs`.
- Campos personalizados: `<CamposPersonalizados modulo value onChange [onCommit] />` e enviar `campos_extra` no PUT.
- Confirmações: `useConfirm()` — nunca `window.confirm`.

## Artigos nos documentos

Um único seletor: `components/ArtigoCombobox.jsx` (pesquisa sem acentos por código ou nome, grupo «Diversos»,
variantes e criação de artigo). Nas compras e pedidos de cotação as linhas têm de ser artigos do catálogo
(`_exigir_artigos_nas_linhas` no backend). Cada linha pode ter uma cor (`CorLinhaPicker`).

## Campos obrigatórios e personalizados (backend)

- Catálogo de campos por módulo: `domain/campos.py` (`MODULOS_CAMPOS`).
- Validação: `services/campos.py → aplicar(modulo, doc, momento, existente)` chamado nas rotas de criar/guardar/finalizar.
- Um módulo novo precisa de: entrada em `MODULOS_CAMPOS`, `campos_extra: dict` no modelo `…Input`
  e a chamada a `campos_svc.aplicar` nas rotas.
