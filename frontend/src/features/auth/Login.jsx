import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { LogIn } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bg, setBg] = useState("");

  useEffect(() => {
    api.get("/branding").then((d) => setBg(d?.login_bg_base64 || "")).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(loginId, password);
      nav("/");
    } catch (err) {
      const d = err?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Não foi possível iniciar sessão.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative bg-[#0A0A0A]"
      style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {bg && <div className="absolute inset-0 bg-black/45" />}
      <div className="w-full max-w-md relative z-10">
        <div className="flex justify-center mb-8">
          <img src="https://customer-assets.emergentagent.com/job_budgeting-orders/artifacts/qckzlidl_Logotipo.png" alt="Velocely" className="h-14 w-auto" />
        </div>
        <form onSubmit={submit} data-testid="login-form" className="bg-white rounded-sm p-7 sm:p-8 space-y-5">
          <div>
            <h1 className="text-xl font-bold font-display text-gray-900">Iniciar sessão</h1>
            <p className="text-sm text-gray-500 mt-1">Aceda à plataforma de orçamentos e fabrico.</p>
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
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Password</label>
            <input
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
            />
          </div>
          {error && <div data-testid="login-error" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
          <button
            data-testid="login-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            <LogIn size={16} /> {loading ? "A entrar..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
