import { useEffect, useState } from "react";
import { api, eur } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";

const empty = { nome: "", custo_amortizacao_hora: 0, custo_energia_hora: 0 };

export default function Maquinas() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  const load = async () => setItems(await api.get("/maquinas"));
  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (m) => {
    setForm({
      nome: m.nome,
      custo_amortizacao_hora: m.custo_amortizacao_hora || 0,
      custo_energia_hora: m.custo_energia_hora || 0,
    });
    setEditId(m.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome da máquina");
    const body = {
      nome: form.nome,
      custo_amortizacao_hora: Number(form.custo_amortizacao_hora) || 0,
      custo_energia_hora: Number(form.custo_energia_hora) || 0,
    };
    if (editId) await api.put(`/maquinas/${editId}`, body);
    else await api.post("/maquinas", body);
    toast.success("Máquina guardada");
    setOpen(false);
    load();
  };

  const remove = async (id) => {
    await api.del(`/maquinas/${id}`);
    toast.success("Máquina eliminada");
    load();
  };

  const totalHora = (Number(form.custo_amortizacao_hora) || 0) + (Number(form.custo_energia_hora) || 0);

  return (
    <div>
      <PageHeader
        title="Máquinas"
        subtitle="Custo de amortização/desgaste e energia por hora"
        actions={
          <button data-testid="new-maquina-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Nova Máquina
          </button>
        }
      />

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Amortização / h</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Energia / h</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Total / h</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="maquinas-table">
            {items.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{m.nome}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(m.custo_amortizacao_hora)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(m.custo_energia_hora)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur((m.custo_amortizacao_hora || 0) + (m.custo_energia_hora || 0))}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`edit-maquina-${m.id}`} onClick={() => openEdit(m)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                    <button data-testid={`delete-maquina-${m.id}`} onClick={() => remove(m.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Sem máquinas. Crie a primeira.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Máquina" : "Nova Máquina"}</DialogTitle>
            <DialogDescription>Custo/hora total = amortização/desgaste + energia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome da máquina</label>
              <input data-testid="maquina-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Amortização/Desgaste por Hora (€)</label>
                <input data-testid="maquina-amortizacao-input" type="number" step="0.01" value={form.custo_amortizacao_hora} onChange={(e) => setForm({ ...form, custo_amortizacao_hora: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Energia por Hora (€) <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input data-testid="maquina-energia-input" type="number" step="0.01" value={form.custo_energia_hora} onChange={(e) => setForm({ ...form, custo_energia_hora: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-3 text-sm">
              <span className="text-gray-500">Custo total por hora</span>
              <span className="tabular-nums font-semibold" data-testid="maquina-total-hora">{eur(totalHora)}</span>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-maquina-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
