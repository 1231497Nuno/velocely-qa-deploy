import { useEffect, useState, Fragment } from "react";
import { api, eur } from "../lib/api";
import { PageHeader } from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import SearchBar from "../components/SearchBar";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { ChevronDown, ChevronRight, Timer, Coins, TrendingUp, TrendingDown, CalendarRange, Factory } from "lucide-react";

const INK = "#111827";
const tooltipStyle = { fontSize: 12, borderRadius: 4, border: "1px solid #E5E7EB" };
const min = (v) => `${(Number(v) || 0).toFixed(0)} min`;
const minDec = (v) => `${(Number(v) || 0).toFixed(1)} min`;

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const fmtMes = (s) => {
  if (!s || s.length < 7) return s || "—";
  const [y, m] = s.split("-");
  return `${MESES[Number(m) - 1] || m} ${y}`;
};

const Desvio = ({ v, money, testid }) => {
  const val = Number(v) || 0;
  if (Math.abs(val) < (money ? 0.005 : 0.05))
    return <span data-testid={testid} className="tabular-nums text-gray-400">—</span>;
  const over = val > 0;
  return (
    <span data-testid={testid} className={`tabular-nums font-medium inline-flex items-center gap-1 ${over ? "text-red-600" : "text-emerald-600"}`}>
      {over ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {money ? `${over ? "+" : ""}${eur(val)}` : `${over ? "+" : ""}${val.toFixed(1)} min`}
    </span>
  );
};

// ---------- Vista por Ordem de Fabrico ----------
function PorOF() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState({});
  const [view, setView] = useState("tempo");
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/producao/tempos").then(setRows);
  }, []);

  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const isCusto = view === "custo";
  const ql = q.trim().toLowerCase();
  const rows_f = ql ? rows.filter((r) => [r.numero, r.cliente].some((v) => (v || "").toLowerCase().includes(ql))) : rows;

  const Tab = ({ id, icon: Icon, label }) => (
    <button
      data-testid={`tempos-tab-${id}`}
      onClick={() => setView(id)}
      className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${view === id ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Tab id="tempo" icon={Timer} label="Tempos" />
        <Tab id="custo" icon={Coins} label="Custos" />
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por OF ou cliente..." testid="analise-search" />

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-3 py-3 w-8"></th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">OF</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              {isCusto ? (
                <>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Estimado</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Real</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desvio</th>
                </>
              ) : (
                <>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Est. Máquina</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Est. M. Obra</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Est. Total</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Real</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desvio</th>
                </>
              )}
            </tr>
          </thead>
          <tbody data-testid="tempos-table">
            {rows_f.map((r) => (
              <Fragment key={r.id}>
                <tr data-testid={`tempo-row-${r.id}`} onClick={() => toggle(r.id)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-3 py-3 text-gray-400">{open[r.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                  <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{r.numero}</td>
                  <td className="px-4 py-3 text-gray-700">{r.cliente}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                  {isCusto ? (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(r.custo_estimado)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(r.custo_real)}</td>
                      <td className="px-4 py-3 text-right"><Desvio v={r.desvio_custo} money testid={`desvio-custo-${r.id}`} /></td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">{min(r.tempo_estimado_maquina)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">{min(r.tempo_estimado_mao_obra)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{min(r.tempo_estimado_total)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{minDec(r.tempo_real_min)}</td>
                      <td className="px-4 py-3 text-right"><Desvio v={r.desvio_min} testid={`desvio-${r.id}`} /></td>
                    </>
                  )}
                </tr>
                {open[r.id] && (
                  <tr className="bg-gray-50/60">
                    <td></td>
                    <td colSpan={isCusto ? 6 : 7} className="px-4 py-3">
                      {r.operacoes.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">Sem operações nesta OF.</p>
                      ) : (
                        <table className="w-full text-xs border border-gray-200 rounded-sm overflow-hidden bg-white">
                          <thead>
                            <tr className="bg-white border-b border-gray-200 text-gray-400 uppercase tracking-wide">
                              <th className="text-left px-3 py-2 font-semibold">Operação</th>
                              <th className="text-left px-3 py-2 font-semibold">Máquina</th>
                              <th className="text-left px-3 py-2 font-semibold">Mão de Obra</th>
                              <th className="text-right px-3 py-2 font-semibold">Estimado</th>
                              <th className="text-right px-3 py-2 font-semibold">Real</th>
                              <th className="text-right px-3 py-2 font-semibold">Desvio</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.operacoes.map((op, i) => (
                              <tr key={i} className="border-b border-gray-100 last:border-0">
                                <td className="px-3 py-2 text-gray-900">{op.nome || "—"} {op.artigo && <span className="text-gray-400">· {op.artigo}</span>}</td>
                                <td className="px-3 py-2 text-gray-600">{op.maquina_nome || "—"} <span className="text-gray-400 tabular-nums">({min(op.tempo_maquina)})</span></td>
                                <td className="px-3 py-2 text-gray-600">{op.mao_obra_nome || "—"} <span className="text-gray-400 tabular-nums">({min(op.tempo_mao_obra)})</span></td>
                                {isCusto ? (
                                  <>
                                    <td className="px-3 py-2 text-right tabular-nums">{eur(op.custo_estimado)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{op.em_curso ? <span className="text-blue-600">em curso…</span> : eur(op.custo_real)}</td>
                                    <td className="px-3 py-2 text-right"><Desvio v={op.desvio_custo} money /></td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-3 py-2 text-right tabular-nums">{min(op.tempo_estimado)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{op.em_curso ? <span className="text-blue-600">em curso…</span> : minDec(op.tempo_real_min)}</td>
                                    <td className="px-3 py-2 text-right"><Desvio v={op.desvio_min} /></td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows_f.length === 0 && (
              <tr><td colSpan={isCusto ? 7 : 9} className="px-4 py-10 text-center text-gray-400 text-sm">Sem ordens de fabrico para analisar.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
        <Timer size={13} /> O tempo de máquina é totalizado pela estimativa; o tempo cronometrado regista a mão de obra real do colaborador. O custo real = custo de máquina (estimado) + mão de obra (tempo real). Desvio +/vermelho = acima do estimado.
      </p>
    </div>
  );
}

// ---------- Vista Análise Mensal ----------
function Mensal() {
  const [data, setData] = useState([]);
  const [metric, setMetric] = useState("tempo");

  useEffect(() => {
    api.get("/producao/analise").then(setData);
  }, []);

  const chartData = data.map((d) => ({ ...d, label: fmtMes(d.mes) }));
  const isCusto = metric === "custo";

  const Tab = ({ id, icon: Icon, label }) => (
    <button
      data-testid={`mensal-tab-${id}`}
      onClick={() => setMetric(id)}
      className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${metric === id ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-sm py-16 text-center text-gray-400 text-sm" data-testid="mensal-empty">
        Sem dados mensais de produção ainda.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Tab id="tempo" icon={Timer} label="Tempos" />
        <Tab id="custo" icon={Coins} label="Custos" />
      </div>

      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          {isCusto ? <Coins size={15} /> : <Timer size={15} />}
          {isCusto ? "Custo estimado vs real por mês (€)" : "Tempo estimado vs real por mês (min)"}
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={50} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [isCusto ? eur(v) : `${v} min`, n === "estimado" ? "Estimado" : "Real"]} cursor={{ fill: "#F9FAFB" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "estimado" ? "Estimado" : "Real")} />
            <Bar name="estimado" dataKey={isCusto ? "custo_estimado" : "tempo_estimado"} fill="#9CA3AF" radius={[2, 2, 0, 0]} />
            <Bar name="real" dataKey={isCusto ? "custo_real" : "tempo_real"} fill={INK} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Mês</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 flex items-center justify-center gap-1"><Factory size={13} /> OFs</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Concluídas</th>
              {isCusto ? (
                <>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Estimado</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Real</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desvio</th>
                </>
              ) : (
                <>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tempo Estimado</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tempo Real</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desvio</th>
                </>
              )}
            </tr>
          </thead>
          <tbody data-testid="mensal-table">
            {data.map((m) => (
              <tr key={m.mes} data-testid={`mensal-row-${m.mes}`} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{fmtMes(m.mes)}</td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-700">{m.ofs_criadas}</td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-700">{m.ofs_concluidas} <span className="text-gray-400 text-xs">({m.taxa_conclusao}%)</span></td>
                {isCusto ? (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums">{eur(m.custo_estimado)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(m.custo_real)}</td>
                    <td className="px-4 py-3 text-right"><Desvio v={m.desvio_custo} money testid={`mensal-desvio-custo-${m.mes}`} /></td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums">{min(m.tempo_estimado)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{minDec(m.tempo_real)}</td>
                    <td className="px-4 py-3 text-right"><Desvio v={m.desvio_tempo} testid={`mensal-desvio-tempo-${m.mes}`} /></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
        <CalendarRange size={13} /> Agregado por mês de criação da OF. Desvio positivo (vermelho) = acima do estimado; negativo (verde) = abaixo.
      </p>
    </div>
  );
}

export default function AnaliseProducao() {
  const [mode, setMode] = useState("of");

  const ModeTab = ({ id, icon: Icon, label }) => (
    <button
      data-testid={`analise-mode-${id}`}
      onClick={() => setMode(id)}
      className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${mode === id ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Análise da Produção"
        subtitle="Desvios entre estimado e real — por ordem de fabrico e por mês"
        actions={
          <div className="flex items-center gap-2">
            <ModeTab id="of" icon={Factory} label="Por Ordem de Fabrico" />
            <ModeTab id="mensal" icon={CalendarRange} label="Análise Mensal" />
          </div>
        }
      />
      {mode === "of" ? <PorOF /> : <Mensal />}
    </div>
  );
}
