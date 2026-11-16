import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const segunda = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function Cartao({ o, podeEditar }) {
  const atrasada = o.prazo && o.prazo < iso(new Date());
  return (
    <div draggable={podeEditar} onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify(o))}
      className={`rounded-sm border px-2 py-1.5 text-xs bg-white shadow-sm ${podeEditar ? "cursor-grab" : ""} ${o.em_curso ? "border-emerald-400" : atrasada ? "border-red-300" : "border-gray-200"}`}
      title={`${o.of_numero} · ${o.cliente} · ${o.artigo_nome} ×${o.quantidade}${o.prazo ? ` · prazo ${fmtDate(o.prazo)}` : ""}`}>
      <div className="flex items-center gap-1 font-semibold">
        {o.prioritaria && <Star size={11} className="fill-amber-400 text-amber-500" />}
        <Link to={`/ordens-fabrico/${o.of_id}`} className="hover:underline">{o.of_numero}</Link>
        <span className="ml-auto tabular-nums text-gray-500">{o.horas} h</span>
      </div>
      <div className="truncate">{o.nome} — {o.artigo_nome}</div>
      <div className={`truncate ${atrasada ? "text-red-600" : "text-gray-400"}`}>{o.cliente}{o.prazo ? ` · ${fmtDate(o.prazo)}` : ""}</div>
    </div>
  );
}

/** Planeamento por máquina: arrastar as operações por fazer para o dia em que vão ser feitas. */
export default function Planeamento() {
  const { can } = useAuth();
  const podeEditar = can("ordens_fabrico", "edit");
  const [inicio, setInicio] = useState(() => segunda(new Date()));
  const [d, setD] = useState(null);
  const carregar = useCallback(() => api.get(`/producao/planeamento?inicio=${iso(inicio)}&dias=6`).then(setD).catch(() => toast.error("Não foi possível carregar")), [inicio]);
  useEffect(() => { carregar(); }, [carregar]);
  const porCelula = useMemo(() => {
    const m = {};
    (d?.operacoes || []).forEach((o) => { const k = `${o.maquina_id || "-"}|${o.data && d.datas.includes(o.data) ? o.data : "por"}`; (m[k] = m[k] || []).push(o); });
    return m;
  }, [d]);
  const largar = async (e, data) => {
    e.preventDefault();
    if (!podeEditar) return;
    let o;
    try { o = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if ((o.data || null) === data) return;
    setD((x) => ({ ...x, operacoes: x.operacoes.map((y) => (y.operacao_id === o.operacao_id && y.of_id === o.of_id ? { ...y, data } : y)) }));
    try { await api.post(`/ordens-fabrico/${o.of_id}/operacao/planear`, { item_id: o.item_id, operacao_id: o.operacao_id, data }); }
    catch { toast.error("Não foi possível planear"); carregar(); }
  };
  const mover = (dias) => setInicio((x) => { const n = new Date(x); n.setDate(n.getDate() + dias); return n; });
  if (!d) return null;
  const linhas = [...d.maquinas, ...(d.operacoes.some((o) => !o.maquina_id) ? [{ id: "-", nome: "Sem máquina", horas_dia: 8 }] : [])];
  return (
    <div>
      <PageHeader title="Planeamento" subtitle="Arraste as operações por fazer para o dia e a máquina. A barra mostra a ocupação face às horas por dia (capacidade semanal ÷ 5)."
        actions={<div className="flex items-center gap-1">
          <button type="button" className="btn btn-secundario" onClick={() => mover(-7)}><ChevronLeft size={15} /></button>
          <button type="button" className="btn btn-secundario" onClick={() => setInicio(segunda(new Date()))}>Esta semana</button>
          <button type="button" className="btn btn-secundario" onClick={() => mover(7)}><ChevronRight size={15} /></button>
        </div>} />
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-sm" data-testid="planeamento">
        <table className="w-full text-sm border-collapse min-w-[1100px]">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-2 py-2 w-36">Máquina</th>
              <th className="text-left px-2 w-52">Por planear</th>
              {d.datas.map((x) => { const dt = new Date(`${x}T12:00:00`); return <th key={x} className={`text-left px-2 ${x === iso(new Date()) ? "text-gray-900" : ""}`}>{DIAS[(dt.getDay() + 6) % 7]} {fmtDate(x).slice(0, 5)}</th>; })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((m) => (
              <tr key={m.id} className="border-t border-gray-100 align-top">
                <td className="px-2 py-2 font-medium">{m.nome}</td>
                {["por", ...d.datas].map((dia) => {
                  const ops = porCelula[`${m.id}|${dia}`] || [];
                  const horas = ops.reduce((s, o) => s + o.horas, 0);
                  const pct = dia === "por" ? 0 : (horas / (m.horas_dia || 8)) * 100;
                  return (
                    <td key={dia} className={`px-1.5 py-1.5 ${dia === "por" ? "bg-gray-50/70" : ""}`} onDragOver={(e) => podeEditar && e.preventDefault()} onDrop={(e) => largar(e, dia === "por" ? null : dia)}>
                      {dia !== "por" && horas > 0 && (
                        <div className="h-1.5 rounded-full bg-gray-100 mb-1 overflow-hidden" title={`${horas.toFixed(1)} h de ${m.horas_dia} h`}>
                          <div className={`h-full ${pct > 100 ? "bg-red-500" : pct > 85 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      )}
                      <div className="space-y-1 min-h-[2.5rem]">{ops.map((o) => <Cartao key={`${o.of_id}${o.operacao_id}`} o={o} podeEditar={podeEditar} />)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
