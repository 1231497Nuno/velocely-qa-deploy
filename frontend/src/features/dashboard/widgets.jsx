import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Wallet, Coins, Factory, ClipboardList, Boxes, Clock, Gauge, CalendarClock,
  FileText, TrendingUp, ShieldAlert, AlertTriangle, Contact, History, User,
  ArrowRight, CheckCircle2, Plus, Pencil, Trash2, ArrowRightLeft, Zap,
} from "lucide-react";
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


// ----------------------- Dashboard v2: dinâmico + acessos rápidos -----------------------

export const Greeting = ({ nome }) => {
  const h = new Date().getHours();
  const saud = h < 12 ? "Bom dia" : h < 20 ? "Boa tarde" : "Boa noite";
  const hoje = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="mb-6" data-testid="dash-greeting">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 font-display">
        {saud}{nome ? `, ${nome.split(" ")[0]}` : ""}
      </h1>
      <p className="text-sm text-gray-500 mt-1 capitalize">{hoje}</p>
    </div>
  );
};

export const QuickActions = () => {
  const nav = useNavigate();
  const { can } = useAuth();
  const novoOrcamento = async () => {
    try {
      const o = await api.post("/orcamentos", { cliente: "Novo Cliente", status: "rascunho", linhas: [] });
      toast.success("Orçamento criado");
      nav(`/orcamentos/${o.id}`);
    } catch {
      toast.error("Não foi possível criar o orçamento");
    }
  };
  const novaEncomenda = async () => {
    try {
      const e = await api.post("/encomendas", { cliente: "Novo Cliente", descricao: "", prazo_entrega: "", notas: "" });
      toast.success("Encomenda criada");
      nav(`/encomendas/${e.id}`);
    } catch {
      toast.error("Não foi possível criar a encomenda");
    }
  };
  const actions = [
    can("orcamentos", "create") && { label: "Novo Orçamento", icon: FileText, onClick: novoOrcamento, tid: "qa-novo-orcamento" },
    can("encomendas", "create") && { label: "Nova Encomenda", icon: ClipboardList, onClick: novaEncomenda, tid: "qa-nova-encomenda" },
    can("clientes", "create") && { label: "Novo Cliente", icon: Contact, onClick: () => nav("/clientes"), tid: "qa-novo-cliente" },
    can("ordens_fabrico", "view") && { label: "Ordens de Fabrico", icon: Factory, onClick: () => nav("/ordens-fabrico"), tid: "qa-ver-ofs" },
  ].filter(Boolean);
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-6" data-testid="dash-quick-actions">
      {actions.map((a) => (
        <button
          key={a.tid}
          data-testid={a.tid}
          onClick={a.onClick}
          className="group flex items-center gap-2 bg-white border border-gray-300 hover:border-gray-900 hover:bg-gray-900 hover:text-white text-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium transition-colors"
        >
          <a.icon size={16} className="text-gray-400 group-hover:text-white transition-colors" />
          {a.label}
        </button>
      ))}
    </div>
  );
};

const AttCard = ({ to, icon: Icon, count, label, tone }) => {
  const tones = {
    red: "border-red-200 bg-red-50/50 text-red-600",
    amber: "border-amber-200 bg-amber-50/50 text-amber-600",
    blue: "border-blue-200 bg-blue-50/50 text-blue-600",
  };
  return (
    <Link to={to} data-testid={`att-${label.toLowerCase().replace(/\s+/g, "-")}`} className={`flex items-center gap-3 border rounded-sm p-4 transition-colors hover:shadow-sm ${tones[tone] || "border-gray-200 bg-white text-gray-600"}`}>
      <Icon size={22} className="shrink-0" />
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums font-display leading-none">{count}</div>
        <div className="text-xs text-gray-600 mt-1 truncate">{label}</div>
      </div>
      <ArrowRight size={16} className="ml-auto text-gray-300" />
    </Link>
  );
};

