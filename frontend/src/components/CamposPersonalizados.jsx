import { useCampos } from "@/context/CamposContext";
import { camposVisiveis, limparDependentes, opcoesDisponiveis } from "@/lib/camposDependentes";

const inputCls =
  "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50 disabled:text-gray-500";

/**
 * Campos personalizados de um módulo (Definições → Campos).
 * value: objeto campos_extra do registo; onChange(novoObjeto).
 * Não mostra nada se o módulo não tiver campos personalizados.
 */
export default function CamposPersonalizados({ modulo, value, onChange, onCommit, disabled = false, titulo = "Outros dados", className = "" }) {
  const { extras } = useCampos();
  const campos = extras(modulo);
  if (!campos.length) return null;
  const v = value || {};
  // Campos dependentes: ao mudar um campo, limpa os que deixam de fazer sentido (em cascata)
  const set = (key, val) => onChange(limparDependentes(campos, { ...v, [key]: val }));
  // Fichas com gravação automática: grava ao sair do campo (texto) ou logo (listas, datas, sim/não)
  const setCommit = (key, val) => {
    const novo = limparDependentes(campos, { ...v, [key]: val });
    onChange(novo);
    onCommit?.(novo);
  };
  const blur = () => onCommit?.(v);
  const visiveis = camposVisiveis(campos, v);
  const mostrar = campos.filter((c) => visiveis[c.key] !== false);
  if (!mostrar.length) return null;

  return (
    <section className={`bg-white border border-gray-200 rounded-sm p-4 ${className}`} data-testid={`campos-extra-${modulo}`}>
      {titulo && <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-3">{titulo}</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {mostrar.map((c) => {
          const id = `cx-${modulo}-${c.key}`;
          const val = v[c.key];
          const label = (
            <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
              {c.label}{c.obrigatorio && c.tipo !== "sim_nao" && <span className="text-red-600"> *</span>}
            </label>
          );
          if (c.tipo === "sim_nao") {
            return (
              <label key={c.key} className="flex items-center gap-2 text-sm text-gray-800 sm:col-span-1 py-2">
                <input id={id} type="checkbox" checked={!!val} disabled={disabled} onChange={(e) => setCommit(c.key, e.target.checked)} />
                {c.label}
                {c.ajuda && <span className="text-xs text-gray-500">— {c.ajuda}</span>}
              </label>
            );
          }
          return (
            <div key={c.key} className={c.tipo === "texto_longo" ? "sm:col-span-2" : ""}>
              {label}
              {c.tipo === "texto_longo" ? (
                <textarea id={id} className={`${inputCls} min-h-[4.5rem]`} value={val ?? ""} disabled={disabled} onChange={(e) => set(c.key, e.target.value)} onBlur={blur} />
              ) : c.tipo === "lista" ? (
                <div className="flex items-center gap-2">
                  {(() => {
                    const cor = c.opcoes?.find((o) => o.valor === val)?.cor;
                    return cor ? <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cor }} /> : null;
                  })()}
                  <select id={id} className={inputCls} value={val ?? ""} disabled={disabled} onChange={(e) => setCommit(c.key, e.target.value || null)}>
                    <option value="">—</option>
                    {opcoesDisponiveis(c, v).map((o) => <option key={o.valor} value={o.valor}>{o.valor}</option>)}
                  </select>
                </div>
              ) : (
                <input
                  id={id}
                  className={inputCls}
                  type={c.tipo === "numero" ? "number" : c.tipo === "data" ? "date" : "text"}
                  step={c.tipo === "numero" ? "any" : undefined}
                  value={val ?? ""}
                  disabled={disabled}
                  onChange={(e) => (c.tipo === "data" ? setCommit(c.key, e.target.value) : set(c.key, e.target.value))}
                  onBlur={c.tipo === "data" ? undefined : blur}
                />
              )}
              {c.ajuda && <p className="text-[11px] text-gray-500 mt-0.5">{c.ajuda}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Valores dos campos marcados "mostrar na lista", para usar numa célula de tabela. */
export function ExtrasResumo({ modulo, registo }) {
  const { extras } = useCampos();
  const campos = extras(modulo).filter((c) => c.mostrar_na_lista);
  if (!campos.length || !registo?.campos_extra) return null;
  const partes = campos
    .map((c) => {
      const val = registo.campos_extra[c.key];
      if (val === null || val === undefined || val === "" || val === false) return null;
      const cor = c.tipo === "lista" ? c.opcoes?.find((o) => o.valor === val)?.cor : null;
      return (
        <span key={c.key} className="inline-flex items-center gap-1 text-[11px] text-gray-600 border border-gray-200 rounded-sm px-1.5 py-0.5 bg-white">
          {cor && <span className="w-2 h-2 rounded-full" style={{ background: cor }} />}
          {c.tipo === "sim_nao" ? c.label : `${c.label}: ${val}`}
        </span>
      );
    })
    .filter(Boolean);
  return partes.length ? <div className="flex flex-wrap gap-1 mt-1">{partes}</div> : null;
}
