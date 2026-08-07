/**
 * Shell de página de lista: header/filtros e paginação ficam fixos;
 * só a tabela (ou o conteúdo central) faz scroll.
 *
 * Uso:
 *   <ListPage
 *     header={<PageHeader ... />}
 *     toolbar={<SearchBar ... />}
 *     footer={<ListPagination ... />}
 *   >
 *     <ScrollableTable>
 *       <table>...</table>
 *     </ScrollableTable>
 *   </ListPage>
 */
export function ListPage({ header, toolbar, footer, children, className = "" }) {
  return (
    <div
      data-testid="list-page"
      className={`flex flex-col min-h-0 h-[calc(100dvh-5.5rem)] sm:h-[calc(100dvh-6.5rem)] lg:h-[calc(100dvh-7.5rem)] ${className}`}
    >
      {header && <div className="shrink-0">{header}</div>}
      {toolbar && <div className="shrink-0 space-y-3 mb-3">{toolbar}</div>}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}

/** Contentor com scroll interno; thead sticky via TABLE_HEAD_STICKY nas <tr>/<thead>. */
export function ScrollableTable({ children, className = "", testid }) {
  return (
    <div
      data-testid={testid}
      className={`flex-1 min-h-0 bg-white border border-gray-200 rounded-sm overflow-auto ${className}`}
    >
      {children}
    </div>
  );
}

/** Classes para <thead> sticky dentro de ScrollableTable. */
export const TABLE_HEAD_STICKY =
  "sticky top-0 z-10 bg-gray-50 [&_th]:bg-gray-50 border-b border-gray-200 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]";