export const AttentionCenter = ({ items }) => {
  const active = items.filter((i) => i.count > 0);
  return (
    <section className="mb-6" data-testid="dash-attention">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2 uppercase tracking-[0.08em]">
        <Zap size={16} className="text-gray-400" /> A precisar da tua atenção
      </h2>
      {active.length === 0 ? (
        <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50/50 rounded-sm p-4 text-sm text-emerald-700" data-testid="dash-attention-clear">
          <CheckCircle2 size={18} /> Tudo em dia — sem pendências urgentes.
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {active.map((i) => <AttCard key={i.label} {...i} />)}
        </div>
      )}
    </section>
  );
};

const ACT_ICON = {
  criado: Plus, editado: Pencil, eliminado: Trash2, estado_alterado: ArrowRightLeft,
  pagamento: Wallet, producao_autorizada: ShieldAlert, concluido: CheckCircle2,
};
const relTime = (ts) => {
  if (!ts) return "";
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "agora mesmo";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return new Date(ts).toLocaleDateString("pt-PT");
};
const ACT_LINK = {
  orcamento: (id) => `/orcamentos/${id}`, encomenda: (id) => `/encomendas/${id}`,
  ordem_fabrico: (id) => `/ordens-fabrico/${id}`, cliente: (id) => `/clientes/${id}`,
};

export const RecentActivity = () => {
  const [eventos, setEventos] = useState(null);
  useEffect(() => {
    api.get("/historico?limit=8").then(setEventos).catch(() => setEventos([]));
  }, []);
  return (
    <Card title="Atividade recente" icon={History}>
      <div data-testid="dash-recent-activity">
        {eventos === null ? (
          <div className="text-sm text-gray-400 py-6 text-center">A carregar...</div>
        ) : eventos.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">Sem atividade ainda.</div>
        ) : (
          <ul className="space-y-3">
            {eventos.map((ev) => {
              const Icon = ACT_ICON[ev.acao] || History;
              const href = ACT_LINK[ev.entidade_tipo]?.(ev.entidade_id);
              const body = (
                <div className="flex items-start gap-3">
                  <span className="shrink-0 h-7 w-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center mt-0.5"><Icon size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-800 truncate">{ev.descricao || ev.acao_label}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1"><User size={10} /> {ev.utilizador_nome}</span>
                      <span>· {relTime(ev.timestamp)}</span>
                    </div>
                  </div>
                </div>
              );
              return (
                <li key={ev.id} data-testid={`dash-activity-${ev.id}`}>
                  {href ? <Link to={href} className="block hover:bg-gray-50 -mx-2 px-2 py-1 rounded-sm transition-colors">{body}</Link> : <div className="py-1">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Link to="/historico" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">Ver histórico completo <ArrowRight size={12} /></Link>
    </Card>
  );
};

export const QuickAnalysis = ({ d }) => {
  const data = [
    { name: "Faturado", valor: d.valor_encomendas || 0, fill: INK },
    { name: "Recebido", valor: d.valor_pago_total || 0, fill: "#059669" },
    { name: "Pendente", valor: d.valor_pendente_total || 0, fill: "#D97706" },
    { name: "Custo real", valor: d.custo_real_encomendas || 0, fill: "#2563EB" },
    { name: "Margem", valor: d.margem_encomendas || 0, fill: (d.margem_encomendas || 0) >= 0 ? "#059669" : "#DC2626" },
  ];
  const temDados = data.some((x) => x.valor !== 0);
  return (
    <Card title="Análise rápida · financeiro" icon={Gauge} className="lg:col-span-2">
      {!temDados ? <Empty msg="Sem encomendas ainda." /> : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}€`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#374151" }} axisLine={false} tickLine={false} width={80} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [eur(v), "Valor"]} cursor={{ fill: "#F9FAFB" }} />
            <Bar dataKey="valor" radius={[0, 3, 3, 0]} barSize={22}>
              {data.map((e) => <Cell key={e.name} fill={e.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
};
