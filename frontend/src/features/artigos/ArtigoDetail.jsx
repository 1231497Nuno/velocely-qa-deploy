import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import ImagemUpload from "@/components/ImagemUpload";
import SeccaoPesquisavel from "@/components/SeccaoPesquisavel";
import {
  ArrowLeft, FileText, ClipboardList, Factory, Coins, Boxes, Package, ChevronRight,
} from "lucide-react";

const KPI = ({ icon: Icon, label, value, sub, testid }) => (
  <div data-testid={testid} className="bg-white border border-gray-200 rounded-sm p-4">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">
      <Icon size={14} /> {label}
    </div>
    <div className="text-xl font-bold text-gray-900 mt-2 tabular-nums">{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const Th = ({ children, align = "left" }) => (
  <th className={`text-${align} px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500`}>{children}</th>
);

export default function ArtigoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get(`/artigos/${id}/resumo`));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="text-sm text-gray-500">A carregar...</div>;
  if (!data) return <div className="text-sm text-gray-500">Artigo não encontrado.</div>;

  const { artigo: a, orcamentos, encomendas, ordens_fabrico, stats } = data;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <button data-testid="artigo-back-btn" onClick={() => nav("/artigos")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          <ArrowLeft size={16} /> Voltar aos artigos
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-sm p-5 lg:w-80 shrink-0">
          <div className="flex items-start gap-3">
            <ImagemUpload value={a.imagem} editable={false} size={56} testid="artigo-detail-imagem" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-gray-900 font-display" data-testid="artigo-nome">{a.nome}</h1>
              {a.descricao && <p className="text-sm text-gray-500 mt-0.5">{a.descricao}</p>}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-gray-500">Custo de produção</span><span className="tabular-nums font-medium">{eur(a.custo_producao_total)}</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-500">Margem</span><span className="tabular-nums text-gray-600">{a.margem ?? 0}%</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-500">Preço de venda</span><span className="tabular-nums font-bold text-emerald-700">{eur(a.preco_venda)}</span></div>
            <div className="flex items-center justify-between text-xs text-gray-400 pt-1"><span>{(a.materiais || []).length} materiais</span><span>{(a.roteiro || []).length} operações</span></div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KPI icon={FileText} label="Orçamentos" value={stats.num_orcamentos} sub={`${stats.qtd_orcada} un orçadas`} testid="artigo-kpi-orcamentos" />
          <KPI icon={ClipboardList} label="Encomendas" value={stats.num_encomendas} sub={`${stats.qtd_encomendada} un encomendadas`} testid="artigo-kpi-encomendas" />
          <KPI icon={Factory} label="Ordens de Fabrico" value={stats.num_ofs} sub={`${stats.qtd_produzida} un em produção`} testid="artigo-kpi-ofs" />
          <KPI icon={Package} label="Un. Encomendadas" value={stats.qtd_encomendada} testid="artigo-kpi-qtd-enc" />
          <KPI icon={Boxes} label="Un. em Produção" value={stats.qtd_produzida} testid="artigo-kpi-qtd-prod" />
          <KPI icon={Coins} label="Preço de Venda" value={eur(a.preco_venda)} testid="artigo-kpi-preco" />
        </div>
      </div>

      {/* Encomendas */}
      <SeccaoPesquisavel title="Encomendas" icon={ClipboardList} rows={encomendas} searchKeys={["numero", "cliente", "estado"]} placeholder="Pesquisar encomenda..." testid="artigo-encomendas">
        {(rows) => (
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <Th>Nº</Th><Th>Cliente</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="center">Pagamento</Th><Th align="right">Qtd</Th><Th align="right">Valor</Th><th className="w-8"></th>
              </tr></thead>
              <tbody data-testid="artigo-encomendas-table">
                {rows.map((e) => (
                  <tr key={e.id} data-testid={`artigo-encomenda-row-${e.id}`} onClick={() => nav(`/encomendas/${e.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{e.numero}</td>
                    <td className="px-4 py-3 text-gray-700">{e.cliente}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(e.data)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={e.estado} /></td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={e.status_pagamento} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{e.quantidade}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(e.valor_total)}</td>
                    <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">Sem encomendas.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </SeccaoPesquisavel>

      {/* Orçamentos */}
      <SeccaoPesquisavel title="Orçamentos" icon={FileText} rows={orcamentos} searchKeys={["numero", "cliente", "status"]} placeholder="Pesquisar orçamento..." testid="artigo-orcamentos">
        {(rows) => (
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <Th>Nº</Th><Th>Cliente</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="right">Qtd</Th><Th align="right">Total</Th><th className="w-8"></th>
              </tr></thead>
              <tbody data-testid="artigo-orcamentos-table">
                {rows.map((o) => (
                  <tr key={o.id} data-testid={`artigo-orcamento-row-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                    <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{o.quantidade}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(o.total)}</td>
                    <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem orçamentos.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </SeccaoPesquisavel>

      {/* Ordens de Fabrico */}
      <SeccaoPesquisavel title="Ordens de Fabrico" icon={Factory} rows={ordens_fabrico} searchKeys={["numero", "cliente", "status"]} placeholder="Pesquisar OF..." testid="artigo-ofs" className="mb-2">
        {(rows) => (
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <Th>Nº</Th><Th>Cliente</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="right">Qtd</Th><Th align="right">Progresso</Th><th className="w-8"></th>
              </tr></thead>
              <tbody data-testid="artigo-ofs-table">
                {rows.map((o) => (
                  <tr key={o.id} data-testid={`artigo-of-row-${o.id}`} onClick={() => nav(`/ordens-fabrico/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                    <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{o.quantidade}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                    <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem ordens de fabrico.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </SeccaoPesquisavel>

      <HistoricoTimeline tipo="artigo" id={id} />
    </div>
  );
}
