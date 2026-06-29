import { eur } from "../../lib/api";
import { Plus, X, Package, Cog, Calculator, Tag } from "lucide-react";

const toHours = (val, unit) => (Number(val) || 0) / (unit === "h" ? 1 : 60);
const maqHora = (m) => (m ? (Number(m.custo_amortizacao_hora) || 0) + (Number(m.custo_energia_hora) || 0) : 0);
const UNIDADES = ["un", "kg", "g", "m", "cm", "m²", "L", "ml", "folha", "par", "h"];

export function ArtigoForm({ form, setForm, maquinas, consumiveis, maoObra }) {
  const addMat = () => setForm({ ...form, materiais: [...form.materiais, { material_id: "", material_nome: "", unidade: "", quantidade: 1, custo_unitario: 0 }] });
  const updMat = (i, patch) => {
    const m = [...form.materiais];
    m[i] = { ...m[i], ...patch };
    setForm({ ...form, materiais: m });
  };
  const delMat = (i) => setForm({ ...form, materiais: form.materiais.filter((_, idx) => idx !== i) });

  const addOp = () => setForm({ ...form, roteiro: [...form.roteiro, { nome: "", maquina_id: "", maquina_nome: "", tempo_maquina: 0, tempo_maquina_unidade: "min", mao_obra_id: "", mao_obra_nome: "", tempo_mao_obra: 0, tempo_mao_obra_unidade: "min" }] });
  const updOp = (i, patch) => {
    const r = [...form.roteiro];
    r[i] = { ...r[i], ...patch };
    setForm({ ...form, roteiro: r });
  };
  const delOp = (i) => setForm({ ...form, roteiro: form.roteiro.filter((_, idx) => idx !== i) });

  const custoMateriais = form.materiais.reduce((s, m) => s + (Number(m.quantidade) || 0) * (Number(m.custo_unitario) || 0), 0);
  const custoMaquinas = form.roteiro.reduce((s, op) => {
    const maq = maquinas.find((x) => x.id === op.maquina_id);
    return s + toHours(op.tempo_maquina, op.tempo_maquina_unidade) * maqHora(maq);
  }, 0);
  const custoMaoObra = form.roteiro.reduce((s, op) => {
    const mo = maoObra.find((x) => x.id === op.mao_obra_id);
    return s + toHours(op.tempo_mao_obra, op.tempo_mao_obra_unidade) * (mo ? Number(mo.custo_hora) || 0 : 0);
  }, 0);
  const custoTotal = (Number(form.custo_artigo) || 0) + custoMateriais + custoMaquinas + custoMaoObra;
  const precoVenda = custoTotal * (1 + (Number(form.margem) || 0) / 100);

  return (
    <div className="space-y-6 py-2">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-3">Informação Base</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
            <input data-testid="artigo-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Descrição</label>
            <input data-testid="artigo-desc-input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Unidade de medida</label>
            <select data-testid="artigo-unidade-input" value={form.unidade || "un"} onChange={(e) => setForm({ ...form, unidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Valor do Artigo (€)</label>
            <input data-testid="artigo-valor-input" type="number" step="0.01" value={form.custo_artigo} onChange={(e) => setForm({ ...form, custo_artigo: e.target.value })} placeholder="ex: produto base" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
          </div>
        </div>
      </section>

      <section className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 flex items-center gap-2"><Package size={14} /> Materiais Necessários</h3>
          <button data-testid="add-material-row-btn" onClick={addMat} className="text-sm text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={14} /> Material</button>
        </div>
        <div className="space-y-2">
          {form.materiais.length > 0 && (
            <div className="grid grid-cols-[1fr_80px_90px_90px_32px] gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-gray-400 px-1">
              <span>Consumível</span><span className="text-right">Qtd</span><span className="text-right">€/un</span><span className="text-right">Subtotal</span><span></span>
            </div>
          )}
          {form.materiais.map((m, i) => {
            const sub = (Number(m.quantidade) || 0) * (Number(m.custo_unitario) || 0);
            return (
              <div key={i} className="grid grid-cols-[1fr_80px_90px_90px_32px] gap-2 items-center">
                <select data-testid={`material-select-${i}`} value={m.material_id || ""} onChange={(e) => { const c = consumiveis.find((x) => x.id === e.target.value); updMat(i, { material_id: e.target.value, material_nome: c ? c.nome : "", unidade: c ? c.unidade : "", custo_unitario: c ? c.custo_unitario : 0 }); }} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                  <option value="">Selecionar...</option>
                  {consumiveis.map((c) => <option key={c.id} value={c.id}>{`${c.nome} (${c.unidade})`}</option>)}
                </select>
                <input data-testid={`material-qtd-${i}`} type="number" step="0.01" value={m.quantidade} onChange={(e) => updMat(i, { quantidade: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                <div className="text-right text-sm text-gray-500 tabular-nums">{eur(m.custo_unitario)}</div>
                <div className="text-right text-sm font-medium tabular-nums">{eur(sub)}</div>
                <button onClick={() => delMat(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600 flex justify-center"><X size={15} /></button>
              </div>
            );
          })}
          {form.materiais.length === 0 && <p className="text-xs text-gray-400">Sem materiais definidos.</p>}
        </div>
      </section>

      <section className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 flex items-center gap-2"><Cog size={14} /> Operações / Tempos</h3>
          <button data-testid="add-operacao-btn" onClick={addOp} className="text-sm text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={14} /> Operação</button>
        </div>
        <div className="space-y-3">
          {form.roteiro.map((op, i) => (
            <div key={i} className="border border-gray-200 rounded-sm p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input data-testid={`op-nome-${i}`} placeholder="Nome da operação (ex: Impressão)" value={op.nome} onChange={(e) => updOp(i, { nome: e.target.value })} className="flex-1 border border-gray-300 rounded-sm px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                <button onClick={() => delOp(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><X size={15} /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-gray-400 mb-1">Máquina · tempo</div>
                  <div className="grid grid-cols-[1fr_56px_56px] gap-1.5">
                    <select data-testid={`op-maquina-${i}`} value={op.maquina_id || ""} onChange={(e) => { const mq = maquinas.find((x) => x.id === e.target.value); updOp(i, { maquina_id: e.target.value, maquina_nome: mq ? mq.nome : "" }); }} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="">Máquina...</option>
                      {maquinas.map((mq) => <option key={mq.id} value={mq.id}>{mq.nome}</option>)}
                    </select>
                    <input data-testid={`op-tempo-maquina-${i}`} type="number" placeholder="0" value={op.tempo_maquina} onChange={(e) => updOp(i, { tempo_maquina: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    <select data-testid={`op-unidade-maquina-${i}`} value={op.tempo_maquina_unidade || "min"} onChange={(e) => updOp(i, { tempo_maquina_unidade: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="min">min</option>
                      <option value="h">h</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Mão de obra · tempo</div>
                  <div className="grid grid-cols-[1fr_56px_56px] gap-1.5">
                    <select data-testid={`op-maoobra-${i}`} value={op.mao_obra_id || ""} onChange={(e) => { const mo = maoObra.find((x) => x.id === e.target.value); updOp(i, { mao_obra_id: e.target.value, mao_obra_nome: mo ? mo.nome : "" }); }} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="">Mão de obra...</option>
                      {maoObra.map((mo) => <option key={mo.id} value={mo.id}>{mo.nome}</option>)}
                    </select>
                    <input data-testid={`op-tempo-maoobra-${i}`} type="number" placeholder="0" value={op.tempo_mao_obra} onChange={(e) => updOp(i, { tempo_mao_obra: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    <select data-testid={`op-unidade-maoobra-${i}`} value={op.tempo_mao_obra_unidade || "min"} onChange={(e) => updOp(i, { tempo_mao_obra_unidade: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="min">min</option>
                      <option value="h">h</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {form.roteiro.length === 0 && <p className="text-xs text-gray-400">Sem operações definidas.</p>}
        </div>
      </section>

      <section className="border border-gray-900 rounded-sm bg-gray-900 text-white p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-300 mb-4">
          <Calculator size={14} /> Custo Total Calculado
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
          <div><div className="text-gray-400 text-xs">Valor do artigo</div><div className="tabular-nums font-medium" data-testid="calc-artigo">{eur(Number(form.custo_artigo) || 0)}</div></div>
          <div><div className="text-gray-400 text-xs">Materiais</div><div className="tabular-nums font-medium" data-testid="calc-materiais">{eur(custoMateriais)}</div></div>
          <div><div className="text-gray-400 text-xs">Máquinas</div><div className="tabular-nums font-medium" data-testid="calc-maquinas">{eur(custoMaquinas)}</div></div>
          <div><div className="text-gray-400 text-xs">Mão de Obra</div><div className="tabular-nums font-medium" data-testid="calc-maoobra">{eur(custoMaoObra)}</div></div>
        </div>
        <div className="flex items-end justify-between border-t border-gray-700 pt-4">
          <span className="text-sm text-gray-300">Custo de Produção por unidade</span>
          <span className="tabular-nums font-bold text-2xl font-display" data-testid="calc-total">{eur(custoTotal)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-700 pt-4 mt-4">
          <label className="text-sm text-gray-300 flex items-center gap-2"><Tag size={14} /> Margem de Lucro (%)</label>
          <input data-testid="artigo-margem-input" type="number" value={form.margem} onChange={(e) => setForm({ ...form, margem: e.target.value })} className="w-24 text-right border border-gray-600 bg-gray-800 text-white rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-white/30" />
        </div>
        <div className="flex items-end justify-between pt-3">
          <span className="text-sm font-semibold text-emerald-300">Preço de Venda</span>
          <span className="tabular-nums font-bold text-3xl font-display text-emerald-300" data-testid="calc-preco-venda">{eur(precoVenda)}</span>
        </div>
      </section>
    </div>
  );
}
