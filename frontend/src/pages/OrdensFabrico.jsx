import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate } from "../lib/api";
import { PageHeader } from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function OrdensFabrico() {
  const [items, setItems] = useState([]);
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

      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Origem</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Progresso</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody data-testid="ofs-table">
            {items.map((o) => (
              <tr key={o.id} data-testid={`of-row-${o.id}`} onClick={() => nav(`/ordens-fabrico/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(o.data)}</td>
                <td className="px-4 py-3 mono text-gray-500 text-xs">{o.orcamento_numero || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3">
                  <button data-testid={`delete-of-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">Sem ordens de fabrico.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
