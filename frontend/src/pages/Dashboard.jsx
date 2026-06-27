import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, eur } from "../lib/api";
import { PageHeader } from "../components/Layout";
import {
  Boxes, FileText, Factory, TrendingUp, CheckCircle2, Hammer, Coins, Clock,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

const INK = "#111827";
const PALETTE = {
  rascunho: "#9CA3AF", enviado: "#6366F1", aceite: "#059669", rejeitado: "#DC2626",
  pendente: "#D97706", em_producao: "#2563EB", concluido: "#059669",
};

const Stat = ({ icon: Icon, label, value, sub, tid }) => (
  <div data-testid={tid} className="bg-white border border-gray-200 rounded-sm p-5 flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">{label}</span>
      <Icon size={18} className="text-gray-400" strokeWidth={1.8} />
    </div>
    <div className="text-3xl font-bold tracking-tight tabular-nums font-display text-gray-900">{value}</div>
    {sub && <div className="text-xs text-gray-500">{sub}</div>}
  </div>
);

const Card = ({ title, icon: Icon, children, action, className = "" }) => (
  <div className={`bg-white border border-gray-200 rounded-sm p-5 ${className}`}>
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 uppercase tracking-[0.08em]">
        {Icon && <Icon size={16} className="text-gray-400" />} {title}
      </h2>
      {action}
    </div>
    {children}
  </div>
);

const tooltipStyle = { fontSize: 12, borderRadius: 2, border: "1px solid #E5E7EB" };

export default function Dashboard() {
  const [d, setD] = useState(null);
  const load = async () => setD(await api.get("/dashboard"));
  useEffect(() => { load(); }, []);

  const seed = async () => { await api.post("/seed"); load(); };

  if (!d) return <div className="text-sm text-gray-500">A carregar...</div>;

  const orcPie = (d.orcamentos_por_estado || []).filter((x) => x.count > 0);
  const ofData = d.ofs_por_estado || [];
  const mensal = (d.valor_mensal || []).map((m) => ({ ...m, label: m.mes.slice(5) + "/" + m.mes.slice(2, 4) }));
  const tempo = d.tempo_por_of || [];
  const top = d.top_artigos || [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral da produção, orçamentos e custos"
        actions={d.total_artigos === 0 ? (
          <button data-testid="seed-btn" onClick={seed} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium transition-colors">Criar dados demo</button>
        ) : null}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat icon={TrendingUp} label="Valor Orçamentos" value={eur(d.valor_orcamentos)} sub={`${d.orcamentos_aceites} aceites · ${eur(d.valor_aceites)}`} tid="stat-valor" />
        <Stat icon={FileText} label="Orçamentos" value={d.total_orcamentos} sub={`${(d.orcamentos_por_estado || []).find((x) => x.estado === "rascunho")?.count || 0} em rascunho`} tid="stat-orcamentos" />
        <Stat icon={Factory} label="Ordens de Fabrico" value={d.total_ofs} sub={`${d.ofs_em_producao} em produção · ${d.ofs_concluidas} concluídas`} tid="stat-ofs" />
        <Stat icon={Boxes} label="Artigos" value={d.total_artigos} sub={`Custo médio ${eur(d.custo_medio)}`} tid="stat-artigos" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card title="Valor de Orçamentos / mês" icon={Coins} className="lg:col-span-2">
          {mensal.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={mensal} margin={{ left: -10, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={INK} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={INK} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [eur(v), "Valor"]} />
                <Area type="monotone" dataKey="valor" stroke={INK} strokeWidth={2} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Orçamentos por estado" icon={FileText}>
          {orcPie.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={orcPie} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {orcPie.map((e) => <Cell key={e.estado} fill={PALETTE[e.estado] || "#9CA3AF"} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n, p) => [`${v} · ${eur(p.payload.valor)}`, p.payload.label]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card title="Tempo estimado vs real (min)" icon={Clock} className="lg:col-span-2">
          {tempo.length === 0 ? <Empty msg="Sem dados de produção ainda." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={tempo} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="numero" tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} min`, n === "estimado" ? "Estimado" : "Real"]} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "estimado" ? "Estimado" : "Real")} />
                <Bar dataKey="estimado" fill="#9CA3AF" radius={[2, 2, 0, 0]} />
                <Bar dataKey="real" fill={INK} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Ordens de Fabrico por estado" icon={Factory}>
          {(d.total_ofs === 0) ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ofData} layout="vertical" margin={{ left: 30, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={80} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, "OFs"]} cursor={{ fill: "#F9FAFB" }} />
                <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                  {ofData.map((e) => <Cell key={e.estado} fill={PALETTE[e.estado] || "#9CA3AF"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Top artigos · custo vs preço de venda" icon={Boxes}>
        {top.length === 0 ? <Empty /> : (
          <ResponsiveContainer width="100%" height={Math.max(180, top.length * 46)}>
            <BarChart data={top} layout="vertical" margin={{ left: 40, right: 24, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}€`} />
              <YAxis type="category" dataKey="nome" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} width={120} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [eur(v), n === "custo" ? "Custo" : "Preço Venda"]} cursor={{ fill: "#F9FAFB" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "custo" ? "Custo" : "Preço de Venda")} />
              <Bar dataKey="custo" fill="#9CA3AF" radius={[0, 2, 2, 0]} barSize={12} />
              <Bar dataKey="preco" fill="#059669" radius={[0, 2, 2, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="flex gap-3 mt-4">
        <Link to="/orcamentos" data-testid="goto-orcamentos" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver orçamentos →</Link>
        <Link to="/ordens-fabrico" data-testid="goto-ofs" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver ordens de fabrico →</Link>
        <Link to="/tempos" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver tempos & custos →</Link>
      </div>
    </div>
  );
}

const Empty = ({ msg = "Sem dados para mostrar." }) => (
  <div className="h-[240px] flex items-center justify-center text-sm text-gray-400">{msg}</div>
);
