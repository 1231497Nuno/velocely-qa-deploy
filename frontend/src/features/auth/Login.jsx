import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { LogIn } from "lucide-react";

export default function Login() {
  const { login, user, ready } = useAuth();
  const nav = useNavigate();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bg, setBg] = useState("");

  // forgot password: idle | code | set
  const [mode, setMode] = useState("login");
  const [forgotId, setForgotId] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [info, setInfo] = useState("");
  const [forgotBusy, setForgotBusy] = useState(null); // 'send' | 'verify' | 'save' | null

  useEffect(() => {
    api.get("/branding").then((d) => setBg(d?.login_bg_base64 || "")).catch(() => {});
  }, []);

  useEffect(() => {
    if (ready && user) nav("/", { replace: true });
  }, [ready, user, nav]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(loginId, password);
      if (result.must_set_password) {
        nav("/definir-password");
      } else {
        nav("/");
      }
    } catch (err) {
      const d = err?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Não foi possível iniciar sessão.");
    } finally {
      setLoading(false);
    }
  };

  const openForgot = () => {
    setMode("code");
    setForgotId(loginId);
    setCode("");
    setCodeSent(false);
    setNewPass("");
    setNewPass2("");
    setResetToken("");
    setError("");
    setInfo("");
    setResendIn(0);
    setForgotBusy(null);
  };

  const sendForgotCode = async () => {
    if (!forgotId.trim()) return setError("Indique o utilizador ou email");
    if (forgotBusy || resendIn > 0) return;
    setError("");
    setInfo("");
    setForgotBusy("send");
    try {
      const res = await api.post("/auth/password/forgot/request", { login: forgotId.trim() });
      setCodeSent(true);
      setEmailHint(res.email_masked || "");
      setResendIn(Math.max(1, Number(res.resend_after_sec) || 60));
      setInfo(res.message || (res.email_masked ? `Enviámos um código para ${res.email_masked}.` : "Código enviado."));
    } catch (err) {
      const status = err?.response?.status;
      const d = err?.response?.data?.detail;
      if (status === 429) {
        const wait = typeof d === "object" && d?.resend_after_sec
          ? Number(d.resend_after_sec)
          : Number(String(typeof d === "string" ? d : d?.message || "").match(/(\d+)\s*s/)?.[1]) || 60;
        setResendIn(Math.max(1, wait));
        setInfo(typeof d === "object" && d?.message ? d.message : (typeof d === "string" ? d : `Aguarde ${wait}s para reenviar`));
      } else {
        setError(typeof d === "string" ? d : (d?.message || "Não foi possível enviar o código"));
      }
    } finally {
      setForgotBusy(null);
    }
  };

  const verifyForgotCode = async () => {
    if (!code.trim()) return setError("Indique o código");
    if (forgotBusy) return;
    setError("");
    setForgotBusy("verify");
    try {
      const res = await api.post("/auth/password/forgot/verify-code", {
        login: forgotId.trim(),
        code: code.trim(),
      });
      setResetToken(res.reset_token);
      setMode("set");
      setInfo("Código validado. Defina a nova password.");
    } catch (err) {
      const d = err?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Código inválido");
    } finally {
      setForgotBusy(null);
    }
  };

  const saveForgotPassword = async () => {
    if (!newPass || newPass !== newPass2) return setError("As passwords não coincidem");
    if (forgotBusy) return;
    setError("");
    setForgotBusy("save");
    try {
      await api.post("/auth/password/reset", {
        reset_token: resetToken,
        password: newPass,
        password_confirm: newPass2,
      });
      setMode("login");
      setLoginId(forgotId);
      setPassword("");
      setInfo("Password actualizada. Pode iniciar sessão.");
      setForgotBusy(null);
    } catch (err) {
      const d = err?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Não foi possível alterar a password");
      setForgotBusy(null);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        backgroundImage: `url(${bg || "/login-bg.jpg"})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Legibilidade: vinheta suave + leve tom da marca */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg, rgba(8,24,36,0.55) 0%, rgba(10,40,45,0.45) 45%, rgba(6,20,28,0.62) 100%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.35)_100%)]" />

      <div className="w-full max-w-md relative z-10 bg-white rounded-sm shadow-xl shadow-black/25 overflow-hidden">
        <div className="flex items-center justify-center px-7 pt-7 pb-5 border-b border-gray-100">
          <img src="/logo-full.png" alt="Velocely" className="h-10 w-auto" />
        </div>

        {mode === "login" && (
          <form onSubmit={submit} data-testid="login-form" className="p-7 sm:p-8 space-y-5">
            <div>
              <h1 className="text-xl font-bold font-display text-gray-900">Iniciar sessão</h1>
              <p className="text-sm text-gray-500 mt-1">
                Conta nova: utilizador e código de convite. Conta activa: password habitual.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Utilizador</label>
              <input
                data-testid="login-email"
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                autoFocus
                placeholder="o seu utilizador"
                className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Password ou código de convite</label>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password ou ABCD-1234"
                className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            {info && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-sm px-3 py-2">{info}</div>}
            {error && <div data-testid="login-error" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
            <button
              data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              <LogIn size={16} /> {loading ? "A entrar..." : "Entrar"}
            </button>
            <button type="button" data-testid="forgot-password-link" onClick={openForgot} className="w-full text-center text-sm text-gray-500 hover:text-gray-800">
              Esqueci a password
            </button>
          </form>
        )}

        {mode === "code" && (
          <div data-testid="forgot-code-form" className="p-7 sm:p-8 space-y-5">
            <div>
              <h1 className="text-xl font-bold font-display text-gray-900">Recuperar password</h1>
              <p className="text-sm text-gray-500 mt-1">Enviamos um código para o email da conta. Depois define a nova password.</p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Utilizador ou email</label>
              <input
                data-testid="forgot-login"
                type="text"
                value={forgotId}
                onChange={(e) => {
                  setForgotId(e.target.value);
                  setError("");
                }}
                className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            <button
              type="button"
              data-testid="forgot-send-code"
              disabled={!!forgotBusy || resendIn > 0}
              onClick={sendForgotCode}
              className="w-full bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium disabled:opacity-60 disabled:pointer-events-none disabled:cursor-not-allowed"
            >
              {forgotBusy === "send" ? "A enviar..." : resendIn > 0 ? `Reenviar em ${resendIn}s` : codeSent ? "Reenviar código" : "Enviar código para o email"}
            </button>
            {info && (
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-sm px-3 py-2">
                {info}
              </div>
            )}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>
            )}
            {codeSent && (
              <>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Código do email</label>
                  <input
                    data-testid="forgot-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6 dígitos"
                    className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm mono tracking-widest focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                    disabled={!!forgotBusy}
                  />
                </div>
                <button
                  type="button"
                  data-testid="forgot-verify-code"
                  disabled={!!forgotBusy}
                  onClick={verifyForgotCode}
                  className="w-full bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium disabled:opacity-60 disabled:pointer-events-none disabled:cursor-not-allowed"
                >
                  {forgotBusy === "verify" ? "A validar..." : "Validar código"}
                </button>
              </>
            )}
            <button type="button" disabled={!!forgotBusy} onClick={() => { setMode("login"); setError(""); setInfo(""); setResendIn(0); setForgotBusy(null); }} className="w-full text-center text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50">
              Voltar ao login
            </button>
          </div>
        )}

        {mode === "set" && (
          <div data-testid="forgot-set-form" className="p-7 sm:p-8 space-y-5">
            <div>
              <h1 className="text-xl font-bold font-display text-gray-900">Nova password</h1>
              <p className="text-sm text-gray-500 mt-1">Código validado. Escolha a nova password (mín. 8 caracteres, letra e número).</p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Nova password</label>
              <input
                data-testid="forgot-password"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Confirmar</label>
              <input
                data-testid="forgot-password-confirm"
                type="password"
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
            <button
              type="button"
              data-testid="forgot-save-password"
              disabled={!!forgotBusy}
              onClick={saveForgotPassword}
              className="w-full bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium disabled:opacity-60 disabled:pointer-events-none"
            >
              {forgotBusy === "save" ? "A guardar..." : "Guardar password"}
            </button>
            <button type="button" disabled={!!forgotBusy} onClick={() => { setMode("login"); setError(""); setForgotBusy(null); }} className="w-full text-center text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50">
              Voltar ao login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
