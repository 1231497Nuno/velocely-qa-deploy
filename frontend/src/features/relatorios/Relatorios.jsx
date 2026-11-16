import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { BarChart3, ChevronRight, Columns3, FileDown, FileSpreadsheet, Info, Loader2, Mail, Save, Send, Star, Trash2, Users, X } from "lucide-react";
import { API, api, eur, fmtDate, getToken } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import ClienteSelector from "@/components/ClienteSelector";
import { useConfirm } from "@/hooks/useConfirm";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import GuardarRelatorioDialog from "./GuardarRelatorioDialog";

// Paleta categórica (ordem fixa, validada para daltonismo; sem rosa)
const CORES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#6250d6", "#008300", "#e34948"];

const PERIODOS = [
  { id: "este_mes", label: "Este mês" },
  { id: "mes_passado", label: "Mês passado" },
  { id: "trimestre", label: "Este trimestre" },
  { id: "ano", label: "Este ano" },
  { id: "ano_passado", label: "Ano passado" },
  { id: "12m", label: "Últimos 12 meses" },
  { id: "custom", label: "Personalizado" },
];
// Período do ecrã → período relativo guardado no servidor
const PERIODO_SERVIDOR = { este_mes: "mes_atual", mes_passado: "mes_anterior", trimestre: "trimestre_atual", ano: "ano_atual", ano_passado: "ano_anterior", "12m": "ultimos_12m", custom: "personalizado" };
const PERIODO_ECRA = Object.fromEntries(Object.entries(PERIODO_SERVIDOR).map(([a, b]) => [b, a]));
const AGRUPAR = [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"], ["trimestre", "Trimestre"], ["ano", "Ano"]];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function intervalo(id) {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  switch (id) {
    case "este_mes": return [iso(new Date(y, m, 1)), iso(h)];
    case "mes_passado": return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "trimestre": return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), iso(h)];
    case "ano_passado": return [iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))];
    case "12m": return [iso(new Date(y, m - 11, 1)), iso(h)];
    default: return [iso(new Date(y, 0, 1)), iso(h)];
  }
}

function fmt(v, tipo) {
  if (v === null || v === undefined || v === "") return "—";
  if (tipo === "moeda") return eur(v);
  if (tipo === "pct") return `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;
  if (tipo === "numero") return Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
  if (tipo === "inteiro") return Number(v).toLocaleString("pt-PT");
  if (tipo === "data") return fmtDate(v);
  return String(v);
}

function fmtCurto(v, tipo) {
  if (tipo !== "moeda") return Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 1 });
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(n)} €`;
}

