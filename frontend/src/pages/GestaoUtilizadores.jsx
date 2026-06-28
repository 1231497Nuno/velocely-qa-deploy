import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Plus, Pencil, Trash2, Shield, User, Users as UsersIcon, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

const emptyUser = { email: "", name: "", password: "", perfil_id: "" };

export default function GestaoUtilizadores() {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [meta, setMeta] = useState({ modulos: [], acoes: [] });

  // user dialog
  const [uOpen, setUOpen] = useState(false);
  const [uForm, setUForm] = useState(emptyUser);
  const [uEditId, setUEditId] = useState(null);

  // perfil dialog
  const [pOpen, setPOpen] = useState(false);
  const [pForm, setPForm] = useState(null);
  const [pEditId, setPEditId] = useState(null);

  const load = useCallback(async () => {
    setUsers(await api.get("/users"));
    setPerfis(await api.get("/perfis"));
    setMeta(await api.get("/rbac/modulos"));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ---- users ----
  const openNewUser = () => { setUForm({ ...emptyUser, perfil_id: perfis.find((p) => !p.admin)?.id || perfis[0]?.id || "" }); setUEditId(null); setUOpen(true); };
  const openEditUser = (u) => { setUForm({ email: u.email, name: u.name || "", password: "", perfil_id: u.perfil_id || "" }); setUEditId(u.id); setUOpen(true); };
  const saveUser = async () => {
    if (!uEditId && (!uForm.email.trim() || !uForm.password.trim())) return toast.error("Email e password obrigatórios");
    try {
      if (uEditId) {
        const body = { name: uForm.name, perfil_id: uForm.perfil_id };
        if (uForm.password) body.password = uForm.password;
        await api.put(`/users/${uEditId}`, body);
      } else {
        await api.post("/users", uForm);
      }
      toast.success("Utilizador guardado");
      setUOpen(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Erro ao guardar"); }
  };
  const removeUser = async (id) => {
    try { await api.del(`/users/${id}`); toast.success("Utilizador eliminado"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Erro ao eliminar"); }
  };

  // ---- perfis ----
  const blankPerms = () => {
    const p = {};
    meta.modulos.forEach((m) => { p[m.key] = {}; meta.acoes.forEach((a) => { p[m.key][a] = false; }); });
    return p;
  };
  const openNewPerfil = () => { setPForm({ nome: "", admin: false, permissoes: blankPerms() }); setPEditId(null); setPOpen(true); };
  const openEditPerfil = (p) => {
    const perms = blankPerms();
    meta.modulos.forEach((m) => meta.acoes.forEach((a) => { perms[m.key][a] = !!(p.permissoes?.[m.key]?.[a]); }));
    setPForm({ nome: p.nome, admin: !!p.admin, permissoes: perms });
    setPEditId(p.id);
    setPOpen(true);
  };
  const togglePerm = (mk, a) => setPForm((f) => ({ ...f, permissoes: { ...f.permissoes, [mk]: { ...f.permissoes[mk], [a]: !f.permissoes[mk][a] } } }));
  const toggleModuleAll = (mk, val) => setPForm((f) => ({ ...f, permissoes: { ...f.permissoes, [mk]: Object.fromEntries(meta.acoes.map((a) => [a, val])) } }));
  const savePerfil = async () => {
    if (!pForm.nome.trim()) return toast.error("Nome obrigatório");
    try {
      const body = { nome: pForm.nome, admin: pForm.admin, permissoes: pForm.permissoes };
      if (pEditId) await api.put(`/perfis/${pEditId}`, body);
      else await api.post("/perfis", body);
      toast.success("Perfil guardado");
      setPOpen(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Erro ao guardar"); }
  };
  const removePerfil = async (id) => {
    try { await api.del(`/perfis/${id}`); toast.success("Perfil eliminado"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Erro ao eliminar"); }
  };

  const acaoLabel = { view: "Ver", create: "Criar", edit: "Editar", delete: "Eliminar" };
  const isAdminProfile = (p) => p.sistema && p.admin;

  const Tab = ({ id, icon: Icon, label }) => (
    <button data-testid={`gu-tab-${id}`} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${tab === id ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}>
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Gestão de Utilizadores"
        subtitle="Faça a gestão de logins e defina perfis de acesso por módulo e ação"
        actions={
          tab === "users" ? (
            <button data-testid="new-user-btn" onClick={openNewUser} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Novo Utilizador</button>
          ) : (
            <button data-testid="new-perfil-btn" onClick={openNewPerfil} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Novo Perfil</button>
          )
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <Tab id="users" icon={UsersIcon} label="Utilizadores" />
        <Tab id="perfis" icon={Shield} label="Perfis & Acessos" />
      </div>

      {tab === "users" && (
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
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${u.role === "admin" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                      {u.role === "admin" ? <Shield size={12} /> : <User size={12} />} {u.perfil_nome || (u.role === "admin" ? "Administrador" : "Colaborador")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button data-testid={`edit-user-${u.id}`} onClick={() => openEditUser(u)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                      <button data-testid={`delete-user-${u.id}`} onClick={() => removeUser(u.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">Sem utilizadores.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "perfis" && (
        <div className="space-y-3" data-testid="perfis-list">
          {perfis.map((p) => (
            <div key={p.id} data-testid={`perfil-card-${p.id}`} className="bg-white border border-gray-200 rounded-sm p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`h-9 w-9 rounded-sm flex items-center justify-center ${p.admin ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                  {p.admin ? <Shield size={16} /> : <User size={16} />}
                </span>
                <div>
                  <div className="font-medium text-gray-900 flex items-center gap-2">{p.nome}
                    {p.sistema && <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Sistema</span>}
                  </div>
                  <div className="text-xs text-gray-500">{p.admin ? "Acesso total" : `${meta.modulos.filter((m) => p.permissoes?.[m.key]?.view).length} módulos visíveis`}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isAdminProfile(p) ? (
                  <span className="text-xs text-gray-400 flex items-center gap-1 px-2"><Lock size={13} /> Bloqueado</span>
                ) : (
                  <button data-testid={`edit-perfil-${p.id}`} onClick={() => openEditPerfil(p)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                )}
                {!p.sistema && <button data-testid={`delete-perfil-${p.id}`} onClick={() => removePerfil(p.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* User dialog */}
      <Dialog open={uOpen} onOpenChange={setUOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{uEditId ? "Editar Utilizador" : "Novo Utilizador"}</DialogTitle>
            <DialogDescription>Defina as credenciais e o perfil de acesso.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="user-name-input" value={uForm.name} onChange={(e) => setUForm({ ...uForm, name: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Email</label>
              <input data-testid="user-email-input" type="email" disabled={!!uEditId} value={uForm.email} onChange={(e) => setUForm({ ...uForm, email: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">{uEditId ? "Nova Password (opcional)" : "Password"}</label>
                <input data-testid="user-password-input" type="password" value={uForm.password} onChange={(e) => setUForm({ ...uForm, password: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Perfil</label>
                <select data-testid="user-perfil-select" value={uForm.perfil_id} onChange={(e) => setUForm({ ...uForm, perfil_id: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                  {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setUOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-user-btn" onClick={saveUser} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Perfil dialog */}
      <Dialog open={pOpen} onOpenChange={setPOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">{pEditId ? "Editar Perfil" : "Novo Perfil"}</DialogTitle>
            <DialogDescription>Defina o nome e os acessos por módulo e ação.</DialogDescription>
          </DialogHeader>
          {pForm && (
            <div className="space-y-4 py-2">
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome do perfil</label>
                  <input data-testid="perfil-nome-input" value={pForm.nome} onChange={(e) => setPForm({ ...pForm, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 pb-2 cursor-pointer">
                  <input data-testid="perfil-admin-check" type="checkbox" checked={pForm.admin} onChange={(e) => setPForm({ ...pForm, admin: e.target.checked })} className="h-4 w-4" />
                  Acesso total (Administrador)
                </label>
              </div>

              {!pForm.admin && (
                <div className="border border-gray-200 rounded-sm overflow-x-auto max-h-[50vh]">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Módulo</th>
                        {meta.acoes.map((a) => <th key={a} className="text-center px-2 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{acaoLabel[a] || a}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {meta.modulos.map((m) => (
                        <tr key={m.key} data-testid={`perm-row-${m.key}`} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-800">{m.label}</td>
                          {meta.acoes.map((a) => (
                            <td key={a} className="text-center px-2 py-2">
                              <input data-testid={`perm-${m.key}-${a}`} type="checkbox" checked={!!pForm.permissoes[m.key]?.[a]} onChange={() => togglePerm(m.key, a)} className="h-4 w-4 cursor-pointer" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {pForm.admin && <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-sm px-3 py-2">Este perfil terá acesso total a todos os módulos e ações.</p>}
            </div>
          )}
          <DialogFooter>
            <button onClick={() => setPOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-perfil-btn" onClick={savePerfil} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
