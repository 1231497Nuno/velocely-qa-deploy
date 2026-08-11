import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export default function Subcategorias() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [filtroCat, setFiltroCat] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", categoria_id: "" });
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    setCategorias(await api.get("/categorias"));
    const url = filtroCat ? `/subcategorias?categoria_id=${filtroCat}` : "/subcategorias";
    setItems(await api.get(url));
  }, [filtroCat]);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm({ nome: "", categoria_id: filtroCat || (categorias[0]?.id || "") });
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (s) => {
    setForm({ nome: s.nome || "", categoria_id: s.categoria_id || "" });
    setEditId(s.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome da subcategoria");
    if (!form.categoria_id) return toast.error("Selecione a categoria");
    try {
      const body = { nome: form.nome.trim(), categoria_id: form.categoria_id };
      if (editId) await api.put(`/subcategorias/${editId}`, body);
      else await api.post("/subcategorias", body);
      toast.success("Subcategoria guardada");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/subcategorias/${id}`);
      toast.success("Subcategoria eliminada");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível eliminar");
    }
  };

  const ql = q.trim().toLowerCase();
  const items_f = ql
    ? items.filter((s) =>
        [s.codigo, s.nome, s.categoria_nome].some((v) => (v || "").toLowerCase().startsWith(ql)),
      )
    : items;

  return (
    <div>
      <PageHeader
        title="Subcategorias"
        subtitle="Dentro de cada categoria — ex.: Têxtil → T-shirt"
        actions={can("categorias", "create") && (
          <button data-testid="new-subcategoria-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
            <Plus size={16} /> Nova Subcategoria
          </button>
        )}
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <select
          data-testid="sub-filtro-categoria"
          value={filtroCat}
          onChange={(e) => setFiltroCat(e.target.value)}
          className="border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
        >
          <option value="">Todas as categorias</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <div className="flex-1">
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do código ou nome..." testid="subcategorias-search" />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Categoria</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="subcategorias-table">
            {items_f.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{s.codigo || "—"}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{s.nome}</td>
                <td className="px-4 py-3 text-gray-600">{s.categoria_nome || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("categorias", "edit") && <button data-testid={`edit-subcategoria-${s.id}`} onClick={() => openEdit(s)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
                    {can("categorias", "delete") && <button data-testid={`delete-subcategoria-${s.id}`} onClick={() => remove(s.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {items_f.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">Sem subcategorias. Crie a primeira (ex.: T-shirt sob Têxtil).</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Subcategoria" : "Nova Subcategoria"}</DialogTitle>
            <DialogDescription>Exemplo: T-shirt, Hoodie, Etiqueta…</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Categoria</label>
              <select
                data-testid="subcategoria-cat-select"
                value={form.categoria_id}
                onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              >
                <option value="">— Selecionar —</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="subcategoria-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white border border-gray-300 rounded-sm px-4 py-2 text-sm">Cancelar</button>
            <button data-testid="save-subcategoria-btn" onClick={save} className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
