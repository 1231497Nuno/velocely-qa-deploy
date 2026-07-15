import { useEffect, useState, useCallback } from "react";
import { api, eur } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import { Coins, TrendingUp, TrendingDown, Users, Wallet } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

const INK = "#111827";
const tooltipStyle = { fontSize: 12, borderRadius: 4, border: "1px solid #E5E7EB" };

const KPI = ({ icon: Icon, label, value, sub, testid }) => (
  <div data-testid={testid} className="bg-white border border-gray-200 rounded-sm p-4">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">
      <Icon size={14} /> {label}
    </div>
    <div className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const Margem = ({ v, pct, testid }) => {
  const val = Number(v) || 0;
  const pos = val >= 0;
  return (
    <span data-testid={testid} className={`tabular-nums font-medium inline-flex items-center gap-1 ${pos ? "text-emerald-600" : "text-red-600"}`}>
      {pos ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {eur(val)} <span className="text-gray-400 font-normal">({pct}%)</span>
    </span>
  );
};

export default function RentabilidadeClientes() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get("/relatorios/rentabilidade-clientes"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ql = q.trim().toLowerCase();
  const rows_f = ql ? rows.filter((r) => (r.cliente || "").toLowerCase().includes(ql)) : rows;

  const tot = rows.reduce((a, r) => ({
    faturado: a.faturado + (r.valor_faturado || 0),
    custo: a.custo + (r.custo_real || 0),
    pendente: a.pendente + (r.valor_pendente || 0),
  }), { faturado: 0, custo: 0, pendente: 0 });
  const totMargem = tot.faturado - tot.custo;

  const chartData = rows.slice(0, 8).map((r) => ({
    label: (r.cliente || "—").length > 14 ? `${r.cliente.slice(0, 13)}…` : (r.cliente || "—"),
    faturado: r.valor_faturado,
    custo_real: r.custo_real,
  }));

  return (
    <div>
      <PageHeader
        title="Rentabilidade por Cliente"
        subtitle="Valor faturado vs. custo real de produção das ordens de fabrico"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPI icon={Users} label="Clientes" value={rows.length} testid="kpi-clientes" />
        <KPI icon={Coins} label="Faturado" value={eur(tot.faturado)} testid="kpi-faturado" />
        <KPI icon={Wallet} label="Custo Real" value={eur(tot.custo)} sub={`Pendente: ${eur(tot.pendente)}`} testid="kpi-custo" />
        <KPI icon={TrendingUp} label="Margem Total" value={eur(totMargem)} sub={tot.faturado > 0 ? `${((totMargem / tot.faturado) * 100).toFixed(1)}%` : "—"} testid="kpi-margem" />
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por cliente..." testid="rentabilidade-search" />

      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4" data-testid="rentabilidade-chart">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Coins size={15} /> Faturado vs. Custo Real por cliente (€)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={55} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [eur(v), n === "faturado" ? "Faturado" : "Custo Real"]} cursor={{ fill: "#F9FAFB" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "faturado" ? "Faturado" : "Custo Real")} />
              <Bar name="faturado" dataKey="faturado" fill={INK} radius={[2, 2, 0, 0]} />
              <Bar name="custo_real" dataKey="custo_real" fill="#9CA3AF" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Enc.</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">OFs</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Faturado</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pago</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pendente</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Real</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Margem</th>
            </tr>
          </thead>
          <tbody data-testid="rentabilidade-table">
            {rows_f.map((r) => (
              <tr key={r.cliente_id || r.cliente} data-testid={`rentabilidade-row-${r.cliente_id || r.cliente}`} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{r.cliente}</td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-700">{r.num_encomendas}</td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-700">{r.num_ofs}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(r.valor_faturado)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{eur(r.valor_pago)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{eur(r.valor_pendente)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{eur(r.custo_real)}</td>
                <td className="px-4 py-3 text-right"><Margem v={r.margem} pct={r.margem_pct} testid={`rentabilidade-margem-${r.cliente_id || r.cliente}`} /></td>
              </tr>
            ))}
            {!loading && rows_f.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Sem encomendas para analisar.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
        <Coins size={13} /> Margem = valor faturado − custo real de produção (máquina estimada + mão de obra cronometrada). Encomendas canceladas excluídas.
      </p>
    </div>
  );
}
