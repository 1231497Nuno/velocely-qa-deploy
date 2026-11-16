/**
 * Filtros das listagens — o mesmo aspeto em todos os separadores.
 *
 *   <FiltroGrupo>                       ← agrupa botões de filtro
 *     <FiltroChip active onClick count>  ← um botão (estado, tipo, …)
 *   </FiltroGrupo>
 *   <FiltroSelect value onChange>       ← filtro secundário em lista suspensa
 *
 * Usados dentro do <MobileFiltersButton> (no telemóvel abrem num painel).
 */
export function FiltroChip({ active, onClick, children, count, testid, icon: Icon }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      aria-pressed={!!active}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-9 text-sm font-medium rounded-sm border transition-colors ${
        active
          ? "bg-brand text-brand-fg border-brand"
          : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      {Icon && <Icon size={14} />}
      {children}
      {active && count != null && (
        <span className="text-[11px] tabular-nums rounded-full px-1.5 py-0.5 bg-brand-fg/20">{count}</span>
      )}
    </button>
  );
}

export function FiltroGrupo({ children, mobile = false, className = "" }) {
  return (
    <div className={`${mobile ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-1.5"} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Grupo de botões a partir de uma lista de opções.
 * opcoes: [{ id, label }]; value: id ativo.
 */
export function FiltroOpcoes({ opcoes, value, onChange, count, mobile = false, testidPrefix = "filtro" }) {
  return (
    <FiltroGrupo mobile={mobile}>
      {opcoes.map((o) => (
        <FiltroChip
          key={o.id || "todos"}
          active={value === o.id}
          onClick={() => onChange(o.id)}
          count={count}
          testid={`${testidPrefix}-${o.id || "todos"}`}
        >
          {o.label}
        </FiltroChip>
      ))}
    </FiltroGrupo>
  );
}

export function FiltroSelect({ value, onChange, children, mobile = false, testid, className = "" }) {
  return (
    <select
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${mobile ? "w-full" : ""} text-sm border border-gray-300 rounded-sm px-2.5 py-1.5 min-h-9 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand ${className}`}
    >
      {children}
    </select>
  );
}
