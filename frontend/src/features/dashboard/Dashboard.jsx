import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, eur } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import { Boxes, FileText, Factory, TrendingUp, Wallet, Coins, ShieldAlert } from "lucide-react";
import {
  Stat, PrazosBanner, EncValorCustoChart, PagamentoPie, MensalArea,
  OFEstadoChart, TempoChart, TempoCustoTotais, TopArtigosChart,
} from "@/features/dashboard/widgets";

export default function Dashboard() {
  const [d, setD] = useState(null);
  const load = useCallback(async () => setD(await api.get("/dashboard")), []);
  useEffect(() => { load(); }, [load]);
  const seed = async () => { await api.post("/seed"); load(); };

  const derived = useMemo(() => {
    if (!d) return null;
    const tempo = d.tempo_por_of || [];
    const tEst = Math.round(tempo.reduce((s, t) => s + (t.estimado || 0), 0));
    const tReal = Math.round(tempo.reduce((s, t) => s + (t.real || 0), 0));
    return {
      pay: (d.encomendas_por_pagamento || []).filter((x) => x.count > 0),
      encValorCusto: d.enc_valor_vs_custo || [],
      ofData: d.ofs_por_estado || [],
      mensal: (d.valor_mensal || []).map((m) => ({ ...m, label: m.mes.slice(5) + "/" + m.mes.slice(2, 4) })),
      top: d.top_artigos || [],
      tempo, tEst, tReal,
      desvioTempo: tReal - tEst,
      desvioCusto: Math.round(((d.custo_real_encomendas || 0) - (d.custo_estimado_encomendas || 0)) * 100) / 100,
    };
  }, [d]);

  if (!d || !derived) return <div className="text-sm text-gray-500">A carregar...</div>;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Encomendas, produção e rentabilidade"
        actions={d.total_artigos === 0 ? (
          <button data-testid="seed-btn" onClick={seed} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium transition-colors">Criar dados demo</button>
        ) : null}
      />

      {/* Encomendas KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat icon={Wallet} label="Valor Encomendas" value={eur(d.valor_encomendas)} sub={`${d.total_encomendas} encomendas`} tid="stat-valor-encomendas" />
        <Stat icon={Coins} label="Recebido / Pendente" value={eur(d.valor_pago_total)} sub={`Pendente ${eur(d.valor_pendente_total)}`} accent="text-emerald-600" tid="stat-pago" />
        <Stat icon={Factory} label="Custo Produção (real)" value={eur(d.custo_real_encomendas)} sub={`Estimado ${eur(d.custo_estimado_encomendas)}`} tid="stat-custo-real" />
        <Stat icon={TrendingUp} label="Margem Encomendas" value={eur(d.margem_encomendas)} sub="Valor − custo real" accent={d.margem_encomendas >= 0 ? "text-emerald-600" : "text-red-600"} tid="stat-margem" />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat icon={Factory} label="Ordens de Fabrico" value={d.total_ofs} sub={`${d.ofs_em_producao} em produção · ${d.ofs_concluidas} concluídas`} tid="stat-ofs" />
        <Stat icon={ShieldAlert} label="Por Autorizar" value={d.encomendas_por_autorizar} sub="Encomendas sem produção autorizada" accent={d.encomendas_por_autorizar > 0 ? "text-amber-600" : "text-gray-900"} tid="stat-autorizar" />
        <Stat icon={FileText} label="Orçamentos" value={d.total_orcamentos} sub={`${d.orcamentos_aceites} aceites · ${eur(d.valor_aceites)}`} tid="stat-orcamentos" />
        <Stat icon={Boxes} label="Artigos" value={d.total_artigos} sub={`Custo médio ${eur(d.custo_medio)}`} tid="stat-artigos" />
      </div>

      <PrazosBanner atrasadas={d.prazos_atrasadas || 0} proximos7={d.prazos_proximos_7 || 0} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <EncValorCustoChart data={derived.encValorCusto} />
        <PagamentoPie data={derived.pay} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <MensalArea data={derived.mensal} />
        <OFEstadoChart data={derived.ofData} totalOfs={d.total_ofs} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <TempoChart data={derived.tempo} />
        <TempoCustoTotais tEst={derived.tEst} tReal={derived.tReal} desvioTempo={derived.desvioTempo} custoEst={d.custo_estimado_encomendas} custoReal={d.custo_real_encomendas} desvioCusto={derived.desvioCusto} />
      </div>

      <TopArtigosChart data={derived.top} />

      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4">
        <Link to="/encomendas" data-testid="goto-encomendas" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver encomendas →</Link>
        <Link to="/orcamentos" data-testid="goto-orcamentos" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver orçamentos →</Link>
        <Link to="/ordens-fabrico" data-testid="goto-ofs" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver ordens de fabrico →</Link>
        <Link to="/analise-producao" className="text-sm font-medium text-gray-900 underline underline-offset-4">Ver análise da produção →</Link>
      </div>
    </div>
  );
}
