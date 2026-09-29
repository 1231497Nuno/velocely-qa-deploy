import { Plus, X } from "lucide-react";
import { eur } from "@/lib/api";
import {
  emptyMaterialLinha,
  emptyMedida,
  isUnidadeArea,
  labelQuantidade,
  materialLinhaCusto,
  materialQtdEfetiva,
  medidaCusto,
  medidaQtdEfetiva,
  modoAreaMedida,
  normalizeMateriaisReceita,
  patchFromComponente,
  setModoMedida,
} from "@/features/artigos/artigoMateriais";
import { custoUnitarioArtigo } from "@/features/artigos/artigoCustoPlaca";

const fieldCls = "w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";
const fieldReadonlyCls = "w-full border border-gray-200 rounded-sm px-2 py-1.5 text-sm bg-gray-50 text-gray-700 tabular-nums";

/**
 * Receita de materiais: um material por bloco, com várias medidas/consumos.
 * Em m²: cada medida é área OU L×A (nunca os dois editáveis).
 */
export default function ArtigoMateriaisReceita({
  materiais = [],
  componentes = [],
  editing,
  onChange,
  testid = "artigo-materiais",
}) {
  const list = normalizeMateriaisReceita(materiais || []);

  const setList = (next) => onChange?.(normalizeMateriaisReceita(next));

  const upd = (i, patch) => {
    setList(list.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };

  const updMedida = (i, mi, patch) => {
    const m = list[i];
    const medidas = (m.medidas || []).map((med, idx) => (idx === mi ? { ...med, ...patch } : med));
    upd(i, { medidas });
  };

  const addMaterial = () => setList([...list, emptyMaterialLinha()]);

  const delMaterial = (i) => setList(list.filter((_, idx) => idx !== i));

  const addMedida = (i) => {
    const m = list[i];
    upd(i, { medidas: [...(m.medidas || []), emptyMedida(m.unidade)] });
  };

  const delMedida = (i, mi) => {
    const m = list[i];
    const medidas = (m.medidas || []).filter((_, idx) => idx !== mi);
    upd(i, { medidas: medidas.length ? medidas : [emptyMedida(m.unidade)] });
  };

  const selectComponente = (i, componenteId) => {
    if (!componenteId) {
      upd(i, patchFromComponente(null));
      return;
    }
    const c = componentes.find((x) => x.id === componenteId);
    if (!c) return;

    // Já existe este material noutro bloco → junta a medida lá e remove a linha actual
    const otherIdx = list.findIndex((m, idx) => idx !== i && m.material_id === c.id);
    if (otherIdx >= 0) {
      const other = list[otherIdx];
      const merged = list
        .map((m, idx) => {
          if (idx === otherIdx) {
            return {
              ...other,
              ...patchFromComponente(c, other),
              medidas: [...(other.medidas || []), emptyMedida(c.unidade || "un")],
            };
          }
          return m;
        })
        .filter((_, idx) => idx !== i);
      setList(merged);
      return;
    }
    upd(i, patchFromComponente(c, list[i]));
  };

  const idsEmUso = new Set(list.map((m) => m.material_id).filter(Boolean));

  return (
    <div className="overflow-x-auto" data-testid={testid}>
      {editing && (
        <div className="px-4 py-2 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Um material por bloco. Adicione várias medidas (cortes/áreas) no mesmo material — a unidade e o preço vêm do artigo.
          </p>
          <button
            type="button"
            data-testid="artigo-add-material"
            onClick={addMaterial}
            className="text-xs font-medium text-gray-900 inline-flex items-center gap-1 hover:underline shrink-0"
          >
            <Plus size={13} /> Material
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="px-4 py-8 text-center text-gray-400 text-sm">
          {editing ? "Clique em + Material para adicionar componentes." : "Sem materiais definidos."}
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {list.map((m, i) => {
            const area = isUnidadeArea(m.unidade);
            const un = (m.unidade || "un").trim() || "un";
            const total = materialLinhaCusto(m);
            const qtdTotal = materialQtdEfetiva(m);
            const medidas = m.medidas?.length ? m.medidas : [emptyMedida(un)];

            return (
              <div key={m.id || `mat-${i}`} className="p-4 space-y-3" data-testid={`artigo-material-row-${i}`}>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-gray-500 mb-1 block">Matéria-prima / componente</label>
                    {editing ? (
                      <select
                        value={m.material_id || ""}
                        onChange={(e) => selectComponente(i, e.target.value)}
                        className={fieldCls}
                        data-testid={`artigo-material-select-${i}`}
                      >
                        <option value="">Selecionar…</option>
                        {componentes.map((c) => {
                          const u = c.unidade || "un";
                          const custo = custoUnitarioArtigo(c);
                          const usedElsewhere = idsEmUso.has(c.id) && c.id !== m.material_id;
                          return (
                            <option key={c.id} value={c.id}>
                              {c.nome}{c.codigo ? ` (${c.codigo})` : ""} · {u} · {eur(custo)}/{u}
                              {usedElsewhere ? " (já na receita — junta medidas)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <div className="text-sm font-medium text-gray-900">{m.material_nome || "—"}</div>
                    )}
                    {(m.material_id || m.material_nome) && (
                      <div className="text-xs text-gray-500 mt-1">
                        Unidade: <span className="font-medium text-gray-700">{un}</span>
                        {" · "}
                        Custo: <span className="tabular-nums font-medium text-gray-700">{eur(m.custo_unitario)}/{un}</span>
                      </div>
                    )}
                  </div>
                  {editing && (
                    <button type="button" onClick={() => delMaterial(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600 self-end sm:self-start" title="Remover material">
                      <X size={15} />
                    </button>
                  )}
                </div>

                {m.material_id ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Medidas / consumos</span>
                      {editing && (
                        <button
                          type="button"
                          data-testid={`artigo-add-medida-${i}`}
                          onClick={() => addMedida(i)}
                          className="text-xs font-medium text-gray-900 inline-flex items-center gap-1 hover:underline"
                        >
                          <Plus size={12} /> Medida
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {medidas.map((med, mi) => {
                        const modo = area ? modoAreaMedida(med, un) : "area";
                        const temDim = modo === "dimensoes";
                        const qtdEf = medidaQtdEfetiva(med, un);
                        const custoMed = medidaCusto(med, un, m.custo_unitario);

                        return (
                          <div
                            key={med.id || `med-${i}-${mi}`}
                            className="rounded-sm border border-gray-200 bg-gray-50/50 p-3 space-y-2"
                            data-testid={`artigo-material-${i}-medida-${mi}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-500">Medida {mi + 1}</span>
                              {editing && medidas.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => delMedida(i, mi)}
                                  className="p-1 rounded-sm hover:bg-red-100 text-red-600"
                                  title="Remover medida"
                                >
                                  <X size={13} />
                                </button>
                              )}
                            </div>

                            {area && editing && (
                              <div className="inline-flex rounded-sm border border-gray-300 overflow-hidden text-xs" role="group">
                                <button
                                  type="button"
                                  data-testid={`artigo-material-${i}-medida-${mi}-modo-area`}
                                  onClick={() => updMedida(i, mi, setModoMedida(med, "area"))}
                                  className={`px-2.5 py-1 font-medium ${modo === "area" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                                >
                                  Área (m²)
                                </button>
                                <button
                                  type="button"
                                  data-testid={`artigo-material-${i}-medida-${mi}-modo-dim`}
                                  onClick={() => updMedida(i, mi, setModoMedida(med, "dimensoes"))}
                                  className={`px-2.5 py-1 font-medium border-l border-gray-300 ${modo === "dimensoes" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                                >
                                  Comprimento × Largura
                                </button>
                              </div>
                            )}
                            {area && !editing && (
                              <div className="text-[11px] text-gray-500">
                                {temDim ? "Por comprimento × largura" : "Por área (m²)"}
                              </div>
                            )}

                            <div className={`grid gap-2 ${temDim ? "sm:grid-cols-2 lg:grid-cols-5" : "sm:grid-cols-3"} items-end`}>
                              {temDim && (
                                <>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Comprimento (mm)</label>
                                    {editing ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={med.comprimento_mm ?? ""}
                                        onChange={(e) => updMedida(i, mi, { comprimento_mm: e.target.value, modo_m2: "dimensoes" })}
                                        placeholder="ex. 500"
                                        className={`${fieldCls} tabular-nums`}
                                      />
                                    ) : (
                                      <div className="text-sm tabular-nums py-1.5">{med.comprimento_mm || "—"}</div>
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Largura (mm)</label>
                                    {editing ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={med.largura_mm ?? ""}
                                        onChange={(e) => updMedida(i, mi, { largura_mm: e.target.value, modo_m2: "dimensoes" })}
                                        placeholder="ex. 300"
                                        className={`${fieldCls} tabular-nums`}
                                      />
                                    ) : (
                                      <div className="text-sm tabular-nums py-1.5">{med.largura_mm || "—"}</div>
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">{labelQuantidade(un, { pecas: true })}</label>
                                    {editing ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={med.quantidade ?? ""}
                                        onChange={(e) => updMedida(i, mi, { quantidade: e.target.value, modo_m2: "dimensoes" })}
                                        placeholder="1"
                                        className={`${fieldCls} tabular-nums`}
                                      />
                                    ) : (
                                      <div className="text-sm tabular-nums py-1.5">{med.quantidade ?? "—"}</div>
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Área (m²)</label>
                                    <div className={editing ? fieldReadonlyCls : "text-sm tabular-nums py-1.5"}>
                                      {Number(med.comprimento_mm) > 0 && Number(med.largura_mm) > 0
                                        ? qtdEf.toLocaleString("pt-PT", { maximumFractionDigits: 4 })
                                        : "—"}
                                    </div>
                                  </div>
                                </>
                              )}

                              {!temDim && (
                                <div>
                                  <label className="text-xs text-gray-500 mb-1 block">{labelQuantidade(un)}</label>
                                  {editing ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={med.quantidade ?? ""}
                                      onChange={(e) => updMedida(i, mi, {
                                        quantidade: e.target.value,
                                        comprimento_mm: "",
                                        largura_mm: "",
                                        modo_m2: "area",
                                      })}
                                      placeholder={`ex. quantos ${un}`}
                                      className={`${fieldCls} tabular-nums`}
                                      data-testid={`artigo-material-${i}-medida-${mi}-qtd`}
                                    />
                                  ) : (
                                    <div className="text-sm tabular-nums py-1.5">{med.quantidade ?? "—"} {un}</div>
                                  )}
                                </div>
                              )}

                              <div className="text-right sm:text-left">
                                <label className="text-xs text-gray-500 mb-1 block">Custo</label>
                                <div className="tabular-nums font-medium text-gray-900 py-1.5">{eur(custoMed)}</div>
                                <div className="text-[11px] text-gray-400">
                                  {qtdEf.toLocaleString("pt-PT", { maximumFractionDigits: 4 })} {un} × {eur(m.custo_unitario)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-end pt-1 border-t border-gray-100">
                      <div className="text-right" data-testid={`artigo-material-total-${i}`}>
                        <div className="text-xs text-gray-500">Total deste material</div>
                        <div className="tabular-nums font-semibold text-gray-900">{eur(total)}</div>
                        <div className="text-[11px] text-gray-400">
                          {qtdTotal.toLocaleString("pt-PT", { maximumFractionDigits: 4 })} {un}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
