import { Link } from "react-router-dom";
import { eur } from "@/lib/api";
import { Wallet, Coins, Factory, ClipboardList, Boxes, Clock, Gauge, CalendarClock } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

export const INK = "#111827";
export const PALETTE = {
  rascunho: "#9CA3AF", enviado: "#6366F1", aceite: "#059669", rejeitado: "#DC2626",
  pendente: "#D97706", em_producao: "#2563EB", concluido: "#059669",
  aberta: "#9CA3AF", concluida: "#059669", cancelada: "#DC2626",
  parcial: "#D97706", pago: "#059669",
};
const tooltipStyle = { fontSize: 12, borderRadius: 2, border: "1px solid #E5E7EB" };

export const Stat = ({ icon: Icon, label, value, sub, tid, accent = "text-gray-900" }) => (
  <div data-testid={tid} className="bg-white border border-gray-200 rounded-sm p-5 flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">{label}</span>
      <Icon size={18} className="text-gray-400" strokeWidth={1.8} />
    </div>
    <div className={`text-3xl font-bold tracking-tight tabular-nums font-display ${accent}`}>{value}</div>
    {sub && <div className="text-xs text-gray-500">{sub}</div>}
  </div>
);

export const Card = ({ title, icon: Icon, children, className = "" }) => (
  <div className={`bg-white border border-gray-200 rounded-sm p-5 ${className}`}>
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 uppercase tracking-[0.08em]">
        {Icon && <Icon size={16} className="text-gray-400" />} {title}
      </h2>
    </div>
    {children}
  </div>
);

const Empty = ({ msg = "Sem dados para mostrar." }) => (
  <div className="h-[240px] flex items-center justify-center text-sm text-gray-400">{msg}</div>
);

export const PrazosBanner = ({ atrasadas = 0, proximos7 = 0 }) => (
  <Link to="/calendario" data-testid="dash-prazos-banner" className="block mb-4">
    <div className={`border rounded-sm p-4 flex flex-wrap items-center gap-x-6 gap-y-2 transition-colors hover:bg-gray-50 ${atrasadas > 0 ? "border-red-300 bg-red-50/40" : "border-gray-200 bg-white"}`}>
      <div className="flex items-center gap-2">
        <CalendarClock size={18} className="text-gray-500" />
        <span className="text-sm font-semibold text-gray-700 uppercase tracking-[0.08em]">Prazos de Entrega</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className={`text-2xl font-bold tabular-nums font-display ${atrasadas > 0 ? "text-red-600" : "text-gray-400"}`}>{atrasadas}</span>
        <span className="text-gray-500">atrasados</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className={`text-2xl font-bold tabular-nums font-display ${proximos7 > 0 ? "text-amber-600" : "text-gray-400"}`}>{proximos7}</span>
        <span className="text-gray-500">nos próximos 7 dias</span>
      </div>
      <span className="ml-auto text-xs text-gray-400">Ver calendário →</span>
    </div>
  </Link>
);

export const EncValorCustoChart = ({ data }) => (
  <Card title="Valor da Encomenda vs Custo de Produção" icon={ClipboardList} className="lg:col-span-2">
    {data.length === 0 ? <Empty msg="Sem encomendas ainda." /> : (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
          <XAxis dataKey="numero" tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${v}€`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [eur(v), n === "valor" ? "Valor encomenda" : n === "custo_real" ? "Custo real" : "Custo estimado"]} cursor={{ fill: "#F9FAFB" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "valor" ? "Valor encomenda" : v === "custo_real" ? "Custo real" : "Custo estimado")} />
          <Bar dataKey="valor" fill={INK} radius={[2, 2, 0, 0]} barSize={16} />
          <Bar dataKey="custo_estimado" fill="#9CA3AF" radius={[2, 2, 0, 0]} barSize={12} />
          <Bar dataKey="custo_real" fill="#2563EB" radius={[2, 2, 0, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    )}
  </Card>
);

export const PagamentoPie = ({ data }) => (
  <Card title="Encomendas por Pagamento" icon={Wallet}>
    {data.length === 0 ? <Empty /> : (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey="valor" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
            {data.map((e) => <Cell key={e.estado} fill={PALETTE[e.estado] || "#9CA3AF"} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n, p) => [`${eur(v)} · ${p.payload.count} enc.`, p.payload.label]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    )}
  </Card>
);

export const MensalArea = ({ data }) => (
  <Card title="Valor de Orçamentos / mês" icon={Coins} className="lg:col-span-2">
    {data.length === 0 ? <Empty /> : (
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
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
);

export const OFEstadoChart = ({ data, totalOfs }) => (
  <Card title="Ordens de Fabrico por estado" icon={Factory}>
    {totalOfs === 0 ? <Empty /> : (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 30, right: 16, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={80} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, "OFs"]} cursor={{ fill: "#F9FAFB" }} />
          <Bar dataKey="count" radius={[0, 2, 2, 0]}>
            {data.map((e) => <Cell key={e.estado} fill={PALETTE[e.estado] || "#9CA3AF"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )}
  </Card>
);

export const TempoChart = ({ data }) => (
  <Card title="Tempo de Produção · estimado vs real (min)" icon={Clock} className="lg:col-span-2">
    {data.length === 0 ? <Empty msg="Sem dados de produção ainda." /> : (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
          <XAxis dataKey="numero" tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} min`, n === "estimado" ? "Estimado" : "Real"]} cursor={{ fill: "#F9FAFB" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "estimado" ? "Estimado" : "Real")} />
          <Bar dataKey="estimado" fill="#9CA3AF" radius={[2, 2, 0, 0]} />
          <Bar dataKey="real" fill={INK} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )}
  </Card>
);

const Linha = ({ label, value, accent, border }) => (
  <div className={`flex items-center justify-between text-sm ${border ? "border-b border-gray-100 pb-3" : ""}`}>
    <span className="text-gray-500">{label}</span>
    <span className={accent || "tabular-nums font-medium"}>{value}</span>
  </div>
);

export const TempoCustoTotais = ({ tEst, tReal, desvioTempo, custoEst, custoReal, desvioCusto }) => (
  <Card title="Tempos & Custos (totais)" icon={Gauge}>
    <div className="space-y-3" data-testid="dash-tempo-custo-totais">
      <Linha label="Tempo estimado" value={<span className="tabular-nums font-medium" data-testid="dash-tempo-est">{tEst} min</span>} />
      <Linha label="Tempo real" value={<span className="tabular-nums font-medium" data-testid="dash-tempo-real">{tReal} min</span>} />
      <Linha label="Desvio de tempo" border accent={`tabular-nums font-semibold ${desvioTempo > 0 ? "text-red-600" : "text-emerald-600"}`} value={`${desvioTempo > 0 ? "+" : ""}${desvioTempo} min`} />
      <Linha label="Custo estimado" value={eur(custoEst)} />
      <Linha label="Custo real" value={eur(custoReal)} />
      <Linha label="Desvio de custo" accent={`tabular-nums font-semibold ${desvioCusto > 0 ? "text-red-600" : "text-emerald-600"}`} value={`${desvioCusto > 0 ? "+" : ""}${eur(desvioCusto)}`} />
    </div>
  </Card>
);

export const TopArtigosChart = ({ data }) => (
  <Card title="Top artigos · custo vs preço de venda" icon={Boxes}>
    {data.length === 0 ? <Empty /> : (
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 46)}>
        <BarChart data={data} layout="vertical" margin={{ left: 40, right: 24, top: 4 }}>
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
);
