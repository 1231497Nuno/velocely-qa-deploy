import { useCallback, useEffect, useState } from "react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import UtilizacoesDialog from "@/components/UtilizacoesDialog";

const empty = { nome: "", descricao: "", valor: 0, tempo: 0 };

export default function TiposPersonalizacao() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [uso, setUso] = useState(null);

  const load = useCallback(async () => setItems(await api.get("/tipos-personalizacao")), []);
  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (t) => {
    setForm({ nome: t.nome, descricao: t.descricao || "", valor: t.valor || 0, tempo: t.tempo || 0 });
    setEditId(t.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome");
    const body = { nome: form.nome, descricao: form.descricao, valor: Number(form.valor) || 0, tempo: Number(form.tempo) || 0 };
    if (editId) await api.put(`/tipos-personalizacao/${editId}`, body);
    else await api.post("/tipos-personalizacao", body);
    toast.success("Tipo guardado");
    setOpen(false);
    load();
  };

  const remove = async (id) => {
    await api.del(`/tipos-personalizacao/${id}`);
    toast.success("Tipo eliminado");
    load();
  };

  const ql = q.trim().toLowerCase();
  const items_f = ql ? items.filter((t) => (t.nome || "").toLowerCase().includes(ql)) : items;

  return (
    <div>
      <PageHeader
        title="Tipos de Personalização"
        subtitle="Catálogo de técnicas de personalização disponíveis"
        actions={
          can("personalizacao","create") && (<button data-testid="new-tipo-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Novo Tipo
          </button>)
        }
      />

      <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por nome..." testid="personalizacao-search" />

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Descrição</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tempo M.O.</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="tipos-table">
            {items_f.map((t) => (
              <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{t.nome}</td>
                <td className="px-4 py-3 text-gray-600">{t.descricao || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(t.valor)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(t.tempo || 0) > 0 ? `${t.tempo}m` : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`uso-tipo-${t.id}`} onClick={() => setUso({ endpoint: `/tipos-personalizacao/${t.id}/utilizacoes`, titulo: `Onde é usada: ${t.nome}`, subtitulo: "Orçamentos, encomendas e OFs que usam esta personalização." })} title="Onde é usada" className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500"><Eye size={15} /></button>
                    {can("personalizacao","edit") && (<button data-testid={`edit-tipo-${t.id}`} onClick={() => openEdit(t)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>)}
                    {can("personalizacao","delete") && (<button data-testid={`delete-tipo-${t.id}`} onClick={() => remove(t.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>)}
                  </div>
                </td>
              </tr>
            ))}
            {items_f.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Sem tipos de personalização.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Tipo" : "Novo Tipo de Personalização"}</DialogTitle>
            <DialogDescription>Técnica de personalização com valor sugerido (€/unidade).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="tipo-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Descrição</label>
              <textarea data-testid="tipo-desc-input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Valor por unidade (€)</label>
              <input data-testid="tipo-valor-input" type="number" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              <p className="text-xs text-gray-400 mt-1">Valor sugerido, editável depois em cada linha do orçamento.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Tempo de mão de obra por unidade (min)</label>
              <input data-testid="tipo-tempo-input" type="number" step="0.1" value={form.tempo} onChange={(e) => setForm({ ...form, tempo: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              <p className="text-xs text-gray-400 mt-1">Somado (× quantidade) à mão de obra da operação responsável pelas personalizações na Ordem de Fabrico.</p>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-tipo-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UtilizacoesDialog open={!!uso} onOpenChange={(v) => !v && setUso(null)} endpoint={uso?.endpoint} titulo={uso?.titulo} subtitulo={uso?.subtitulo} />
    </div>
  );
}
