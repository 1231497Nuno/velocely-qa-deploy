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
 *     <ScrollableTable className="hidden md:flex md:flex-col">
 *       <table>...</table>
 *     </ScrollableTable>
 *     <MobileCards testid="...-cards">...</MobileCards>
 *   </ListPage>
 */
export function ListPage({ header, toolbar, footer, children, className = "" }) {
  return (
    <div
      data-testid="list-page"
      className={`flex flex-col min-h-0 app-list-height ${className}`}
    >
      {header && <div className="shrink-0">{header}</div>}
      {toolbar && <div className="shrink-0 space-y-1.5 mb-1.5 sm:space-y-2 sm:mb-2">{toolbar}</div>}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      {footer && (
        <div className="shrink-0 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
          {footer}
        </div>
      )}
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

/** Lista em cartões para ecrãs < md (complementa ScrollableTable hidden md:…). */
export function MobileCards({ children, className = "", testid }) {
  return (
    <div
      data-testid={testid}
      className={`md:hidden flex-1 min-h-0 overflow-auto mobile-cards-stack flex flex-col -mx-0.5 px-0.5 ${className}`}
    >
      {children}
    </div>
  );
}

export function MobileCard({ children, onClick, testid, className = "" }) {
  return (
    <div
      data-testid={testid}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      className={`bg-white border border-gray-200 rounded-sm mobile-card ${onClick ? "cursor-pointer active:bg-gray-50" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Classes para <thead> sticky dentro de ScrollableTable. */
export const TABLE_HEAD_STICKY =
  "sticky top-0 z-10 bg-gray-50 [&_th]:bg-gray-50 border-b border-gray-200 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]";
