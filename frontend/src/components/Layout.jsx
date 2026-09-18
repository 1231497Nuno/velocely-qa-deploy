import { useState, useEffect, useMemo } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, setCurrency } from "@/lib/api";
import GlobalSearch from "@/components/GlobalSearch";
import NotificationsBell from "@/components/NotificationsBell";
import MiniCalendarButton from "@/components/MiniCalendarButton";
import UserAvatarMenu from "@/components/UserAvatarMenu";
import {
  LayoutDashboard,
  Boxes,
  Cog,
  Palette,
  FileText,
  Factory,
  Users,
  LineChart,
  Menu,
  X,
  Search,
  Shield,
  LogOut,
  Contact,
  Truck,
  ClipboardList,
  Settings,
  CalendarClock,
  PiggyBank,
  History,
  Layers,
  ChevronDown,
  Wallet,
  ShoppingCart,
  FileQuestion,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";

const NAV_GROUPS = [
  {
    id: "operacoes",
    label: "Operações",
    items: [
      { to: "/orcamentos", label: "Orçamentos", icon: FileText, tid: "nav-orcamentos", modulo: "orcamentos" },
      { to: "/encomendas", label: "Encomendas", icon: ClipboardList, tid: "nav-encomendas", modulo: "encomendas" },
      { to: "/pedidos-cotacao", label: "Pedidos de Cotação", icon: FileQuestion, tid: "nav-pedidos-cotacao", modulo: "pedidos_cotacao" },
      { to: "/ordens-compra", label: "Ordens de Compra", icon: ShoppingCart, tid: "nav-ordens-compra", modulo: "ordens_compra" },
      { to: "/ordens-fabrico", label: "Ordens de Fabrico", icon: Factory, tid: "nav-ofs", modulo: "ordens_fabrico" },
      { to: "/nao-conformidades", label: "Não conformidades", icon: AlertTriangle, tid: "nav-nc", modulo: "nao_conformidades" },
      { to: "/calendario", label: "Calendário", icon: CalendarClock, tid: "nav-calendario", modulo: "calendario" },
      { to: "/analise-producao", label: "Análise da Produção", icon: LineChart, tid: "nav-analise-producao", modulo: "analise_producao" },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo",
    items: [
      { to: "/artigos", label: "Artigos", icon: Boxes, tid: "nav-artigos", modulo: "artigos" },
      { to: "/categorias", label: "Categorias", icon: Layers, tid: "nav-categorias", modulo: "artigos" },
      { to: "/maquinas", label: "Máquinas", icon: Cog, tid: "nav-maquinas", modulo: "maquinas" },
      { to: "/mao-obra", label: "Mão de Obra", icon: Users, tid: "nav-mao-obra", modulo: "mao_obra" },
      { to: "/personalizacao", label: "Tipos de Personalização", icon: Palette, tid: "nav-personalizacao", modulo: "personalizacao" },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    items: [
      { to: "/clientes", label: "Clientes", icon: Contact, tid: "nav-clientes", modulo: "clientes" },
      { to: "/fornecedores", label: "Fornecedores", icon: Truck, tid: "nav-fornecedores", modulo: "fornecedores" },
      { to: "/rentabilidade-clientes", label: "Rentabilidade por Cliente", icon: PiggyBank, tid: "nav-rentabilidade", modulo: "rentabilidade" },
    ],
  },
  {
    id: "financeiro",
    label: "Faturas e recibos",
    items: [
      { to: "/financeiro", label: "Faturas / Recibos", icon: Wallet, tid: "nav-financeiro", modulo: "financeiro" },
    ],
  },
  {
    id: "contas",
    label: "Contas a pagar e a receber",
    items: [
      { to: "/contas?tipo=receber", label: "A receber", icon: ArrowDownLeft, tid: "nav-contas-receber", modulo: "contas", matchTipo: "receber" },
      { to: "/contas?tipo=pagar", label: "A pagar", icon: ArrowUpRight, tid: "nav-contas-pagar", modulo: "contas", matchTipo: "pagar" },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    items: [
      { to: "/historico", label: "Histórico", icon: History, tid: "nav-historico", modulo: "historico" },
      { to: "/definicoes", label: "Definições", icon: Settings, tid: "nav-definicoes", modulo: "definicoes" },
      { to: "/utilizadores", label: "Gestão de Utilizadores", icon: Shield, tid: "nav-utilizadores", adminOnly: true },
    ],
  },
];

const DASHBOARD_ITEM = {
  to: "/",
  label: "Dashboard",
  icon: LayoutDashboard,
  end: true,
  tid: "nav-dashboard",
  modulo: "dashboard",
};

function navPath(to) {
  return (to || "").split("?")[0];
}

function pathInGroup(pathname, items) {
  return items.some((n) => {
    const path = navPath(n.to);
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  });
}

function linkIsActive(n, location) {
  const path = navPath(n.to);
  if (n.end) return location.pathname === path;
  if (n.matchTipo) {
    if (location.pathname !== path) return false;
    const tipo = new URLSearchParams(location.search).get("tipo") || "receber";
    return tipo === n.matchTipo;
  }
  return location.pathname === path || location.pathname.startsWith(`${path}/`);
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertas, setAlertas] = useState({});
  const [expanded, setExpanded] = useState({});
  const { user, isAdmin, can, logout } = useAuth();
  const location = useLocation();

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

  const groups = useMemo(() => {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((n) => {
        if (n.adminOnly) return isAdmin;
        if (n.modulo === "dashboard") return true;
        return can(n.modulo, "view");
      }),
    })).filter((g) => g.items.length > 0);
  }, [isAdmin, can]);

  // Garantir que o grupo da página actual fica aberto
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      groups.forEach((g) => {
        if (pathInGroup(location.pathname, g.items)) next[g.id] = true;
      });
      return next;
    });
  }, [location.pathname, groups]);

  const toggleGroup = (id) => {
    setExpanded((prev) => {
      const currentlyOpen = prev[id] !== false;
      return { ...prev, [id]: !currentlyOpen };
    });
  };

  const renderLink = (n) => (
    <NavLink
      key={n.tid || n.to}
      to={n.to}
      end={n.end}
      data-testid={n.tid}
      onClick={() => setOpen(false)}
      className={() =>
        `flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
          linkIsActive(n, location)
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`
      }
    >
      <n.icon size={17} strokeWidth={1.8} />
      <span className="flex-1 truncate">{n.label}</span>
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
  );

  return (
    <div className="min-h-screen flex bg-[#F8F9FA]">
      <header className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-gray-200 z-30 flex items-center justify-between px-4">
        <Link to="/" data-testid="mobile-logo-link">
          <img src="/logo-full.png" alt="Velocely" className="h-7 w-auto max-w-[10.5rem] object-contain object-left" />
        </Link>
        <div className="flex items-center gap-1">
          <MiniCalendarButton />
          <NotificationsBell />
          <UserAvatarMenu />
          <button
            data-testid="mobile-search-toggle"
            onClick={() => setSearchOpen((v) => !v)}
            className="p-2 rounded-sm text-gray-700 hover:bg-gray-100"
            aria-label="Pesquisar"
          >
            <Search size={22} />
          </button>
          <button
            data-testid="mobile-menu-toggle"
            onClick={() => setOpen(true)}
            className="p-2 -mr-2 rounded-sm text-gray-700 hover:bg-gray-100"
            aria-label="Abrir menu"
          >
            <Menu size={24} />
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="lg:hidden fixed top-14 inset-x-0 z-30 bg-white border-b border-gray-200 p-3" data-testid="mobile-search-bar">
          <GlobalSearch onNavigate={() => setSearchOpen(false)} />
        </div>
      )}

      {open && (
        <div
          data-testid="mobile-menu-overlay"
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
        />
      )}

      <aside
        className={`w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col fixed h-screen z-50 transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between">
          <div>
            <Link to="/" data-testid="sidebar-logo-link" onClick={() => setOpen(false)}>
              <img src="/logo-full.png" alt="Velocely" className="h-8 w-auto max-w-[11.5rem] object-contain object-left" />
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

        <nav className="flex-1 p-3 overflow-y-auto space-y-3" data-testid="sidebar-nav">
          <div className="space-y-0.5 mb-1">
            {renderLink(DASHBOARD_ITEM)}
          </div>
          {groups.map((g) => {
            const openGroup = expanded[g.id] !== false;
            return (
              <div key={g.id} data-testid={`nav-group-${g.id}`}>
                <button
                  type="button"
                  data-testid={`nav-group-toggle-${g.id}`}
                  onClick={() => toggleGroup(g.id)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <span>{g.label}</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${openGroup ? "" : "-rotate-90"}`}
                  />
                </button>
                {openGroup && (
                  <div className="mt-0.5 space-y-0.5">
                    {g.items.map(renderLink)}
                  </div>
                )}
              </div>
            );
          })}
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

      <main className="flex-1 lg:ml-64 min-w-0 pt-14 lg:pt-0">
        <div className="hidden lg:flex sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-200 h-14 items-center gap-4 px-8" data-testid="top-bar">
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <MiniCalendarButton />
            <NotificationsBell />
            <UserAvatarMenu />
          </div>
        </div>
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, className = "" }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 ${className}`}>
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
