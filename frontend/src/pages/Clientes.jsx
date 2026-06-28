import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/Layout";
import SearchBar from "../components/SearchBar";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

const empty = { nome: "", morada: "", codigo_postal: "", cidade: "", pais: "Portugal", contacto: "", email: "", nif: "", notas: "" };

export default function Clientes() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => setItems(await api.get("/clientes")), []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm(empty); setEditId(null); setOpen(true); };
  const openEdit = (c) => { setForm({ nome: c.nome, morada: c.morada || "", codigo_postal: c.codigo_postal || "", cidade: c.cidade || "", pais: c.pais || "Portugal", contacto: c.contacto || "", email: c.email || "", nif: c.nif || "", notas: c.notas || "" }); setEditId(c.id); setOpen(true); };
  const save = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    if (editId) await api.put(`/clientes/${editId}`, form);
    else await api.post("/clientes", form);
    toast.success("Cliente guardado");
    setOpen(false);
    load();
  };
  const remove = async (id) => { await api.del(`/clientes/${id}`); toast.success("Cliente eliminado"); load(); };

  const ql = q.trim().toLowerCase();
  const items_f = ql ? items.filter((c) => [c.nome, c.email, c.contacto, c.nif, c.cidade].some((v) => (v || "").toLowerCase().includes(ql))) : items;

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Base de clientes para orçamentos, encomendas e ordens de fabrico"
        actions={can("clientes", "create") && (
          <button data-testid="new-cliente-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Novo Cliente</button>
        )}
      />

      <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por nome, email, contacto ou NIF..." testid="clientes-search" />

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cidade</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Contacto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">NIF</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="clientes-table">
            {items_f.map((c) => (
              <tr key={c.id} data-testid={`cliente-row-${c.id}`} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                <td className="px-4 py-3 text-gray-600">{c.cidade || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{c.contacto || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{c.email || "—"}</td>
                <td className="px-4 py-3 text-gray-500 mono">{c.nif || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("clientes", "edit") && <button data-testid={`edit-cliente-${c.id}`} onClick={() => openEdit(c)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
                    {can("clientes", "delete") && <button data-testid={`delete-cliente-${c.id}`} onClick={() => remove(c.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {items_f.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">Sem clientes.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Cliente" : "Novo Cliente"}</DialogTitle>
            <DialogDescription>Dados do cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="cliente-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Contacto</label>
                <input data-testid="cliente-contacto-input" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Email</label>
                <input data-testid="cliente-email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Morada</label>
                <input data-testid="cliente-morada-input" value={form.morada} onChange={(e) => setForm({ ...form, morada: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">NIF</label>
                <input data-testid="cliente-nif-input" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Código Postal</label>
                <input data-testid="cliente-cp-input" value={form.codigo_postal} onChange={(e) => setForm({ ...form, codigo_postal: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Cidade</label>
                <input data-testid="cliente-cidade-input" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">País</label>
                <input data-testid="cliente-pais-input" value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Notas</label>
              <textarea data-testid="cliente-notas-input" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-cliente-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
