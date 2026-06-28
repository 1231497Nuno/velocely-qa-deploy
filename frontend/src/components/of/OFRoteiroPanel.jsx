import { Cog, Clock, Play, Square, CheckCircle2 } from "lucide-react";

export function OFRoteiroPanel({ itens, toggleOp, iniciarOp, pararOp, elapsedSeg, fmtDur }) {
  const hasRoteiro = itens.filter((it) => (it.operacoes || []).length > 0).length > 0;
  return (
    <div className="lg:col-span-2 bg-white border border-gray-200 rounded-sm p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-4"><Cog size={16} /> Roteiro de Operações</div>
      {!hasRoteiro ? (
        <p className="text-sm text-gray-400 py-8 text-center">Adicione artigos e guarde a OF para carregar automaticamente o roteiro de operações.</p>
      ) : (
        <div className="space-y-6" data-testid="of-roteiro">
          {itens.map((it, idx) => (
            (it.operacoes || []).length > 0 && (
              <div key={it.id || idx}>
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                  <div className="font-medium text-gray-900">{it.artigo_nome} <span className="text-gray-400 text-sm">× {it.quantidade}</span></div>
                  {(it.personalizacoes && it.personalizacoes.length > 0) ? (
                    <div className="flex flex-wrap gap-1 justify-end" data-testid={`of-item-pers-${idx}`}>
                      {it.personalizacoes.map((p, pi) => (
                        <span key={p.id || `${p.nome}-${pi}`} className="text-xs text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">{p.nome}</span>
                      ))}
                    </div>
                  ) : (it.tipo_personalizacao_nome && <span className="text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">{it.tipo_personalizacao_nome}</span>)}
                </div>
                <div className="space-y-2">
                  {it.operacoes.map((op) => {
                    const running = !!op.timer_inicio;
                    return (
                      <div key={op.id} data-testid={`op-row-${op.id}`} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-sm border transition-colors ${op.concluida ? "bg-emerald-50 border-emerald-200" : running ? "bg-blue-50 border-blue-300" : "bg-white border-gray-200"}`}>
                        <input type="checkbox" data-testid={`op-check-${op.id}`} checked={op.concluida} onChange={(e) => toggleOp(it.id, op.id, e.target.checked)} className="w-4 h-4 accent-emerald-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${op.concluida ? "text-emerald-700" : "text-gray-900"}`}>{op.nome || "Operação"}</div>
                          <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                            <span className="flex items-center gap-1"><Cog size={12} /> {op.maquina_nome || "—"} · <span className="tabular-nums font-medium text-gray-700">{op.tempo_maquina || 0} min</span></span>
                            <span className="flex items-center gap-1"><Clock size={12} /> {op.mao_obra_nome || "—"} · <span className="tabular-nums font-medium text-gray-700">{op.tempo_mao_obra || 0} min</span></span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] uppercase tracking-wide text-gray-400">Tempo real</div>
                          <div data-testid={`op-real-${op.id}`} className={`text-sm font-semibold tabular-nums ${running ? "text-blue-600" : "text-gray-700"}`}>{fmtDur(elapsedSeg(op))}</div>
                        </div>
                        {!op.concluida && (
                          running ? (
                            <button data-testid={`op-stop-${op.id}`} onClick={() => pararOp(it.id, op.id)} className="shrink-0 bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"><Square size={13} /> Parar</button>
                          ) : (
                            <button data-testid={`op-start-${op.id}`} onClick={() => iniciarOp(it.id, op.id)} className="shrink-0 bg-gray-900 text-white hover:bg-gray-700 rounded-sm px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"><Play size={13} /> Iniciar</button>
                          )
                        )}
                        {op.concluida && <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
