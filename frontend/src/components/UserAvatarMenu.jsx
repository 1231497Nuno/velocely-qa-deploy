import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, API, getToken } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

function initials(user) {
  const n = (user?.name || user?.login || user?.email || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function avatarSrc(path) {
  if (!path) return "";
  return `${API}/files/${path}?auth=${getToken()}`;
}

export default function UserAvatarMenu() {
  const { user, logout, refresh } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pwBusy, setPwBusy] = useState(null); // 'send' | 'verify' | 'save' | null
  // idle | code_sent | code_ok
  const [pwStep, setPwStep] = useState("idle");
  const [emailHint, setEmailHint] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [resetToken, setResetToken] = useState("");
  const [form, setForm] = useState({
    name: "", telefone: "", email: "", cargo: "", avatar: "",
    code: "", password: "", password_confirm: "",
  });
  const boxRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const openAccount = () => {
    setMenuOpen(false);
    setPwStep("idle");
    setEmailHint("");
    setResetToken("");
    setResendIn(0);
    setForm({
      name: user.name || "",
      telefone: user.telefone || "",
      email: user.email || "",
      cargo: user.cargo || "",
      avatar: user.avatar || "",
      code: "",
      password: "",
      password_confirm: "",
    });
    setAccountOpen(true);
  };

  if (!user) return null;

  const onPick = () => fileRef.current?.click();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Imagem demasiado grande (máx. 5 MB)");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(`${API}/upload/imagem`, fd, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setForm((f) => ({ ...f, avatar: data.path }));
      toast.success("Fotografia carregada — guarde para confirmar");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Falha ao carregar fotografia");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    try {
      await api.put("/auth/me", {
        name: form.name.trim(),
        telefone: form.telefone.trim(),
        email: form.email.trim(),
        cargo: form.cargo.trim(),
        avatar: form.avatar || "",
      });
      await refresh();
      toast.success("Conta actualizada");
      setAccountOpen(false);
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const sendCode = async () => {
    if (!form.email.trim()) return toast.error("Defina um email na conta para receber o código");
    if (pwBusy) return;
    setPwBusy("send");
    try {
      if (form.email.trim() !== (user.email || "")) {
        await api.put("/auth/me", { email: form.email.trim() });
        await refresh();
      }
      const res = await api.post("/auth/me/password/request-code");
      setPwStep("code_sent");
      setEmailHint(res.email_masked || form.email);
      setResendIn(res.resend_after_sec || 60);
      toast.success(res.message || "Código enviado");
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível enviar o código");
    } finally {
      setPwBusy(null);
    }
  };

  const verifyCode = async () => {
    if (!form.code.trim()) return toast.error("Indique o código do email");
    if (pwBusy) return;
    setPwBusy("verify");
    try {
      const res = await api.post("/auth/me/password/verify-code", { code: form.code.trim() });
      setResetToken(res.reset_token);
      setPwStep("code_ok");
      toast.success("Código validado — defina a nova password");
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Código inválido");
    } finally {
      setPwBusy(null);
    }
  };

  const setNewPassword = async () => {
    if (!form.password || form.password !== form.password_confirm) {
      return toast.error("As passwords não coincidem");
    }
    if (pwBusy) return;
    setPwBusy("save");
    try {
      await api.post("/auth/password/reset", {
        reset_token: resetToken,
        password: form.password,
        password_confirm: form.password_confirm,
      });
      toast.success("Password actualizada");
      setPwStep("idle");
      setResetToken("");
      setForm((f) => ({ ...f, code: "", password: "", password_confirm: "" }));
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível alterar a password");
    } finally {
      setPwBusy(null);
    }
  };

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="relative" ref={boxRef} data-testid="user-avatar-menu">
      <button
        type="button"
        data-testid="user-avatar-btn"
        onClick={() => setMenuOpen((o) => !o)}
        className="rounded-full ring-offset-2 hover:ring-2 hover:ring-gray-200 transition-shadow"
        aria-label="Perfil"
      >
        <Avatar className="h-8 w-8">
          <AvatarImage src={avatarSrc(user.avatar)} alt={user.name || user.login} />
          <AvatarFallback className="bg-gray-900 text-white text-xs font-semibold">
            {initials(user)}
          </AvatarFallback>
        </Avatar>
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-50 mt-1 w-56 bg-white border border-gray-200 rounded-sm shadow-lg overflow-hidden" data-testid="user-avatar-panel">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-medium text-gray-900 truncate">{user.name || user.login}</div>
            <div className="text-xs text-gray-500 truncate">{user.email || user.login}</div>
          </div>
          <button type="button" data-testid="user-account-btn" onClick={openAccount} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
            <UserRound size={15} /> Informações de conta
          </button>
          <button type="button" data-testid="user-avatar-logout" onClick={logout} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-100">
            <LogOut size={15} /> Terminar sessão
          </button>
        </div>
      )}

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Informações de conta</DialogTitle>
            <DialogDescription>Actualize os seus dados. A password altera-se com código enviado por email.</DialogDescription>
          </DialogHeader>

          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onFile} />

          <div className="space-y-4 py-1">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={avatarSrc(form.avatar)} alt="" />
                <AvatarFallback className="bg-gray-900 text-white text-lg font-semibold">{initials(form)}</AvatarFallback>
              </Avatar>
              <div className="space-y-1.5">
                <button type="button" data-testid="account-avatar-upload" disabled={uploading} onClick={onPick} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 disabled:opacity-60">
                  <Camera size={13} /> {uploading ? "A carregar..." : "Alterar foto"}
                </button>
                {form.avatar && (
                  <button type="button" onClick={() => upd("avatar", "")} className="block text-xs text-gray-500 hover:text-red-600">Remover foto</button>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="account-name" value={form.name} onChange={(e) => upd("name", e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Número de telefone</label>
              <input data-testid="account-telefone" type="tel" value={form.telefone} onChange={(e) => upd("telefone", e.target.value)} placeholder="+351 9xx xxx xxx" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Email</label>
              <input data-testid="account-email" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Cargo</label>
              <input data-testid="account-cargo" value={form.cargo} onChange={(e) => upd("cargo", e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-3">
              <p className="text-sm font-medium text-gray-800">Alterar password</p>

              {pwStep === "idle" && (
                <button type="button" data-testid="account-send-code" disabled={!!pwBusy} onClick={sendCode} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-60 disabled:pointer-events-none">
                  {pwBusy === "send" ? "A enviar..." : "Enviar código para o email"}
                </button>
              )}

              {pwStep === "code_sent" && (
                <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-sm p-3">
                  <p className="text-xs text-gray-600">Enviámos um código para <span className="font-medium">{emailHint}</span>. Introduza-o abaixo.</p>
                  <input data-testid="account-code" value={form.code} onChange={(e) => upd("code", e.target.value)} placeholder="Código de 6 dígitos" disabled={!!pwBusy} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm mono tracking-widest focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:opacity-60" />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" data-testid="account-verify-code" disabled={!!pwBusy} onClick={verifyCode} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-60 disabled:pointer-events-none">
                      {pwBusy === "verify" ? "A validar..." : "Validar código"}
                    </button>
                    <button type="button" disabled={!!pwBusy || resendIn > 0} onClick={sendCode} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 disabled:pointer-events-none">
                      {pwBusy === "send" ? "A enviar..." : resendIn > 0 ? `Reenviar em ${resendIn}s` : "Reenviar código"}
                    </button>
                  </div>
                </div>
              )}

              {pwStep === "code_ok" && (
                <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-sm p-3">
                  <p className="text-xs text-gray-600">Código validado. Defina a nova password.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nova password</label>
                      <input data-testid="account-password" type="password" value={form.password} onChange={(e) => upd("password", e.target.value)} disabled={!!pwBusy} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:opacity-60" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1.5 block">Confirmar</label>
                      <input data-testid="account-password-confirm" type="password" value={form.password_confirm} onChange={(e) => upd("password_confirm", e.target.value)} disabled={!!pwBusy} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:opacity-60" />
                    </div>
                  </div>
                  <button type="button" data-testid="account-set-password" disabled={!!pwBusy} onClick={setNewPassword} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-60 disabled:pointer-events-none">
                    {pwBusy === "save" ? "A guardar..." : "Guardar nova password"}
                  </button>
                </div>
              )}
            </div>

            {user.perfil?.nome && (
              <p className="text-xs text-gray-400">Perfil: {user.perfil.nome} (definido pelo administrador)</p>
            )}
          </div>

          <DialogFooter>
            <button type="button" onClick={() => setAccountOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button type="button" data-testid="account-save-btn" disabled={saving} onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-60">
              {saving ? "A guardar..." : "Guardar dados"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
