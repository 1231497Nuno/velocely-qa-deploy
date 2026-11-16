import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/Layout";

const h = (v) => `${(Number(v) || 0).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} h`;

function corPct(p) {
  if (p === null || p === undefined) return "bg-gray-50 text-gray-500";
  if (p > 100) return "bg-red-50 text-red-800 border-red-200";
  if (p > 85) return "bg-amber-50 text-amber-800 border-amber-200";
  if (p > 0) return "bg-emerald-50 text-emerald-800 border-emerald-200";
  return "text-gray-300";
}

/** Carga vs capacidade: horas de máquina por fazer (OF abertas) por semana do prazo de entrega. */
export default function CargaMaquinas() {
  const [semanas, setSemanas] = useState(6);
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/producao/carga?semanas=${semanas}`).then(setD).catch(() => toast.error("Não foi possível calcular a carga")); }, [semanas]);
  return (
    <div>
      <PageHeader
        title="Carga das máquinas"
        subtitle="Horas de máquina ainda por fazer nas OF abertas, pela semana do prazo de entrega, comparadas com a capacidade semanal de cada máquina (Catálogo → Máquinas)."
        actions={
          <select className="border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white" value={semanas} onChange={(e) => setSemanas(Number(e.target.value))} data-testid="carga-semanas">
            {[4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} semanas</option>)}
          </select>
        }
      />
      {!d ? <div className="text-sm text-gray-400 py-8 text-center">A calcular…</div> : (
        <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto" data-testid="carga-tabela">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Máquina</th>
                <th className="text-right px-3">Capacidade</th>
                <th className="text-center px-2">Atrasado</th>
                {d.semanas.map((s, i) => <th key={s} className="text-center px-2 whitespace-nowrap">{i === 0 ? "Esta semana" : `Sem. ${fmtDate(s)}`}</th>)}
                <th className="text-center px-2">Sem prazo</th>
                <th className="text-right px-3">OF</th>
              </tr>
            </thead>
            <tbody>
              {d.maquinas.map((m) => (
                <tr key={m.maquina_id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{m.nome}</td>
                  <td className="px-3 text-right tabular-nums text-gray-600">{h(m.horas_semana)}/sem.</td>
                  <td className="px-2 text-center">{m.atraso > 0 ? <span className="inline-block rounded-sm border px-1.5 py-0.5 text-xs tabular-nums bg-red-50 text-red-800 border-red-200">{h(m.atraso)}</span> : <span className="text-gray-300">—</span>}</td>
                  {m.semanas.map((s) => (
                    <td key={s.inicio} className="px-2 text-center">
                      {s.horas > 0 ? (
                        <span className={`inline-flex flex-col items-center rounded-sm border px-1.5 py-0.5 text-xs tabular-nums ${corPct(s.pct)}`} title={`${h(s.horas)} de ${h(m.horas_semana)}`}>
                          <b>{s.pct === null ? "—" : `${Math.round(s.pct)}%`}</b><span>{h(s.horas)}</span>
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                  <td className="px-2 text-center text-xs tabular-nums text-gray-600">{m.sem_prazo > 0 ? h(m.sem_prazo) : "—"}</td>
                  <td className="px-3 text-right tabular-nums">{m.n_ofs}</td>
                </tr>
              ))}
              {!d.maquinas.length && <tr><td colSpan={d.semanas.length + 5} className="px-3 py-8 text-center text-gray-400">Sem máquinas</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-2">Verde até 85%, amarelo até 100%, vermelho acima da capacidade. «Atrasado» = trabalho com prazo já passado. O tempo de máquina acertado na OF conta como feito.</p>
    </div>
  );
}
