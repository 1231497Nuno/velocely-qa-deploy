import { AlertTriangle, Cog, Package, Clock, Coins, FileText, Boxes } from "lucide-react";
import { eur } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const fmtMin = (m) => {
  const v = Math.round(Number(m) || 0);
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};
const fmtQtd = (q) => new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 3 }).format(Number(q) || 0);

function Origem({ valor, orcamento }) {
  if (valor === "orcamento") {
    return <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800">Do orçamento{orcamento ? ` ${orcamento}` : ""}</span>;
  }
  if (valor === "catalogo") {
    return <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-gray-100 text-gray-700">Do catálogo</span>;
  }
  return <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-800">Sem dados</span>;
}

function Kpi({ icon: Icon, label, value }) {
  return (
    <div className="border border-gray-200 rounded-sm px-3 py-2 bg-white">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500"><Icon size={13} /> {label}</div>
      <div className="text-base font-bold tabular-nums text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

/** Resumo para validar os dados da OF antes de a criar (operações, materiais, tempos e custos). */
export default function OfResumoDialog({ open, onOpenChange, previsao, criando, onConfirmar }) {
  const itens = previsao?.itens || [];
  const r = previsao?.resumo || {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="of-resumo-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Validar ordem de fabrico</DialogTitle>
          <DialogDescription>
            Confirme as operações e os materiais de cada artigo. As quantidades de material já estão calculadas para a quantidade a produzir.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi icon={Cog} label="Máquina" value={fmtMin(r.tempo_maquina_min)} />
          <Kpi icon={Clock} label="Mão de obra" value={fmtMin(r.tempo_mao_obra_min)} />
          <Kpi icon={Boxes} label="Materiais" value={eur(r.custo_materiais)} />
          <Kpi icon={Coins} label="Custo estimado" value={eur(r.custo_total)} />
        </div>

        {(r.avisos || []).length > 0 && (
          <ul className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 space-y-1 text-sm text-amber-900" data-testid="of-resumo-avisos">
            {r.avisos.map((a, i) => (
              <li key={i} className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {a}</li>
            ))}
          </ul>
        )}

        <div className="space-y-3">
          {itens.map((it, idx) => {
            const qtd = Number(it.quantidade) || 0;
            return (
              <section key={idx} className="border border-gray-200 rounded-sm" data-testid={`of-resumo-item-${idx}`}>
                <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package size={15} className="text-gray-500 shrink-0" />
                    <span className="font-semibold text-gray-900 truncate">{it.artigo_nome || "Artigo"}</span>
                    <span className="text-sm text-gray-600 tabular-nums">× {fmtQtd(qtd)}</span>
                  </div>
                  {it.arte_nome && <span className="inline-flex items-center gap-1 text-xs text-gray-600"><FileText size={12} /> {it.arte_nome}</span>}
                </header>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Operações</h4>
                      <Origem valor={it.origem_operacoes} orcamento={previsao?.orcamento_numero} />
                    </div>
                    {(it.operacoes || []).length === 0 ? (
                      <p className="text-sm text-gray-400">Sem operações.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {it.operacoes.map((op, i) => (
                            <tr key={i} className="border-t border-gray-100 first:border-0">
                              <td className="py-1 pr-2">
                                <div className="text-gray-900">{op.nome}</div>
                                <div className="text-[11px] text-gray-500">{[op.maquina_nome, op.mao_obra_nome].filter(Boolean).join(" · ") || "—"}</div>
                              </td>
                              <td className="py-1 text-right tabular-nums text-gray-700 whitespace-nowrap">
                                {fmtMin(((op.tempo_maquina_base ?? op.tempo_maquina) || 0) * qtd + ((op.tempo_mao_obra_base ?? op.tempo_mao_obra) || 0) * qtd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Materiais a consumir</h4>
                      <Origem valor={it.origem_materiais} orcamento={previsao?.orcamento_numero} />
                    </div>
                    {(it.materiais || []).length === 0 ? (
                      <p className="text-sm text-gray-400">Sem materiais.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {it.materiais.map((m, i) => (
                            <tr key={i} className="border-t border-gray-100 first:border-0">
                              <td className="py-1 pr-2 text-gray-900">{m.nome}</td>
                              <td className="py-1 text-right tabular-nums text-gray-700 whitespace-nowrap">{fmtQtd(m.quantidade)} {m.unidade}</td>
                              <td className="py-1 pl-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{eur(m.custo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="border border-gray-300 bg-white hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Voltar</button>
          <button type="button" onClick={onConfirmar} disabled={criando} className="bg-brand text-brand-fg hover:bg-brand-hover rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-50" data-testid="of-resumo-confirmar">
            {criando ? "A criar..." : "Confirmar e criar OF"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
