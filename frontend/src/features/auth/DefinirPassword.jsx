import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { getActivationToken } from "@/lib/api";
import { KeyRound } from "lucide-react";

export default function DefinirPassword() {
  const { setPassword, user } = useAuth();
  const nav = useNavigate();
  const [password, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      nav("/", { replace: true });
      return;
    }
    if (!getActivationToken()) {
      nav("/login", { replace: true });
    }
  }, [user, nav]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("As passwords não coincidem");
      return;
    }
    setLoading(true);
    try {
      await setPassword(password, confirm);
      nav("/", { replace: true });
    } catch (err) {
      const d = err?.response?.data?.detail || err?.message;
      setError(typeof d === "string" ? d : "Não foi possível definir a password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        backgroundImage: "url(/login-bg.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg, rgba(8,24,36,0.55) 0%, rgba(10,40,45,0.45) 45%, rgba(6,20,28,0.62) 100%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.35)_100%)]" />
      <div className="w-full max-w-md relative z-10 bg-white rounded-sm shadow-xl shadow-black/25 overflow-hidden">
        <div className="flex items-center justify-center gap-3 px-7 pt-7 pb-5 border-b border-gray-100">
          <img src="/logo.png" alt="Velocely" className="h-10 w-auto" />
          <span className="text-gray-900 text-[1.65rem] font-bold tracking-wide font-display lowercase">
            velocely
          </span>
        </div>
        <form onSubmit={submit} data-testid="set-password-form" className="p-7 sm:p-8 space-y-5">
          <div>
            <h1 className="text-xl font-bold font-display text-gray-900">Definir password</h1>
            <p className="text-sm text-gray-500 mt-1">
              Crie a sua password (mín. 8 caracteres, com letra e número). Depois use-a em todos os acessos.
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Nova password</label>
            <input
              data-testid="set-password-input"
              type="password"
              value={password}
              onChange={(e) => setPwd(e.target.value)}
              autoFocus
              className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Confirmar password</label>
            <input
              data-testid="set-password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
            />
          </div>
          {error && <div data-testid="set-password-error" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
          <button
            data-testid="set-password-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            <KeyRound size={16} /> {loading ? "A guardar..." : "Guardar e entrar"}
          </button>
          <p className="text-center text-xs text-gray-500">
            <Link to="/login" className="underline hover:text-gray-800">Voltar ao login</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
