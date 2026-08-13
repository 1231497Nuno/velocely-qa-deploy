import { useState } from "react";
import { eur } from "@/lib/api";
import { Cog, Clock, Play, Square, CheckCircle2, StickyNote } from "lucide-react";
import ImagemUpload from "@/components/ImagemUpload";

const persUnit = (it) => (it.personalizacoes || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);

function OpNota({ op, itemId, onSave }) {
  const [val, setVal] = useState(op.nota || "");
  return (
    <div className="w-full mt-1">
      <div className="flex items-start gap-1.5">
        <StickyNote size={13} className="text-gray-400 mt-1.5 shrink-0" />
        <textarea
          data-testid={`op-nota-${op.id}`}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { if ((op.nota || "") !== val) onSave(itemId, op.id, val); }}
          placeholder="Notas desta operação…"
          rows={1}
          className="flex-1 resize-y border border-gray-200 rounded-sm px-2 py-1 text-xs text-gray-700 bg-gray-50/60 focus:outline-none focus:ring-1 focus:ring-black/20 focus:bg-white"
        />
      </div>
    </div>
  );
}

export function OFRoteiroPanel({ itens, toggleOp, iniciarOp, pararOp, updOpNota, elapsedSeg, fmtDur }) {
  const hasRoteiro = itens.filter((it) => (it.operacoes || []).length > 0).length > 0;
  return (
    <div className="bg-white border border-gray-200 rounded-sm overflow-hidden flex flex-col h-[min(55vh,26rem)] lg:h-[min(70vh,32rem)]">
      <div className="shrink-0 flex items-center gap-2 text-sm font-semibold text-gray-700 px-4 py-2.5 border-b border-gray-200 bg-white">
        <Cog size={16} /> Roteiro de Operações
      </div>
      <div
        className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain p-4"
        data-testid="of-roteiro-scroll"
      >
        {!hasRoteiro ? (
          <div className="h-full min-h-[10rem] flex items-center justify-center">
            <p className="text-sm text-gray-400 text-center max-w-sm">Adicione artigos e guarde a OF para carregar automaticamente o roteiro de operações.</p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="of-roteiro">
            {itens.map((it, idx) => (
              (it.operacoes || []).length > 0 && (
                <div key={it.id || idx}>
                  <div className="flex items-center gap-3 mb-2 pb-2 border-b border-gray-200">
                    <ImagemUpload value={it.imagem} editable={false} size={44} testid={`of-roteiro-imagem-${idx}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{it.artigo_nome}</div>
                      <div className="text-xs text-gray-500 mt-0.5" data-testid={`of-item-precos-${idx}`}>
                        <span className="tabular-nums">{eur(it.preco_unit || 0)}/un</span>
                        {persUnit(it) > 0 && (
                          <span className="tabular-nums"> · c/ personalizações <span className="font-medium text-gray-700">{eur((it.preco_unit || 0) + persUnit(it))}/un</span></span>
                        )}
                      </div>
                      {(it.personalizacoes && it.personalizacoes.length > 0) ? (
                        <div className="flex flex-wrap gap-1 mt-1" data-testid={`of-item-pers-${idx}`}>
                          {it.personalizacoes.map((p, pi) => (
                            <span key={p.id || `${p.nome}-${pi}`} className="text-xs text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">{p.nome}</span>
                          ))}
                        </div>
                      ) : (it.tipo_personalizacao_nome && <span className="inline-block mt-1 text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">{it.tipo_personalizacao_nome}</span>)}
                    </div>
                    <span
                      className="shrink-0 w-24 grid grid-cols-[1.7fr_1fr] gap-x-1 gap-y-0.5 text-center bg-gray-100 border border-gray-200 rounded-sm px-1.5 py-1"
                      title={`Quantidade: ${it.quantidade} ${it.unidade || "un"}`}
                    >
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 leading-none">Qtd</span>
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 leading-none">Un</span>
                      <span className="text-sm font-bold tabular-nums text-gray-900 leading-none">{it.quantidade}</span>
                      <span className="text-xs font-bold uppercase text-gray-900 leading-none">{it.unidade || "un"}</span>
                    </span>
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
                          <OpNota op={op} itemId={it.id} onSave={updOpNota} />
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
    </div>
  );
}
