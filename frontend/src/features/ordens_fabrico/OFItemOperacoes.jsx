import { Plus, Trash2, Cog } from "lucide-react";

export function OFItemOperacoes({ item, i, maquinas, maoObra, addOp, updOp, delOp }) {
  const ops = item.operacoes || [];
  const qtd = Number(item.quantidade) || 1;
  return (
    <div className="border-t border-gray-100 pt-2 mt-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 flex items-center gap-1.5"><Cog size={12} /> Operações</span>
        <button data-testid={`of-add-op-${i}`} onClick={() => addOp(i)} className="text-xs text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={12} /> Operação</button>
      </div>
      {ops.length === 0 && <p className="text-xs text-gray-400">Sem operações. Guarde para carregar o roteiro ou adicione manualmente.</p>}
      <div className="space-y-2">
        {ops.map((op, oi) => (
          <div key={op.id || oi} data-testid={`of-op-edit-${i}-${oi}`} className="bg-gray-50 border border-gray-200 rounded-sm p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <input data-testid={`of-op-nome-${i}-${oi}`} value={op.nome || ""} onChange={(e) => updOp(i, op.id, { nome: e.target.value })} placeholder="Nome da operação" className="flex-1 border border-gray-300 rounded-sm px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20" />
              {op.manual && (
                <button data-testid={`of-op-del-${i}-${oi}`} onClick={() => delOp(i, op.id)} className="p-1 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={13} /></button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center gap-1">
                <select data-testid={`of-op-maquina-${i}-${oi}`} value={op.maquina_id || ""} onChange={(e) => { const m = maquinas.find((x) => x.id === e.target.value); updOp(i, op.id, { maquina_id: e.target.value, maquina_nome: m ? m.nome : "", maquina_custo_hora: 0 }); }} className="flex-1 min-w-0 border border-gray-300 rounded-sm px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                  <option value="">Máquina…</option>
                  {maquinas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
                <input data-testid={`of-op-tmaq-${i}-${oi}`} type="number" min="0" step="0.1" value={op.tempo_maquina_base ?? 0} onChange={(e) => updOp(i, op.id, { tempo_maquina_base: e.target.value })} title="min por unidade" className="w-14 text-right border border-gray-300 rounded-sm px-1 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                <span className="text-[10px] text-gray-400">/un</span>
              </div>
              <div className="flex items-center gap-1">
                <select data-testid={`of-op-mo-${i}-${oi}`} value={op.mao_obra_id || ""} onChange={(e) => { const m = maoObra.find((x) => x.id === e.target.value); updOp(i, op.id, { mao_obra_id: e.target.value, mao_obra_nome: m ? m.nome : "", mao_obra_custo_hora: 0 }); }} className="flex-1 min-w-0 border border-gray-300 rounded-sm px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                  <option value="">Mão de obra…</option>
                  {maoObra.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
                <input data-testid={`of-op-tmo-${i}-${oi}`} type="number" min="0" step="0.1" value={op.tempo_mao_obra_base ?? 0} onChange={(e) => updOp(i, op.id, { tempo_mao_obra_base: e.target.value })} title="min por unidade" className="w-14 text-right border border-gray-300 rounded-sm px-1 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                <span className="text-[10px] text-gray-400">/un</span>
              </div>
            </div>
            <div className="text-[10px] text-gray-400 text-right">
              Total × {qtd}: {((Number(op.tempo_maquina_base) || 0) * qtd).toFixed(1)}m máq · {((Number(op.tempo_mao_obra_base) || 0) * qtd).toFixed(1)}m m.obra
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
