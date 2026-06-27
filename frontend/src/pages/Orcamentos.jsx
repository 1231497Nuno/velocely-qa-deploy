import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "../lib/api";
import { PageHeader } from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Orcamentos() {
  const [items, setItems] = useState([]);
  const nav = useNavigate();

  const load = async () => setItems(await api.get("/orcamentos"));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const o = await api.post("/orcamentos", {
      cliente: "Novo Cliente",
      status: "rascunho",
      linhas: [],
    });
    nav(`/orcamentos/${o.id}`);
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/orcamentos/${id}`);
    toast.success("Orçamento eliminado");
    load();
  };

  return (
    <div>
      <PageHeader
        title="Orçamentos"
        subtitle="Propostas de preço com numeração sequencial automática"
        actions={
          <button data-testid="new-orcamento-btn" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Novo Orçamento
          </button>
        }
      />

      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Número</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº Enc.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Validade</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Total</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody data-testid="orcamentos-table">
            {items.map((o) => (
              <tr key={o.id} data-testid={`orcamento-row-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                <td className="px-4 py-3 text-gray-500 mono text-xs">{o.numero_encomenda || "—"}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(o.data)}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(o.validade)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(o.total)}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3">
                  <button data-testid={`delete-orcamento-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Sem orçamentos. Crie o primeiro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
