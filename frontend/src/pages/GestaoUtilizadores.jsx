import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Plus, Pencil, Trash2, Shield, User } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

const empty = { email: "", name: "", password: "", role: "colaborador" };

export default function GestaoUtilizadores() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  const load = async () => setItems(await api.get("/users"));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditId(null); setOpen(true); };
  const openEdit = (u) => { setForm({ email: u.email, name: u.name || "", password: "", role: u.role }); setEditId(u.id); setOpen(true); };

  const save = async () => {
    if (!editId && (!form.email.trim() || !form.password.trim())) return toast.error("Email e password obrigatórios");
    try {
      if (editId) {
        const body = { name: form.name, role: form.role };
        if (form.password) body.password = form.password;
        await api.put(`/users/${editId}`, body);
      } else {
        await api.post("/users", form);
      }
      toast.success("Utilizador guardado");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/users/${id}`);
      toast.success("Utilizador eliminado");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao eliminar");
    }
  };

  return (
    <div>
      <PageHeader
        title="Gestão de Utilizadores"
        subtitle="Crie e faça a gestão de logins de administradores e colaboradores"
        actions={
          <button data-testid="new-user-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Novo Utilizador
          </button>
        }
      />

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Email</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Perfil</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="users-table">
            {items.map((u) => (
              <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{u.name || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${u.role === "admin" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                    {u.role === "admin" ? <Shield size={12} /> : <User size={12} />}
                    {u.role === "admin" ? "Administrador" : "Colaborador"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`edit-user-${u.id}`} onClick={() => openEdit(u)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                    <button data-testid={`delete-user-${u.id}`} onClick={() => remove(u.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">Sem utilizadores.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Utilizador" : "Novo Utilizador"}</DialogTitle>
            <DialogDescription>Defina as credenciais e o perfil de acesso.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="user-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Email</label>
              <input data-testid="user-email-input" type="email" disabled={!!editId} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">{editId ? "Nova Password (opcional)" : "Password"}</label>
                <input data-testid="user-password-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Perfil</label>
                <select data-testid="user-role-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                  <option value="colaborador">Colaborador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-user-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
