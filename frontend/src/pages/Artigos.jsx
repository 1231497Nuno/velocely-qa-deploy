import { useEffect, useState } from "react";
import { api, eur } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";

const empty = {
  nome: "",
  descricao: "",
  custo_materiais: 0,
  custo_mao_obra: 0,
  custo_overhead: 0,
  roteiro: [],
};

export default function Artigos() {
  const [items, setItems] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    setItems(await api.get("/artigos"));
    setMaquinas(await api.get("/maquinas"));
  };
  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (a) => {
    setForm({
      nome: a.nome,
      descricao: a.descricao || "",
      custo_materiais: a.custo_materiais,
      custo_mao_obra: a.custo_mao_obra,
      custo_overhead: a.custo_overhead,
      roteiro: a.roteiro || [],
    });
    setEditId(a.id);
    setOpen(true);
  };

  const addOp = () =>
    setForm({
      ...form,
      roteiro: [...form.roteiro, { nome: "", maquina_id: "", maquina_nome: "", tempo_min: 0 }],
    });
  const updOp = (i, patch) => {
    const r = [...form.roteiro];
    r[i] = { ...r[i], ...patch };
    setForm({ ...form, roteiro: r });
  };
  const delOp = (i) => setForm({ ...form, roteiro: form.roteiro.filter((_, idx) => idx !== i) });

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome do artigo");
    const body = {
      ...form,
      custo_materiais: Number(form.custo_materiais) || 0,
      custo_mao_obra: Number(form.custo_mao_obra) || 0,
      custo_overhead: Number(form.custo_overhead) || 0,
      roteiro: form.roteiro.map((o) => ({
        ...o,
        tempo_min: Number(o.tempo_min) || 0,
      })),
    };
    if (editId) await api.put(`/artigos/${editId}`, body);
    else await api.post("/artigos", body);
    toast.success("Artigo guardado");
    setOpen(false);
    load();
  };

  const remove = async (id) => {
    await api.del(`/artigos/${id}`);
    toast.success("Artigo eliminado");
    load();
  };

  return (
    <div>
      <PageHeader
        title="Artigos"
        subtitle="Base de artigos com custos de produção e roteiro de operações"
        actions={
          <button data-testid="new-artigo-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Novo Artigo
          </button>
        }
      />

      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Artigo</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Materiais</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Mão de Obra</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Overhead</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Operações</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Total</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="artigos-table">
            {items.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{a.nome}</div>
                  {a.descricao && <div className="text-xs text-gray-500">{a.descricao}</div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_materiais)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_mao_obra)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_overhead)}</td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-600">{(a.roteiro || []).length}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(a.custo_producao_total)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`edit-artigo-${a.id}`} onClick={() => openEdit(a)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                    <button data-testid={`delete-artigo-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">Sem artigos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Artigo" : "Novo Artigo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
                <input data-testid="artigo-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Descrição</label>
                <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Materiais (€)</label>
                <input data-testid="artigo-materiais-input" type="number" step="0.01" value={form.custo_materiais} onChange={(e) => setForm({ ...form, custo_materiais: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Mão de Obra (€)</label>
                <input type="number" step="0.01" value={form.custo_mao_obra} onChange={(e) => setForm({ ...form, custo_mao_obra: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Overhead (€)</label>
                <input type="number" step="0.01" value={form.custo_overhead} onChange={(e) => setForm({ ...form, custo_overhead: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">Roteiro de Operações (máquinas + tempos)</label>
                <button data-testid="add-operacao-btn" onClick={addOp} className="text-sm text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={14} /> Operação</button>
              </div>
              <div className="space-y-2">
                {form.roteiro.map((op, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_90px_32px] gap-2 items-center">
                    <input placeholder="Operação" value={op.nome} onChange={(e) => updOp(i, { nome: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    <select value={op.maquina_id || ""} onChange={(e) => { const m = maquinas.find((x) => x.id === e.target.value); updOp(i, { maquina_id: e.target.value, maquina_nome: m ? m.nome : "" }); }} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="">Sem máquina</option>
                      {maquinas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                    <input type="number" placeholder="min" value={op.tempo_min} onChange={(e) => updOp(i, { tempo_min: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    <button onClick={() => delOp(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600 flex justify-center"><X size={15} /></button>
                  </div>
                ))}
                {form.roteiro.length === 0 && <p className="text-xs text-gray-400">Sem operações definidas.</p>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-artigo-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
