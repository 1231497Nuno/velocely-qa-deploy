import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { api, eur } from "@/lib/api";

const pct = (v) => (v == null ? "—" : `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`);
const corDesvio = (v) => (v > 0.005 ? "text-red-600" : v < -0.005 ? "text-emerald-700" : "text-gray-500");
const min = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`);

/** Separador «Custo real» da encomenda: previsto no orçamento vs o que custou (tempos reais, materiais, compras, NC). */
export default function CustoRealTab({ id }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    setD(null); setErro("");
    api.get(`/encomendas/${id}/custo-real`).then(setD).catch((e) => setErro(e?.response?.data?.detail || "Não foi possível calcular"));
  }, [id]);
  if (erro) return <p className="text-sm text-gray-500">{erro}</p>;
  if (!d) return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-400" /></div>;
  const cards = [
    ["Valor (s/ IVA)", eur(d.receita), ""],
    ["Custo previsto", eur(d.custo_previsto), d.orcamento_numero ? `orçamento ${d.orcamento_numero}` : "estimado"],
    ["Custo real", eur(d.custo_real), <span key="d" className={corDesvio(d.desvio)}>{d.desvio > 0 ? "+" : ""}{eur(d.desvio)} vs previsto</span>],
    ["Margem real", eur(d.margem_real), <span key="m">{pct(d.margem_real_pct)} <span className="text-gray-400">(prevista {pct(d.margem_prevista_pct)})</span></span>],
  ];
  const comp = [["Operações (tempos reais)", d.composicao.operacoes], ["Materiais", d.composicao.materiais], ["Compras / revenda", d.composicao.compra], ["Não conformidades", d.composicao.nao_conformidades]];
  const totComp = comp.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="space-y-4 dado-custo" data-testid="enc-custo-real">
      <div className={`rounded-sm border px-4 py-2.5 text-sm flex items-center gap-2 ${d.completo ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {d.completo ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        {d.completo ? "Custo fechado: todas as OF desta encomenda estão fechadas." : "Custo provisório: há OF por fechar (os materiais contam pelo previsto até ao fecho da OF)."}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(([l, v, s]) => (
          <div key={l} className="bg-white border border-gray-200 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{l}</div>
            <div className="text-xl font-bold tabular-nums mt-1">{v}</div>
            {s && <div className="text-xs text-gray-500 mt-0.5">{s}</div>}
          </div>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded-sm p-4">
        <div className="text-sm font-semibold mb-2">De onde vem o custo real</div>
        <div className="flex h-3 rounded-sm overflow-hidden bg-gray-100 mb-2">
          {comp.map(([l, v], i) => v > 0 && <div key={l} title={`${l}: ${eur(v)}`} style={{ width: `${(v / totComp) * 100}%` }} className={["bg-sky-600", "bg-amber-500", "bg-violet-600", "bg-red-500"][i]} />)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {comp.map(([l, v], i) => (
            <span key={l} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${["bg-sky-600", "bg-amber-500", "bg-violet-600", "bg-red-500"][i]}`} />{l}: <b className="tabular-nums">{eur(v)}</b></span>
          ))}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <th className="px-3 py-2">Artigo</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-right">Previsto</th>
              <th className="px-3 py-2 text-right">Real</th><th className="px-3 py-2 text-right">Desvio</th><th className="px-3 py-2 text-right">Margem</th>
              <th className="px-3 py-2 text-right">Tempo real / previsto</th><th className="px-3 py-2">OF</th>
            </tr>
          </thead>
          <tbody>
            {d.linhas.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{l.artigo_nome} <span className="text-gray-400 font-normal">× {l.quantidade}</span></div>
                  <div className="text-xs text-gray-500">{[l.custo_operacoes && `operações ${eur(l.custo_operacoes)}`, l.custo_materiais && `materiais ${eur(l.custo_materiais)}`, l.custo_compra && `compra ${eur(l.custo_compra)}`].filter(Boolean).join(" · ") || "—"}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(l.receita)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(l.custo_previsto)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{eur(l.custo_real)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${corDesvio(l.desvio)}`}>{l.desvio > 0 ? "+" : ""}{eur(l.desvio)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${l.margem < 0 ? "text-red-600 font-semibold" : ""}`}>{eur(l.margem)} <span className="text-xs text-gray-500">{pct(l.margem_pct)}</span></td>
                <td className={`px-3 py-2 text-right tabular-nums ${l.min_reais > l.min_previstos * 1.1 && l.min_previstos > 0 ? "text-red-600" : "text-gray-600"}`}>{l.min_previstos || l.min_reais ? `${min(l.min_reais)} / ${min(l.min_previstos)}` : "—"}</td>
                <td className="px-3 py-2 text-xs">{l.sem_of ? <span className="text-gray-400">sem OF (custo do artigo)</span> : l.ofs.map((n) => <span key={n} className="mr-1">{n}</span>)}{!l.sem_of && !l.fechado && <span className="text-amber-700"> · por fechar</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Custo real = tempos registados nas OF × custo da máquina e da mão de obra + materiais consumidos no fecho da OF + artigos comprados + desperdício das não conformidades. Veja também a <Link className="underline" to="/rentabilidade-clientes">rentabilidade por cliente</Link>.</p>
    </div>
  );
}
