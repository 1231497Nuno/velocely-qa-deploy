import { MOVEL_OPS } from "@/lib/movelOps";
import MenuEditor from "@/components/MenuEditor";
import { NAV_GROUPS } from "@/components/Layout";
import { BLOCOS } from "@/features/dashboard/Dashboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import { useConfirmLeave, useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useConfirm } from "@/hooks/useConfirm";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { Plus, Pencil, Trash2, Shield, User, Users as UsersIcon, Lock, KeyRound, Copy, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const emptyUser = { login: "", email: "", name: "", cargo: "", perfil_id: "" };

export default function GestaoUtilizadores() {
  const [tab, setTab] = useState("users");
  const confirmLeave = useConfirmLeave();
  const confirmAction = useConfirm();
  const {
    items: users, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload: reloadUsers, rangeLabel,
  } = useServerPagedList("/users", { enabled: tab === "users" });
  const [perfis, setPerfis] = useState([]);
  const [meta, setMeta] = useState({ modulos: [], acoes: [] });

  // user dialog
  const [uOpen, setUOpen] = useState(false);
  const [uForm, setUForm] = useState(emptyUser);
  const [uEditId, setUEditId] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null); // { login, invite_code, message }

  // perfil dialog
  const [pOpen, setPOpen] = useState(false);
  const [pForm, setPForm] = useState(null);
  const [pEditId, setPEditId] = useState(null);
  const saveUserRef = useRef(null);
  const savePerfilRef = useRef(null);
  useUnsavedChanges({
    dirty: uOpen || pOpen,
    onSave: async () => {
      if (uOpen && saveUserRef.current) return saveUserRef.current();
      if (pOpen && savePerfilRef.current) return savePerfilRef.current();
      return true;
    },
  });

  const loadMeta = useCallback(async () => {
    setPerfis(await api.get("/perfis"));
    setMeta(await api.get("/rbac/modulos"));
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // ---- users ----
  const openNewUser = () => { setUForm({ ...emptyUser, perfil_id: perfis.find((p) => !p.admin)?.id || perfis[0]?.id || "" }); setUEditId(null); setUOpen(true); };
  const openEditUser = (u) => { setUForm({ login: u.login || "", email: u.email || "", name: u.name || "", cargo: u.cargo || "", perfil_id: u.perfil_id || "" }); setUEditId(u.id); setUOpen(true); };
  const showInvite = (res) => {
    if (!res?.invite_code) return;
    setInviteInfo({
      login: res.login,
      invite_code: res.invite_code,
      message: res.invite_message || "Envie o login e o código ao utilizador.",
    });
  };
  const errMsg = (e, fallback = "Erro ao guardar") => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
    return fallback;
  };
  const saveUser = async () => {
    if (!uEditId && !uForm.login.trim()) {
      toast.error("Login obrigatório");
      return false;
    }
    try {
      const body = {
        login: uForm.login.trim(),
        name: uForm.name.trim(),
        email: (uForm.email || "").trim(),
        cargo: (uForm.cargo || "").trim(),
        perfil_id: uForm.perfil_id || null,
      };
      if (uEditId) {
        await api.put(`/users/${uEditId}`, body);
        toast.success("Utilizador guardado");
      } else {
        const res = await api.post("/users", body);
        toast.success("Utilizador criado — envie o código de convite");
        showInvite(res);
      }
      setUOpen(false);
      reloadUsers();
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    }
  };
  saveUserRef.current = saveUser;
  const reinvitar = async (u) => {
    try {
      const res = await api.post(`/users/${u.id}/reinvitar`);
      toast.success("Novo código gerado");
      showInvite(res);
      reloadUsers();
    } catch (e) { toast.error(e?.response?.data?.detail || "Erro ao gerar código"); }
  };
  const repor2fa = async (u) => {
    if (!(await confirmAction({ title: `Repor a verificação em dois passos de ${u.name}?`, description: "Use quando o utilizador perdeu o telemóvel. Passa a entrar só com a password e pode voltar a ativar.", confirmLabel: "Repor" }))) return;
    try { await api.post(`/users/${u.id}/2fa/repor`); toast.success("Verificação em dois passos reposta"); reloadUsers(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível repor"); }
  };
  const copyInvite = async () => {
    if (!inviteInfo) return;
    const text = `Utilizador: ${inviteInfo.login}\nCódigo: ${inviteInfo.invite_code}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      toast.message(text);
    }
  };
  const removeUser = async (id) => {
    try { await api.del(`/users/${id}`); toast.success("Utilizador eliminado"); reloadUsers(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Erro ao eliminar"); }
  };

  // ---- perfis ----
  const blankPerms = () => {
    const p = {};
    meta.modulos.forEach((m) => { p[m.key] = {}; meta.acoes.forEach((a) => { p[m.key][a] = false; }); });
    return p;
  };
  const [menuPerfilOpen, setMenuPerfilOpen] = useState(false);
  const openNewPerfil = () => { setPForm({ nome: "", admin: false, permissoes: blankPerms(), ver_custos: true, so_proprios: [], pagina_inicial: "", app_movel: null, menu: null, painel_ocultos: null, painel_ordem: null }); setPEditId(null); setPOpen(true); };
  const [modelos, setModelos] = useState([]);
  useEffect(() => { api.get("/perfis/modelos").then(setModelos).catch(() => {}); }, []);
  const criarDeModelo = async (m) => {
    try {
      const p = await api.post(`/perfis/modelos/${m.id}`);
      toast.success(`Perfil «${p.nome}» criado — ajuste as permissões se precisar`);
      await loadMeta();
      openEditPerfil(p);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível criar");
    }
  };
  const openEditPerfil = (p) => {
    const perms = blankPerms();
    meta.modulos.forEach((m) => meta.acoes.forEach((a) => { perms[m.key][a] = !!(p.permissoes?.[m.key]?.[a]); }));
    setPForm({ nome: p.nome, admin: !!p.admin, permissoes: perms, ver_custos: p.ver_custos !== false, so_proprios: p.so_proprios || [], pagina_inicial: p.pagina_inicial || "", app_movel: Array.isArray(p.app_movel) ? p.app_movel : null, menu: p.menu || null, painel_ocultos: p.painel_ocultos ?? null, painel_ordem: p.painel_ordem ?? null });
    setPEditId(p.id);
    setPOpen(true);
  };
  const togglePerm = (mk, a) => setPForm((f) => ({ ...f, permissoes: { ...f.permissoes, [mk]: { ...f.permissoes[mk], [a]: !f.permissoes[mk][a] } } }));
  const toggleModuleAll = (mk, val) => setPForm((f) => ({ ...f, permissoes: { ...f.permissoes, [mk]: Object.fromEntries(meta.acoes.map((a) => [a, val])) } }));
  const savePerfil = async () => {
    if (!pForm.nome.trim()) {
      toast.error("Nome obrigatório");
      return false;
    }
    try {
      const body = { nome: pForm.nome, admin: pForm.admin, permissoes: pForm.permissoes, ver_custos: pForm.ver_custos !== false, so_proprios: pForm.so_proprios || [], pagina_inicial: pForm.pagina_inicial || "", app_movel: Array.isArray(pForm.app_movel) ? pForm.app_movel : null, menu: pForm.menu || null, painel_ocultos: pForm.painel_ocultos ?? null, painel_ordem: pForm.painel_ordem ?? null };
      if (pEditId) await api.put(`/perfis/${pEditId}`, body);
      else await api.post("/perfis", body);
      toast.success("Perfil guardado");
      setPOpen(false);
      loadMeta();
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
      return false;
    }
  };
  savePerfilRef.current = savePerfil;
  const removePerfil = async (id) => {
    try { await api.del(`/perfis/${id}`); toast.success("Perfil eliminado"); loadMeta(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Erro ao eliminar"); }
  };

  const acaoLabel = { view: "Ver", create: "Criar", edit: "Editar", delete: "Eliminar" };
  const isAdminProfile = (p) => p.sistema && p.admin;

  const goTab = async (id) => {
    if (id === tab) return;
    if (!(await confirmLeave())) return;
    setTab(id);
  };
  const Tab = ({ id, icon: Icon, label }) => (
    <button type="button" data-testid={`gu-tab-${id}`} onClick={() => goTab(id)} className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${tab === id ? "bg-brand text-brand-fg" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}>
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Gestão de Utilizadores"
          subtitle="Faça a gestão de logins e defina perfis de acesso por módulo e ação"
          actions={
            tab === "users" ? (
              <button data-testid="new-user-btn" onClick={openNewUser} className="btn btn-primario"><Plus size={16} /> Novo Utilizador</button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {modelos.length > 0 && (
                  <select className="text-sm border border-gray-300 rounded-sm px-2 py-2 bg-white" value="" onChange={(e) => { const m = modelos.find((x) => x.id === e.target.value); if (m) criarDeModelo(m); }} data-testid="perfil-modelo">
                    <option value="">Criar a partir de um modelo…</option>
                    {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                )}
                <button data-testid="new-perfil-btn" onClick={openNewPerfil} className="btn btn-primario"><Plus size={16} /> Novo Perfil</button>
              </div>
            )
          }
        />
      }
      toolbar={
        <>
          <div className="flex items-center gap-2">
            <Tab id="users" icon={UsersIcon} label="Utilizadores" />
            <Tab id="perfis" icon={Shield} label="Perfis & Acessos" />
          </div>
          {tab === "users" && (
            <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do login, nome ou email..." testid="users-search" />
          )}
        </>
      }
      footer={
        tab === "users" ? (
          <ListPagination
            page={page}
            pages={pages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rangeLabel={rangeLabel}
            testid="users-pagination"
          />
        ) : null
      }
    >
      {tab === "users" && (
        <ScrollableTable>
          <table className="w-full text-sm min-w-[560px]">
            <thead className={TABLE_HEAD_STICKY}>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Login</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Perfil</th>
                <th className="px-4 py-3 w-32 bg-gray-50"></th>
              </tr>
            </thead>
            <tbody data-testid="users-table">
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 mono">{u.login || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{u.name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email || "—"}</td>
                  <td className="px-4 py-3">
                    {u.must_set_password ? (
                      <span className="inline-flex text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-sm px-2 py-0.5">Pendente activação</span>
                    ) : (
                      <span className="inline-flex text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-sm px-2 py-0.5">Activo</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${u.role === "admin" ? "bg-brand text-brand-fg" : "bg-gray-100 text-gray-600"}`}>
                      {u.role === "admin" ? <Shield size={12} /> : <User size={12} />} {u.perfil_nome || (u.role === "admin" ? "Administrador" : "Colaborador")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {u.totp_ativo && <button title="Repor verificação em dois passos (telemóvel perdido)" data-testid={`reset-2fa-${u.id}`} onClick={() => repor2fa(u)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><ShieldOff size={15} /></button>}
                      <button title="Gerar novo código de convite" data-testid={`reinvite-user-${u.id}`} onClick={() => reinvitar(u)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><KeyRound size={15} /></button>
                      <button data-testid={`edit-user-${u.id}`} onClick={() => openEditUser(u)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                      <button data-testid={`delete-user-${u.id}`} onClick={() => removeUser(u.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">Sem utilizadores.</td></tr>}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      {tab === "perfis" && (
        <div className="flex-1 min-h-0 overflow-auto space-y-3" data-testid="perfis-list">
          {perfis.map((p) => (
            <div key={p.id} data-testid={`perfil-card-${p.id}`} className="bg-white border border-gray-200 rounded-sm p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`h-9 w-9 rounded-sm flex items-center justify-center ${p.admin ? "bg-brand text-brand-fg" : "bg-gray-100 text-gray-600"}`}>
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
    </ListPage>

      {/* User dialog */}
      <Dialog open={uOpen} onOpenChange={setUOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{uEditId ? "Editar Utilizador" : "Novo Utilizador"}</DialogTitle>
            <DialogDescription>
              {uEditId
                ? "Actualize os dados e o perfil de acesso."
                : "O utilizador recebe um código de convite e define a própria password no primeiro acesso."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Login</label>
                <input data-testid="user-login-input" value={uForm.login} onChange={(e) => setUForm({ ...uForm, login: e.target.value })} placeholder="identificador de acesso" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
                <input data-testid="user-name-input" value={uForm.name} onChange={(e) => setUForm({ ...uForm, name: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Email</label>
                <input data-testid="user-email-input" type="email" value={uForm.email} onChange={(e) => setUForm({ ...uForm, email: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Cargo</label>
                <input data-testid="user-cargo-input" value={uForm.cargo} onChange={(e) => setUForm({ ...uForm, cargo: e.target.value })} placeholder="ex: Gestor de produção" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Perfil</label>
              <select data-testid="user-perfil-select" value={uForm.perfil_id} onChange={(e) => setUForm({ ...uForm, perfil_id: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setUOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-user-btn" onClick={saveUser} className="btn btn-primario">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite code (mostrado uma vez) */}
      <Dialog open={!!inviteInfo} onOpenChange={(o) => !o && setInviteInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Código de convite</DialogTitle>
            <DialogDescription>{inviteInfo?.message}</DialogDescription>
          </DialogHeader>
          {inviteInfo && (
            <div className="space-y-3 py-2">
              <div className="bg-gray-50 border border-gray-200 rounded-sm p-4 space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Utilizador</div>
                <div className="font-medium mono text-gray-900" data-testid="invite-login">{inviteInfo.login}</div>
                <div className="text-xs uppercase tracking-wide text-gray-500 pt-2">Código</div>
                <div className="text-2xl font-display tracking-widest text-gray-900 mono" data-testid="invite-code">{inviteInfo.invite_code}</div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
                Guarde agora — o código não volta a ser mostrado. Expira em 72 horas.
              </p>
            </div>
          )}
          <DialogFooter>
            <button onClick={copyInvite} className="btn btn-secundario"><Copy size={15} /> Copiar</button>
            <button data-testid="invite-done-btn" onClick={() => setInviteInfo(null)} className="bg-brand text-brand-fg hover:bg-brand-hover rounded-sm px-4 py-2 text-sm font-medium">Feito</button>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-sm border border-gray-200 bg-gray-50/60 p-3" data-testid="perfil-restricoes">
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input type="checkbox" className="mt-0.5" checked={pForm.ver_custos !== false} onChange={(e) => setPForm({ ...pForm, ver_custos: e.target.checked })} data-testid="perfil-ver-custos" />
                    <span>Vê custos, margens e lucros<span className="block text-xs text-gray-500">Desligado: esconde-os nas fichas e nos relatórios.</span></span>
                  </label>
                  <div className="text-sm text-gray-800">
                    Só vê o que criou / de que é responsável em:
                    <div className="flex flex-wrap gap-3 mt-1">
                      {[["crm", "CRM"], ["orcamentos", "Orçamentos"], ["encomendas", "Encomendas"]].map(([k, l]) => (
                        <label key={k} className="inline-flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={(pForm.so_proprios || []).includes(k)}
                            onChange={(e) => setPForm({ ...pForm, so_proprios: e.target.checked ? [...(pForm.so_proprios || []), k] : (pForm.so_proprios || []).filter((x) => x !== k) })} /> {l}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="text-sm text-gray-800">
                    Página inicial
                    <select className="mt-1 w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white" value={pForm.pagina_inicial || ""} onChange={(e) => setPForm({ ...pForm, pagina_inicial: e.target.value })} data-testid="perfil-pagina-inicial">
                      {[["", "Dashboard"], ["/m", "App móvel (armazém)"], ["/oficina", "Oficina (tablet)"], ["/tarefas", "Tarefas"], ["/crm", "CRM"], ["/orcamentos", "Orçamentos"], ["/encomendas", "Encomendas"], ["/ordens-fabrico", "Ordens de fabrico"], ["/calendario", "Calendário"], ["/pagamentos", "Pagamentos"], ["/ordens-compra", "Ordens de compra"], ["/relatorios", "Relatórios"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {!pForm.admin && (
                <div className="rounded-sm border border-gray-200 p-3 space-y-2" data-testid="perfil-app-movel">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium text-gray-800">App móvel</span>
                    <label className="inline-flex items-center gap-1.5"><input type="radio" checked={!Array.isArray(pForm.app_movel)} onChange={() => setPForm({ ...pForm, app_movel: null })} /> Segue as permissões dos módulos</label>
                    <label className="inline-flex items-center gap-1.5"><input type="radio" checked={Array.isArray(pForm.app_movel)} onChange={() => setPForm({ ...pForm, app_movel: MOVEL_OPS.map((o) => o.op) })} data-testid="perfil-app-movel-escolher" /> Escolher as operações</label>
                  </div>
                  {Array.isArray(pForm.app_movel) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {MOVEL_OPS.map((o) => (
                        <label key={o.op} className="inline-flex items-center gap-1.5 text-sm" title={`Precisa também de ${o.acao === "edit" ? "editar" : "ver"} em «${o.modulo}»`}>
                          <input type="checkbox" checked={pForm.app_movel.includes(o.op)} data-testid={`perfil-movel-${o.op}`}
                            onChange={(e) => setPForm({ ...pForm, app_movel: e.target.checked ? [...pForm.app_movel, o.op] : pForm.app_movel.filter((x) => x !== o.op) })} /> {o.label}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-gray-100 pt-2 mt-1 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium text-gray-800">Menu e painel predefinidos</span>
                    <button type="button" className="btn btn-secundario btn-sm" onClick={() => setMenuPerfilOpen(true)} data-testid="perfil-menu-btn">{pForm.menu ? "Editar menu do perfil" : "Definir menu do perfil"}</button>
                    {pForm.menu && <button type="button" className="text-xs underline text-gray-600" onClick={() => setPForm({ ...pForm, menu: null })}>Menu normal</button>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                    <span className="text-gray-600">Blocos do painel:</span>
                    {BLOCOS.map(([k, l]) => (
                      <label key={k} className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={!(pForm.painel_ocultos || []).includes(k)}
                          onChange={(e) => { const oc = pForm.painel_ocultos || []; setPForm({ ...pForm, painel_ocultos: e.target.checked ? oc.filter((x) => x !== k) : [...oc, k] }); }} /> {l}
                      </label>
                    ))}
                  </div>
                  <MenuEditor open={menuPerfilOpen} onOpenChange={setMenuPerfilOpen} titulo={`Menu predefinido — ${pForm.nome || "perfil"}`}
                    base={NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly) }))} menu={pForm.menu}
                    guardarEm={async (v) => v} onGuardado={(v) => setPForm((f) => ({ ...f, menu: v }))} />
                  <p className="text-xs text-gray-500">Cada operação precisa também da permissão do módulo (ex.: Receções → editar Ordens de compra). Para operadores que só usam o telemóvel, escolha a página inicial «App móvel».</p>
                </div>
              )}
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
            <button data-testid="save-perfil-btn" onClick={savePerfil} className="btn btn-primario">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
