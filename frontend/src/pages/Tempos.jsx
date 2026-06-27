import { useEffect, useState, Fragment } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { ChevronDown, ChevronRight, Timer, TrendingUp, TrendingDown } from "lucide-react";

const min = (v) => `${(Number(v) || 0).toFixed(0)} min`;
const minDec = (v) => `${(Number(v) || 0).toFixed(1)} min`;

const Desvio = ({ v, testid }) => {
  const val = Number(v) || 0;
  if (Math.abs(val) < 0.05)
    return <span data-testid={testid} className="tabular-nums text-gray-400">—</span>;
  const over = val > 0;
  return (
    <span data-testid={testid} className={`tabular-nums font-medium inline-flex items-center gap-1 ${over ? "text-red-600" : "text-emerald-600"}`}>
      {over ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {over ? "+" : ""}{val.toFixed(1)} min
    </span>
  );
};

export default function Tempos() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState({});

  const load = async () => setRows(await api.get("/producao/tempos"));
  useEffect(() => {
    load();
  }, []);

  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div>
      <PageHeader
        title="Tempos de Produção"
        subtitle="Tempo necessário (estimado) vs. tempo efetivamente utilizado — para corrigir os roteiros"
      />

      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-3 py-3 w-8"></th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">OF</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Est. Máquina</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Est. M. Obra</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Est. Total</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Real</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desvio</th>
            </tr>
          </thead>
          <tbody data-testid="tempos-table">
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr data-testid={`tempo-row-${r.id}`} onClick={() => toggle(r.id)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-3 py-3 text-gray-400">{open[r.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                  <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{r.numero}</td>
                  <td className="px-4 py-3 text-gray-700">{r.cliente}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{min(r.tempo_estimado_maquina)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{min(r.tempo_estimado_mao_obra)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{min(r.tempo_estimado_total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{minDec(r.tempo_real_min)}</td>
                  <td className="px-4 py-3 text-right"><Desvio v={r.desvio_min} testid={`desvio-${r.id}`} /></td>
                </tr>
                {open[r.id] && (
                  <tr key={`${r.id}-det`} className="bg-gray-50/60">
                    <td></td>
                    <td colSpan={8} className="px-4 py-3">
                      {r.operacoes.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">Sem operações nesta OF.</p>
                      ) : (
                        <table className="w-full text-xs border border-gray-200 rounded-sm overflow-hidden bg-white">
                          <thead>
                            <tr className="bg-white border-b border-gray-200 text-gray-400 uppercase tracking-wide">
                              <th className="text-left px-3 py-2 font-semibold">Operação</th>
                              <th className="text-left px-3 py-2 font-semibold">Máquina</th>
                              <th className="text-left px-3 py-2 font-semibold">Mão de Obra</th>
                              <th className="text-right px-3 py-2 font-semibold">Estimado</th>
                              <th className="text-right px-3 py-2 font-semibold">Real</th>
                              <th className="text-right px-3 py-2 font-semibold">Desvio</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.operacoes.map((op, i) => (
                              <tr key={i} className="border-b border-gray-100 last:border-0">
                                <td className="px-3 py-2 text-gray-900">{op.nome || "—"} {op.artigo && <span className="text-gray-400">· {op.artigo}</span>}</td>
                                <td className="px-3 py-2 text-gray-600">{op.maquina_nome || "—"} <span className="text-gray-400 tabular-nums">({min(op.tempo_maquina)})</span></td>
                                <td className="px-3 py-2 text-gray-600">{op.mao_obra_nome || "—"} <span className="text-gray-400 tabular-nums">({min(op.tempo_mao_obra)})</span></td>
                                <td className="px-3 py-2 text-right tabular-nums">{min(op.tempo_estimado)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{op.em_curso ? <span className="text-blue-600">em curso…</span> : minDec(op.tempo_real_min)}</td>
                                <td className="px-3 py-2 text-right"><Desvio v={op.desvio_min} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">Sem ordens de fabrico para analisar.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5"><Timer size={13} /> Desvio positivo (vermelho) = demorou mais que o estimado; negativo (verde) = mais rápido. Use estes dados para ajustar os tempos no roteiro dos Artigos.</p>
    </div>
  );
}
