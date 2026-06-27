import { NavLink } from "react-router-dom";
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
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, tid: "nav-dashboard" },
  { to: "/artigos", label: "Artigos", icon: Boxes, tid: "nav-artigos" },
  { to: "/materiais", label: "Materiais", icon: Package, tid: "nav-materiais" },
  { to: "/maquinas", label: "Máquinas", icon: Cog, tid: "nav-maquinas" },
  { to: "/mao-obra", label: "Mão de Obra", icon: Users, tid: "nav-mao-obra" },
  { to: "/personalizacao", label: "Tipos de Personalização", icon: Palette, tid: "nav-personalizacao" },
  { to: "/orcamentos", label: "Orçamentos", icon: FileText, tid: "nav-orcamentos" },
  { to: "/ordens-fabrico", label: "Ordens de Fabrico", icon: Factory, tid: "nav-ofs" },
  { to: "/analise-producao", label: "Análise da Produção", icon: LineChart, tid: "nav-analise-producao" },
];

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex bg-[#F8F9FA]">
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col fixed h-screen">
        <div className="px-6 py-5 border-b border-gray-200">
          <div className="font-display font-extrabold text-lg tracking-tight text-gray-900 leading-tight">
            Gestão <span className="text-gray-400">Produção</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Orçamentos & Fabrico</div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.tid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`
              }
            >
              <n.icon size={18} strokeWidth={1.8} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-gray-200 text-xs text-gray-400">
          v2.0 · Fase 2/3
        </div>
      </aside>
      <main className="flex-1 ml-64 min-w-0">
        <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 font-display">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
