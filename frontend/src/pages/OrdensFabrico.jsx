import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate } from "../lib/api";
import { PageHeader } from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TIMER_INFO = {
  por_iniciar: { color: "bg-gray-400", label: "Por iniciar" },
  em_curso: { color: "bg-emerald-500", label: "Em curso", pulse: true },
  em_pausa: { color: "bg-amber-400", label: "Em pausa" },
  concluido: { color: "bg-gray-300", label: "Concluída" },
};

const TimerDot = ({ estado }) => {
  const info = TIMER_INFO[estado] || TIMER_INFO.por_iniciar;
  return (
    <span data-testid={`timer-dot-${estado}`} className="inline-flex items-center gap-2" title={info.label}>
      <span className="relative flex h-2.5 w-2.5">
        {info.pulse && <span className={`absolute inline-flex h-full w-full rounded-full ${info.color} opacity-60 animate-ping`} />}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${info.color}`} />
      </span>
      <span className="text-xs text-gray-600">{info.label}</span>
    </span>
  );
};

export default function OrdensFabrico() {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState("ativas");
  const nav = useNavigate();

  const load = async () => setItems(await api.get("/ordens-fabrico"));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const of = await api.post("/ordens-fabrico", { cliente: "Novo Cliente", status: "pendente", itens: [] });
    nav(`/ordens-fabrico/${of.id}`);
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/ordens-fabrico/${id}`);
    toast.success("OF eliminada");
    load();
  };

  const ativas = items.filter((o) => o.status !== "concluido");
  const concluidas = items.filter((o) => o.status === "concluido");
  const rows = tab === "ativas" ? ativas : concluidas;

  const Tab = ({ id, label, count }) => (
    <button
      data-testid={`of-tab-${id}`}
      onClick={() => setTab(id)}
      className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${tab === id ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
    >
      {label}
      <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${tab === id ? "bg-white/20" : "bg-gray-100 text-gray-500"}`}>{count}</span>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Ordens de Fabrico"
        subtitle="Produção com roteiro de operações para o operador"
        actions={
          <button data-testid="new-of-btn" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Nova OF
          </button>
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <Tab id="ativas" label="Ativas" count={ativas.length} />
        <Tab id="concluidas" label="Concluídas" count={concluidas.length} />
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {tab === "ativas" && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cronómetro</th>}
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº Enc.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Origem</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Progresso</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody data-testid="ofs-table">
            {rows.map((o) => (
              <tr key={o.id} data-testid={`of-row-${o.id}`} onClick={() => nav(`/ordens-fabrico/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                {tab === "ativas" && <td className="px-4 py-3"><TimerDot estado={o.timer_estado} /></td>}
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                <td className="px-4 py-3 text-gray-500 mono text-xs">{o.numero_encomenda || "—"}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(o.data)}</td>
                <td className="px-4 py-3 mono text-gray-500 text-xs">{o.orcamento_numero || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3">
                  <button data-testid={`delete-of-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={tab === "ativas" ? 9 : 8} className="px-4 py-10 text-center text-gray-400 text-sm">{tab === "ativas" ? "Sem ordens de fabrico ativas." : "Sem ordens de fabrico concluídas."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {tab === "ativas" && (
        <div className="flex items-center gap-5 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gray-400" /> Por iniciar</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Em curso</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Em pausa</span>
        </div>
      )}
    </div>
  );
}
