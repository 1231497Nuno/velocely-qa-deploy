import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useListas, opcoesLista } from "@/lib/listas";
import { PageHeader } from "@/components/Layout";

const inputCls = "w-24 border border-gray-300 rounded-sm px-1.5 py-1 text-sm text-right tabular-nums bg-white";

function CentrosCusto() {
  const listas = useListas();
  const [cats, setCats] = useState([]);
  useEffect(() => { api.get("/categorias").then((r) => setCats(Array.isArray(r) ? r : r.items || [])).catch(() => {}); }, []);
  const mudar = async (c, v) => {
    try { await api.put(`/categorias/${c.id}/centro-custo`, { centro_custo: v }); setCats((x) => x.map((y) => (y.id === c.id ? { ...y, centro_custo: v } : y))); }
    catch { toast.error("Não foi possível guardar"); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 mt-6" data-testid="centros-custo">
      <div className="font-semibold text-sm">Centros de custo das categorias</div>
      <p className="text-xs text-gray-500 mb-3">As vendas de cada artigo contam para o centro de custo da sua categoria (relatório «Resultado por centro de custo»). As despesas usam o centro escolhido na ordem de compra. A lista edita-se em Definições → Listas.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {cats.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">{c.nome}</span>
            <select className="border border-gray-300 rounded-sm px-2 py-1 text-sm" value={c.centro_custo || ""} onChange={(e) => mudar(c, e.target.value)}>
              {opcoesLista(listas, "centros_custo", c.centro_custo).map((v) => <option key={v || "x"} value={v}>{v || "—"}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Objetivos anuais de vendas e despesas por mês, comparados com o real (Relatórios → Objetivos). */
export default function Objetivos() {
  const { can } = useAuth();
  const podeEditar = can("relatorios", "edit");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  const [ov, setOv] = useState([]);
  const [od, setOd] = useState([]);
  const aplicar = (r) => { setD(r); setOv(r.linhas.map((l) => l.obj_vendas || "")); setOd(r.linhas.map((l) => l.obj_despesas || "")); };
  useEffect(() => { api.get(`/objetivos/${ano}`).then(aplicar).catch(() => toast.error("Não foi possível carregar")); }, [ano]);
  const guardar = async () => {
    try { aplicar(await api.put(`/objetivos/${ano}`, { vendas: ov.map(Number), despesas: od.map(Number) })); toast.success("Objetivos guardados"); }
    catch { toast.error("Não foi possível guardar"); }
  };
  const repetirAnoAnterior = async () => {
    const r = await api.get(`/objetivos/${ano - 1}`);
    const cresc = Number(window.prompt("Crescimento sobre as vendas reais do ano anterior (%)", "10")) || 0;
    setOv(r.linhas.map((l) => Math.round(l.vendas * (1 + cresc / 100))));
    setOd(r.linhas.map((l) => Math.round(l.despesas)));
  };
  if (!d) return null;
  const cor = (p) => (p == null ? "" : p >= 100 ? "text-emerald-700" : p >= 85 ? "text-amber-700" : "text-red-700");
  return (
    <div>
      <PageHeader title="Objetivos" subtitle="Objetivos de vendas e despesas mês a mês, comparados com o real (vendas das encomendas sem IVA; despesas = ordens de compra)."
        actions={<div className="flex gap-2">
          <select className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {[0, 1, 2, -1].map((k) => new Date().getFullYear() + (k === -1 ? -1 : k)).sort().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {podeEditar && <button type="button" className="btn btn-secundario" onClick={repetirAnoAnterior}>Partir do ano anterior</button>}
          {podeEditar && <button type="button" className="btn btn-primario" onClick={guardar} data-testid="obj-guardar"><Save size={15} /> Guardar</button>}
        </div>} />
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-sm p-3"><div className="text-xs text-gray-500">Vendas no ano</div>
          <div className="text-xl font-bold tabular-nums">{eur(d.total_vendas)} <span className="text-sm font-normal text-gray-500">de {eur(d.total_obj_vendas)}</span></div>
          {d.total_obj_vendas > 0 && <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (d.total_vendas / d.total_obj_vendas) * 100)}%` }} /></div>}</div>
        <div className="bg-white border border-gray-200 rounded-sm p-3"><div className="text-xs text-gray-500">Despesas no ano</div>
          <div className="text-xl font-bold tabular-nums">{eur(d.total_despesas)} <span className="text-sm font-normal text-gray-500">de {eur(d.total_obj_despesas)} previstas</span></div></div>
      </div>
      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="objetivos">
          <thead className="text-xs text-gray-500 bg-gray-50"><tr>
            <th className="text-left px-3 py-2">Mês</th><th className="text-right px-3">Objetivo vendas</th><th className="text-right px-3">Vendas</th><th className="text-right px-3">%</th>
            <th className="text-right px-3">Acumulado (obj. / real)</th><th className="text-right px-3">Despesas previstas</th><th className="text-right px-3">Despesas</th></tr></thead>
          <tbody>
            {d.linhas.map((l, i) => (
              <tr key={l.mes} className="border-t border-gray-100">
                <td className="px-3 py-1.5 font-medium">{l.mes}</td>
                <td className="px-3 text-right">{podeEditar ? <input type="number" min="0" className={inputCls} value={ov[i]} onChange={(e) => setOv(ov.map((x, j) => (j === i ? e.target.value : x)))} /> : eur(l.obj_vendas)}</td>
                <td className="px-3 text-right tabular-nums">{eur(l.vendas)}</td>
                <td className={`px-3 text-right tabular-nums font-medium ${cor(l.pct_vendas)}`}>{l.pct_vendas == null ? "—" : `${Math.round(l.pct_vendas)}%`}</td>
                <td className="px-3 text-right tabular-nums text-gray-600">{eur(l.acum_obj)} / <b className={cor(l.acum_obj ? (l.acum_real / l.acum_obj) * 100 : null)}>{eur(l.acum_real)}</b></td>
                <td className="px-3 text-right">{podeEditar ? <input type="number" min="0" className={inputCls} value={od[i]} onChange={(e) => setOd(od.map((x, j) => (j === i ? e.target.value : x)))} /> : eur(l.obj_despesas)}</td>
                <td className={`px-3 text-right tabular-nums ${l.obj_despesas && l.despesas > l.obj_despesas ? "text-red-700" : ""}`}>{eur(l.despesas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can("artigos", "edit") && <CentrosCusto />}
    </div>
  );
}