async function descarregar(path, nome) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { const j = await res.json(); if (typeof j?.detail === "string") msg = j.detail; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function Kpis({ rel }) {
  const cols = rel.colunas.filter((c) => c.key in (rel.totais || {}) && c.tipo !== "texto").slice(0, 4);
  if (!cols.length) return null;
  return (
    <div className={`grid grid-cols-2 ${cols.length > 2 ? "lg:grid-cols-4" : ""} gap-2`} data-testid="rel-kpis">
      {cols.map((c) => (
        <div key={c.key} className="bg-white border border-gray-200 rounded-sm px-4 py-3 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 truncate">{c.label}</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-gray-900">{fmt(rel.totais[c.key], c.tipo)}</div>
        </div>
      ))}
    </div>
  );
}

function DicaGrafico({ active, payload, label, colunas }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-gray-900 mb-1">{label ?? payload[0]?.name}</div>
      {payload.map((p) => {
        const c = colunas.find((x) => x.key === p.dataKey) || {};
        return (
          <div key={p.dataKey + String(p.name)} className="flex items-center gap-2 text-gray-700">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color || p.payload?.fill }} />
            <span>{c.label || p.name}</span>
            <span className="ml-auto pl-3 tabular-nums font-medium text-gray-900">{fmt(p.value, c.tipo)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Grafico({ rel }) {
  const g = rel.grafico;
  const dados = useMemo(() => {
    if (!g) return [];
    const linhas = g.max ? rel.linhas.slice(0, g.max) : rel.linhas;
    return linhas.map((l) => ({ ...l, [g.x]: String(l[g.x] ?? "—") }));
  }, [rel, g]);
  if (!g || !dados.length) return null;
  const colunas = rel.colunas;
  const tipoY = colunas.find((c) => c.key === g.series[0])?.tipo;
  const nome = (k) => colunas.find((c) => c.key === k)?.label || k;
  const legenda = g.series.length > 1;

  let grafico;
  if (g.tipo === "pizza") {
    const total = dados.reduce((s, d) => s + (Number(d[g.series[0]]) || 0), 0);
    grafico = (
      <PieChart>
        <Pie data={dados} dataKey={g.series[0]} nameKey={g.x} innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke="#fff" strokeWidth={2}
          label={({ name, value }) => (total ? `${name} ${Math.round((value / total) * 100)}%` : name)} labelLine={false}>
          {dados.map((d, i) => <Cell key={d[g.x]} fill={CORES[i % CORES.length]} />)}
        </Pie>
        <Tooltip content={<DicaGrafico colunas={colunas} />} />
      </PieChart>
    );
  } else if (g.tipo === "barras_h") {
    grafico = (
      <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke="#eef0f2" />
        <XAxis type="number" tickFormatter={(v) => fmtCurto(v, tipoY)} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={g.x} width={160} tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false}
          tickFormatter={(v) => (String(v).length > 24 ? `${String(v).slice(0, 23)}…` : v)} />
        <Tooltip content={<DicaGrafico colunas={colunas} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {legenda && <Legend formatter={nome} wrapperStyle={{ fontSize: 12 }} />}
        {g.series.map((s, i) => <Bar key={s} dataKey={s} name={nome(s)} fill={CORES[i]} radius={[0, 4, 4, 0]} maxBarSize={18} />)}
      </BarChart>
    );
  } else {
    const empilhar = g.tipo === "barras_empilhadas";
    grafico = (
      <BarChart data={dados} margin={{ left: 4, right: 8 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="#eef0f2" />
        <XAxis dataKey={g.x} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tickFormatter={(v) => fmtCurto(v, tipoY)} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={60} />
        <Tooltip content={<DicaGrafico colunas={colunas} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {legenda && <Legend formatter={nome} wrapperStyle={{ fontSize: 12 }} />}
        {g.series.map((s, i) => (
          <Bar key={s} dataKey={s} name={nome(s)} fill={CORES[i % CORES.length]} stackId={empilhar ? "a" : undefined}
            radius={empilhar ? (i === g.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} maxBarSize={36}
            stroke={empilhar ? "#fff" : undefined} strokeWidth={empilhar ? 1 : 0} />
        ))}
      </BarChart>
    );
  }
  const altura = g.tipo === "barras_h" ? Math.max(180, dados.length * 28 + 40) : 280;
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="rel-grafico">
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">{grafico}</ResponsiveContainer>
      </div>
      {g.max && rel.linhas.length > g.max && <p className="text-[11px] text-gray-500 mt-1">Gráfico com os primeiros {g.max}; a tabela tem todos.</p>}
    </div>
  );
}

function Tabela({ rel }) {
  const nav = useNavigate();
  const [ordem, setOrdem] = useState(null);
  const linhas = useMemo(() => {
    if (!ordem) return rel.linhas;
    const { key, dir } = ordem;
    return [...rel.linhas].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt");
      return dir === "asc" ? r : -r;
    });
  }, [rel, ordem]);
  const direita = (c) => !["texto", "data"].includes(c.tipo);
  const ordenar = (key) => setOrdem((o) => (o?.key === key ? (o.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" }));
  return (
    <div className="bg-white border border-gray-200 rounded-sm overflow-hidden" data-testid="rel-tabela">
      <div className="overflow-x-auto max-h-[65vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-gray-50 border-b border-gray-200">
              {rel.colunas.map((c) => (
                <th key={c.key} onClick={() => ordenar(c.key)}
                  className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 cursor-pointer select-none whitespace-nowrap bg-gray-50 ${direita(c) ? "text-right" : "text-left"}`}>
                  {c.label}{ordem?.key === c.key ? (ordem.dir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
              <th className="w-6 bg-gray-50" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} onClick={l._link ? () => nav(l._link) : undefined}
                className={`border-b border-gray-100 ${l._link ? "cursor-pointer hover:bg-gray-50" : ""}`}>
                {rel.colunas.map((c, ci) => {
                  const v = l[c.key];
                  const neg = (c.key === "variacao" || c.key.startsWith("desvio") || c.key.startsWith("margem") || c.key === "resultado") && typeof v === "number";
                  const cor = neg ? (c.key.startsWith("desvio") ? (v > 0 ? "text-red-600" : v < 0 ? "text-emerald-700" : "") : (v < 0 ? "text-red-600" : v > 0 && c.key === "variacao" ? "text-emerald-700" : "")) : "";
                  return (
                    <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${direita(c) ? "text-right tabular-nums" : ""} ${ci === 0 ? "font-medium text-gray-900" : "text-gray-700"} ${cor}`}>
                      {c.key === "variacao" && typeof v === "number" && v > 0 ? "+" : ""}{fmt(v, c.tipo)}
                    </td>
                  );
                })}
                <td className="pr-2 text-gray-300">{l._link ? <ChevronRight size={14} /> : null}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={rel.colunas.length + 1} className="px-4 py-10 text-center text-gray-400">Sem dados neste período.</td></tr>}
          </tbody>
          {rel.totais && Object.keys(rel.totais).length > 0 && linhas.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                {rel.colunas.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap bg-gray-50 ${direita(c) ? "text-right tabular-nums" : ""}`}>
                    {i === 0 ? "Total" : c.key in rel.totais ? fmt(rel.totais[c.key], c.tipo) : ""}
                  </td>
                ))}
                <td className="bg-gray-50" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** Área Relatórios: escolher o relatório, o período e o agrupamento; ver gráfico + tabela; exportar Excel/PDF. */
export default function Relatorios() {
  const [sp, setSp] = useSearchParams();
  const [cat, setCat] = useState(null);
  const [rel, setRel] = useState(null);
  const [aCarregar, setACarregar] = useState(false);
  const [exportar, setExportar] = useState("");
  const [periodo, setPeriodo] = useState("ano");
  const [[de, ate], setIntervalo] = useState(() => intervalo("ano"));
  const [agrupar, setAgrupar] = useState("mes");
  const [comparar, setComparar] = useState("");
  const [cliente, setCliente] = useState({ id: "", nome: "" });
  const [limite, setLimite] = useState(0);
  const [colunas, setColunas] = useState([]); // [] = todas
  const [guardados, setGuardados] = useState([]);
  const [ativo, setAtivo] = useState(null); // relatório guardado aberto
  const [dlgGuardar, setDlgGuardar] = useState(false);
  const confirm = useConfirm();
  const carregarGuardados = () => api.get("/relatorios/guardados").then((r) => setGuardados(r.guardados || [])).catch(() => {});
  useEffect(() => { carregarGuardados(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.get("/relatorios/catalogo").then(setCat).catch(() => toast.error("Não foi possível carregar os relatórios")); }, []);
  const rid = sp.get("r") || "vendas_periodo";
  const meta = cat?.relatorios.find((r) => r.id === rid);

  const query = useMemo(() => {
    const q = new URLSearchParams({ de, ate, agrupar, comparar });
    if (cliente.id) q.set("cliente_id", cliente.id);
    if (limite) q.set("limite", String(limite));
    return q.toString();
  }, [de, ate, agrupar, comparar, cliente.id, limite]);
  const visiveis = useMemo(() => {
    if (!rel || !colunas.length) return rel;
    const pk = Object.fromEntries(rel.colunas.map((c) => [c.key, c]));
    const cols = colunas.filter((k) => pk[k]);
    if (!cols.length) return rel;
    if (!cols.includes(rel.colunas[0].key)) cols.unshift(rel.colunas[0].key);
    return { ...rel, colunas: cols.map((k) => pk[k]) };
  }, [rel, colunas]);
  const queryColunas = colunas.length ? `&colunas=${encodeURIComponent(colunas.join(","))}` : "";

  const abrirGuardado = (g) => {
    setAtivo(g);
    setSp({ r: g.relatorio_id }, { replace: true });
    const pe = PERIODO_ECRA[g.periodo] || "ano";
    setPeriodo(pe);
    setIntervalo(pe === "custom" ? [g.de, g.ate] : intervalo(pe));
    setAgrupar(g.agrupar || "mes");
    setComparar(g.comparar || "");
    setCliente({ id: g.cliente_id || "", nome: g.cliente_nome || "" });
    setLimite(g.limite || 0);
    setColunas(g.colunas || []);
  };
  const escolherRelatorio = (id) => {
    setAtivo(null);
    setColunas([]);
    setSp({ r: id }, { replace: true });
  };
  const apagarGuardado = async (g) => {
    if (!(await confirm({ title: "Apagar relatório guardado?", description: `«${g.nome}»${g.envio?.ativo ? " — o envio automático também pára" : ""}.`, confirmLabel: "Apagar", tone: "danger" }))) return;
    try { await api.del(`/relatorios/guardados/${g.id}`); if (ativo?.id === g.id) setAtivo(null); carregarGuardados(); } catch { toast.error("Não foi possível apagar"); }
  };
  const enviarAgora = async (g) => {
    try { await api.post(`/relatorios/guardados/${g.id}/enviar`, {}); toast.success(`Enviado para ${g.envio.destinatarios.join(", ")}`); carregarGuardados(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível enviar"); }
  };
  const paramsAtuais = { relatorio_id: rid, periodo: PERIODO_SERVIDOR[periodo] || "ano_atual", de, ate, agrupar, comparar, cliente_id: cliente.id, cliente_nome: cliente.nome, limite, colunas };

  useEffect(() => {
    if (!meta) return;
    let vivo = true;
    setACarregar(true);
    api.get(`/relatorios/gerar/${rid}?${query}`)
      .then((r) => { if (vivo) setRel(r); })
      .catch((e) => { if (vivo) { setRel(null); toast.error(e?.response?.data?.detail || "Não foi possível gerar o relatório"); } })
      .finally(() => vivo && setACarregar(false));
    return () => { vivo = false; };
  }, [rid, query, meta]);

  const escolherPeriodo = (id) => {
    setPeriodo(id);
    if (id !== "custom") setIntervalo(intervalo(id));
  };
  const exportarFicheiro = async (formato) => {
    setExportar(formato);
    try {
      await descarregar(`/relatorios/gerar/${rid}?${query}&formato=${formato}${queryColunas}`, `${ativo?.nome || meta.titulo} ${de} a ${ate}.${formato}`);
    } catch (e) {
      toast.error(e.message || "Não foi possível exportar");
    } finally {
      setExportar("");
    }
  };

  const selCls = "text-sm border border-gray-300 rounded-sm px-2 py-1.5 min-h-9 bg-white text-gray-700";

  return (
    <div data-testid="relatorios">
      <PageHeader title="Relatórios" subtitle="Vendas, produção, recebimentos, compras e margens — com gráfico, tabela e exportação para Excel e PDF." />
      <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] gap-5">
        <nav className="bg-white border border-gray-200 rounded-sm p-2 h-fit lg:sticky lg:top-20 space-y-3" data-testid="rel-nav">
          {!cat && <div className="text-sm text-gray-500 p-2">A carregar...</div>}
          {guardados.length > 0 && (
            <div data-testid="rel-guardados">
              <div className="px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Guardados</div>
              {guardados.map((g) => (
                <div key={g.id} className={`group flex items-center rounded-sm ${ativo?.id === g.id ? "bg-brand text-brand-fg" : "text-gray-700 hover:bg-gray-100"}`}>
                  <button type="button" onClick={() => abrirGuardado(g)} className="flex-1 min-w-0 text-left px-2.5 py-1.5 text-sm flex items-center gap-1.5" title={`${g.relatorio_titulo} · ${g.periodo_label}`} data-testid={`rel-guardado-${g.id}`}>
                    <Star size={12} className="shrink-0" /><span className="truncate">{g.nome}</span>
                    {g.envio?.ativo && <Mail size={12} className="shrink-0 opacity-70" title="Envio automático" />}
                    {!g.meu && <Users size={12} className="shrink-0 opacity-70" title={`De ${g.dono?.nome}`} />}
                  </button>
                  {g.pode_editar && <button type="button" onClick={() => apagarGuardado(g)} className="p-1 mr-1 opacity-0 group-hover:opacity-70 hover:!opacity-100" title="Apagar"><Trash2 size={13} /></button>}
                </div>
              ))}
            </div>
          )}
          {cat?.areas.map((a) => (
            <div key={a.id}>
              <div className="px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">{a.label}</div>
              {cat.relatorios.filter((r) => r.area === a.id).map((r) => (
                <button key={r.id} type="button" onClick={() => escolherRelatorio(r.id)} data-testid={`rel-${r.id}`}
                  className={`w-full text-left px-2.5 py-1.5 rounded-sm text-sm ${r.id === rid && !ativo ? "bg-brand text-brand-fg" : "text-gray-700 hover:bg-gray-100"}`}>
                  {r.titulo}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="space-y-4 min-w-0">
          {meta && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><BarChart3 size={18} /> {ativo ? ativo.nome : meta.titulo}</h2>
                <p className="text-sm text-gray-500">{ativo ? `${meta.titulo} · ${ativo.periodo_label}${ativo.envio?.ativo ? ` · enviado por email (${ativo.envio.destinatarios.join(", ")})` : ""}` : meta.descricao}</p>
                {ativo?.ultimo_envio && <p className={`text-xs ${ativo.ultimo_envio.ok ? "text-gray-400" : "text-red-600"}`}>Último envio {fmtDate(ativo.ultimo_envio.at)}{ativo.ultimo_envio.ok ? "" : ` — falhou: ${ativo.ultimo_envio.erro}`}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {rel && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="btn btn-secundario" data-testid="rel-colunas"><Columns3 size={15} /> Colunas{colunas.length ? ` (${visiveis.colunas.length}/${rel.colunas.length})` : ""}</button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-2">
                      <div className="text-xs text-gray-500 px-1 pb-1">Colunas a mostrar e a exportar</div>
                      {rel.colunas.map((c, i) => {
                        const on = !colunas.length || colunas.includes(c.key);
                        return (
                          <label key={c.key} className={`flex items-center gap-2 px-1 py-1 text-sm ${i === 0 ? "text-gray-400" : ""}`}>
                            <input type="checkbox" disabled={i === 0} checked={on || i === 0} onChange={() => {
                              const base = colunas.length ? colunas : rel.colunas.map((x) => x.key);
                              setColunas(on ? base.filter((k) => k !== c.key) : rel.colunas.map((x) => x.key).filter((k) => base.includes(k) || k === c.key));
                            }} />
                            {c.label}
                          </label>
                        );
                      })}
                      {colunas.length > 0 && <button type="button" className="text-xs text-brand px-1 pt-1 hover:underline" onClick={() => setColunas([])}>Mostrar todas</button>}
                    </PopoverContent>
                  </Popover>
                )}
                <button type="button" disabled={!meta} onClick={() => setDlgGuardar(true)} className="btn btn-secundario" data-testid="rel-guardar"><Save size={15} /> Guardar</button>
                {ativo?.pode_editar && ativo.envio?.ativo && (
                  <button type="button" onClick={() => enviarAgora(ativo)} className="btn btn-secundario" data-testid="rel-enviar-agora" title="Enviar já para os destinatários"><Send size={15} /> Enviar agora</button>
                )}
                <button type="button" disabled={!rel || !!exportar} onClick={() => exportarFicheiro("xlsx")} className="btn btn-secundario" data-testid="rel-excel">
                  {exportar === "xlsx" ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Excel
                </button>
                <button type="button" disabled={!rel || !!exportar} onClick={() => exportarFicheiro("pdf")} className="btn btn-secundario" data-testid="rel-pdf">
                  {exportar === "pdf" ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} PDF
                </button>
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-sm p-3 flex flex-wrap items-end gap-3" data-testid="rel-filtros">
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              {meta?.so_ate ? "Situação em" : "Período"}
              <select className={selCls} value={periodo} onChange={(e) => escolherPeriodo(e.target.value)} data-testid="rel-periodo">
                {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {!meta?.so_ate && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                De
                <input type="date" className={selCls} value={de} onChange={(e) => { setPeriodo("custom"); setIntervalo([e.target.value, ate]); }} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              {meta?.so_ate ? "Data" : "Até"}
              <input type="date" className={selCls} value={ate} onChange={(e) => { setPeriodo("custom"); setIntervalo([de, e.target.value]); }} />
            </label>
            {meta?.tempo && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Agrupar por
                <select className={selCls} value={agrupar} onChange={(e) => setAgrupar(e.target.value)} data-testid="rel-agrupar">
                  {AGRUPAR.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                </select>
              </label>
            )}
            {meta?.comparar && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Comparar com
                <select className={selCls} value={comparar} onChange={(e) => setComparar(e.target.value)} data-testid="rel-comparar">
                  <option value="">Sem comparação</option>
                  <option value="anterior">Período anterior</option>
                  <option value="ano">Mesmo período do ano anterior</option>
                </select>
              </label>
            )}
            {meta?.ranking && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Mostrar
                <select className={selCls} value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
                  <option value={0}>Todos</option>
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                  <option value={50}>Top 50</option>
                </select>
              </label>
            )}
            {!["producao_operacoes", "nao_conformidades", "compras_fornecedor", "crm_funil", "clientes_novos", "resultado_periodo"].includes(rid) && (
              <div className="flex flex-col gap-1 text-xs text-gray-500 min-w-[14rem]">
                Cliente
                <div className="flex items-center gap-1">
                  <div className="flex-1"><ClienteSelector value={cliente.id} onChange={(id, nome) => setCliente({ id: id || "", nome: nome || "" })} testid="rel-cliente" /></div>
                  {cliente.id && <button type="button" onClick={() => setCliente({ id: "", nome: "" })} className="p-1.5 text-gray-400 hover:text-gray-700" title="Todos os clientes"><X size={14} /></button>}
                </div>
              </div>
            )}
            {aCarregar && <Loader2 size={16} className="animate-spin text-gray-400 mb-2.5" />}
          </div>

          {rel && rel.id === rid && (
            <>
              <Kpis rel={rel} />
              <Grafico rel={rel} />
              <Tabela rel={visiveis} />
              {rel.notas?.length > 0 && (
                <div className="text-xs text-gray-500 space-y-0.5">
                  {rel.notas.map((n) => <p key={n} className="flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> {n}</p>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {dlgGuardar && (
        <GuardarRelatorioDialog open onClose={() => setDlgGuardar(false)} params={paramsAtuais} existente={ativo}
          periodoLabel={PERIODOS.find((p) => p.id === periodo)?.label || ""}
          onSaved={(g) => { setDlgGuardar(false); carregarGuardados().then(() => setAtivo((a) => ({ ...a, ...g, pode_editar: true, meu: true, relatorio_titulo: meta?.titulo, periodo_label: PERIODOS.find((p) => p.id === periodo)?.label }))); }} />
      )}
    </div>
  );
}
