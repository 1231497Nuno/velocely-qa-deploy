import { useState, useEffect } from "react";
import { NavLink, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, setCurrency } from "@/lib/api";
import {
  LayoutDashboard,
  Boxes,
  Cog,
  Palette,
  FileText,
  Factory,
  Package,
  Users,
  LineChart,
  Menu,
  X,
  Shield,
  LogOut,
  Contact,
  ClipboardList,
  Settings,
  CalendarClock,
  PiggyBank,
  History,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, tid: "nav-dashboard", modulo: "dashboard" },
  { to: "/calendario", label: "Calendário", icon: CalendarClock, tid: "nav-calendario", modulo: "dashboard" },
  { to: "/clientes", label: "Clientes", icon: Contact, tid: "nav-clientes", modulo: "clientes" },
  { to: "/artigos", label: "Artigos", icon: Boxes, tid: "nav-artigos", modulo: "artigos" },
  { to: "/materiais", label: "Materiais", icon: Package, tid: "nav-materiais", modulo: "materiais" },
  { to: "/maquinas", label: "Máquinas", icon: Cog, tid: "nav-maquinas", modulo: "maquinas" },
  { to: "/mao-obra", label: "Mão de Obra", icon: Users, tid: "nav-mao-obra", modulo: "mao_obra" },
  { to: "/personalizacao", label: "Tipos de Personalização", icon: Palette, tid: "nav-personalizacao", modulo: "personalizacao" },
  { to: "/orcamentos", label: "Orçamentos", icon: FileText, tid: "nav-orcamentos", modulo: "orcamentos" },
  { to: "/encomendas", label: "Encomendas", icon: ClipboardList, tid: "nav-encomendas", modulo: "encomendas" },
  { to: "/ordens-fabrico", label: "Ordens de Fabrico", icon: Factory, tid: "nav-ofs", modulo: "ordens_fabrico" },
  { to: "/analise-producao", label: "Análise da Produção", icon: LineChart, tid: "nav-analise-producao", modulo: "analise_producao" },
  { to: "/rentabilidade-clientes", label: "Rentabilidade por Cliente", icon: PiggyBank, tid: "nav-rentabilidade", modulo: "analise_producao" },
];

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const [alertas, setAlertas] = useState({});
  const { user, isAdmin, can, logout } = useAuth();

  useEffect(() => {
    api.get("/settings/empresa").then((s) => setCurrency(s?.moeda_simbolo)).catch(() => {});
    let active = true;
    const fetchA = () => api.get("/alertas").then((a) => active && setAlertas(a || {})).catch(() => {});
    fetchA();
    const t = setInterval(fetchA, 60000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const badgeFor = (to) => {
    if (to === "/calendario") {
      const atr = alertas.prazos_atrasados || 0;
      if (atr > 0) return { n: atr, red: true };
      const prox = alertas.prazos_proximos || 0;
      return prox > 0 ? { n: prox, red: false } : null;
    }
    if (to === "/encomendas") {
      const n = alertas.pagamentos_pendentes || 0;
      return n > 0 ? { n, red: false } : null;
    }
    if (to === "/ordens-fabrico") {
      const n = alertas.ofs_atrasadas || 0;
      return n > 0 ? { n, red: true } : null;
    }
    return null;
  };

  const visible = NAV.filter((n) => n.modulo === "dashboard" || can(n.modulo, "view"));
  const nav = isAdmin
    ? [...visible,
        { to: "/utilizadores", label: "Gestão de Utilizadores", icon: Shield, tid: "nav-utilizadores" },
        { to: "/historico", label: "Histórico", icon: History, tid: "nav-historico" },
        { to: "/definicoes", label: "Definições", icon: Settings, tid: "nav-definicoes" }]
    : visible;

  return (
    <div className="min-h-screen flex bg-[#F8F9FA]">
      {/* Top bar (mobile) */}
      <header className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-gray-200 z-30 flex items-center justify-between px-4">
        <Link to="/" data-testid="mobile-logo-link">
          <img src="https://customer-assets.emergentagent.com/job_budgeting-orders/artifacts/qckzlidl_Logotipo.png" alt="Velocely" className="h-7 w-auto" />
        </Link>
        <button
          data-testid="mobile-menu-toggle"
          onClick={() => setOpen(true)}
          className="p-2 -mr-2 rounded-sm text-gray-700 hover:bg-gray-100"
          aria-label="Abrir menu"
        >
          <Menu size={24} />
        </button>
      </header>

      {/* Overlay (mobile) */}
      {open && (
        <div
          data-testid="mobile-menu-overlay"
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col fixed h-screen z-50 transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between">
          <div>
            <Link to="/" data-testid="sidebar-logo-link" onClick={() => setOpen(false)}>
              <img src="https://customer-assets.emergentagent.com/job_budgeting-orders/artifacts/qckzlidl_Logotipo.png" alt="Velocely" className="h-8 w-auto" />
            </Link>
            <div className="text-xs text-gray-500 mt-1.5">Gestão de Produção</div>
          </div>
          <button
            data-testid="mobile-menu-close"
            onClick={() => setOpen(false)}
            className="lg:hidden p-1.5 -mr-2 rounded-sm text-gray-500 hover:bg-gray-100"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.tid}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`
              }
            >
              <n.icon size={18} strokeWidth={1.8} />
              <span className="flex-1">{n.label}</span>
              {(() => {
                const b = badgeFor(n.to);
                return b ? (
                  <span
                    data-testid={`nav-badge-${n.tid}`}
                    className={`text-[10px] font-bold tabular-nums rounded-full min-w-[18px] text-center px-1.5 py-0.5 ${b.red ? "bg-red-500 text-white" : "bg-amber-400 text-gray-900"}`}
                  >
                    {b.n}
                  </span>
                ) : null;
              })()}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3">
          {user && (
            <div className="px-2 py-1.5 mb-1" data-testid="current-user">
              <div className="text-sm font-medium text-gray-900 truncate">{user.name || user.email}</div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                {isAdmin ? <Shield size={11} /> : <Users size={11} />}
                {isAdmin ? "Administrador" : "Colaborador"}
              </div>
            </div>
          )}
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut size={18} strokeWidth={1.8} /> Terminar sessão
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 lg:ml-64 min-w-0 pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 font-display">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

