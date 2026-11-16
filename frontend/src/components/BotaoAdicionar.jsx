import { forwardRef } from "react";
import { Plus, ChevronDown } from "lucide-react";

/**
 * Ações de «adicionar» dentro das fichas (linhas, artigos, materiais, operações,
 * personalizações, medidas, contactos…) — o mesmo aspeto em todo o ERP:
 * contorno tracejado na cor da marca, círculo «+» cheio e texto explícito.
 *
 *   <BotaoAdicionar onClick={…}>Adicionar operação</BotaoAdicionar>
 *   <SelectAdicionar label="Adicionar material" onChange={(id) => …}>…<option/>…</SelectAdicionar>
 *
 * tamanho: "md" (por defeito, ações principais da secção) | "sm" (dentro de uma linha)
 * largo: ocupa a largura toda (fim de listas/tabelas)
 */
const BASE =
  "group inline-flex items-center justify-center gap-2 rounded-sm border border-dashed border-brand/50 bg-brand-soft/60 text-brand font-semibold " +
  "hover:border-brand hover:bg-brand-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const TAMANHOS = {
  md: { btn: "px-3.5 py-2 text-sm min-h-10", circ: "w-5 h-5", icon: 14 },
  sm: { btn: "px-2.5 py-1 text-xs min-h-8", circ: "w-4 h-4", icon: 11 },
};

export function CirculoMais({ tamanho = "md" }) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  return (
    <span className={`${t.circ} shrink-0 rounded-full bg-brand text-brand-fg flex items-center justify-center`}>
      <Plus size={t.icon} strokeWidth={3} />
    </span>
  );
}

const BotaoAdicionar = forwardRef(function BotaoAdicionar(
  { children, tamanho = "md", largo = false, className = "", testid, type = "button", ...props },
  ref,
) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  return (
    <button
      ref={ref}
      type={type}
      data-testid={testid}
      className={`${BASE} ${t.btn} ${largo ? "w-full" : ""} ${className}`}
      {...props}
    >
      <CirculoMais tamanho={tamanho} />
      <span className="truncate">{children}</span>
    </button>
  );
});

export default BotaoAdicionar;

/** Lista suspensa com o mesmo aspeto do botão (escolher o que adicionar). Volta sempre a «label». */
export function SelectAdicionar({ label, onChange, children, tamanho = "md", largo = false, testid, disabled, className = "" }) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  return (
    <label className={`${BASE} ${t.btn} relative cursor-pointer ${largo ? "w-full" : ""} ${className}`}>
      <CirculoMais tamanho={tamanho} />
      <span className="truncate">{label}</span>
      <ChevronDown size={tamanho === "sm" ? 12 : 14} className="shrink-0 opacity-70" />
      <select
        data-testid={testid}
        value=""
        disabled={disabled}
        aria-label={label}
        onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onChange(v); }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        <option value="">{label}…</option>
        {children}
      </select>
    </label>
  );
}
