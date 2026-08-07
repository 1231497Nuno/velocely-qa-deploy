import { useCallback, useEffect, useMemo, useState } from "react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Boxes, FileText, Factory, TrendingUp, Wallet, Coins, ShieldAlert, CalendarClock, AlertTriangle } from "lucide-react";
import {
  Stat, PrazosBanner, EncValorCustoChart, PagamentoPie, MensalArea,
  OFEstadoChart, TempoChart, TempoCustoTotais, TopArtigosChart,
  Greeting, QuickActions, AttentionCenter, PorProduzirCard, RecentActivity, QuickAnalysis,
  FluxoMensalChart,
} from "@/features/dashboard/widgets";

export default function Dashboard() {
  const { user, isAdmin, can } = useAuth();
  const [d, setD] = useState(null);
  const [alertas, setAlertas] = useState({});

  const load = useCallback(async () => {
    const [dash, al] = await Promise.all([
      api.get("/dashboard"),
      api.get("/alertas").catch(() => ({})),
    ]);
    setD(dash);
    setAlertas(al || {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const seed = async () => { await api.post("/seed"); load(); };

  const canEnc = isAdmin || can("encomendas", "view");
  const canOrc = isAdmin || can("orcamentos", "view");
  const canArt = isAdmin || can("artigos", "view");
  const canOF = isAdmin || can("ordens_fabrico", "view");
  const canAnalise = isAdmin || can("analise_producao", "view");
  const canCal = isAdmin || can("calendario", "view");
  const canHist = isAdmin || can("historico", "view");
  const canOc = isAdmin || can("ordens_compra", "view");
  const canFluxo = canEnc || canOc;

  const derived = useMemo(() => {
    if (!d) return null;
    const tempo = d.tempo_por_of || [];
    const tEst = Math.round(tempo.reduce((s, t) => s + (t.estimado || 0), 0));
    const tReal = Math.round(tempo.reduce((s, t) => s + (t.real || 0), 0));
    return {
      pay: (d.encomendas_por_pagamento || []).filter((x) => x.count > 0),
      encValorCusto: d.enc_valor_vs_custo || [],
      ofData: d.ofs_por_estado || [],
      mensal: d.valor_mensal || [],
      top: d.top_artigos || [],
      fluxo: d.fluxo_mensal || null,
      ytd: d.ytd || null,
      tempo, tEst, tReal,
      desvioTempo: tReal - tEst,
      desvioCusto: Math.round(((d.custo_real_encomendas || 0) - (d.custo_estimado_encomendas || 0)) * 100) / 100,
    };
  }, [d]);

  const attentionItems = useMemo(() => {
    if (!d) return [];
    const items = [];
    if (canEnc) {
      items.push({ to: "/encomendas?semof=1", icon: AlertTriangle, count: alertas.encomendas_sem_of || 0, label: "Encomendas com artigos por produzir", tone: "red" });
      items.push({ to: "/encomendas", icon: ShieldAlert, count: d.encomendas_por_autorizar || 0, label: "Encomendas por autorizar", tone: "amber" });
      items.push({ to: "/encomendas", icon: Wallet, count: alertas.pagamentos_pendentes || 0, label: "Pagamentos pendentes", tone: "amber" });
    }
    if (canCal || canEnc) {
      items.push({ to: "/calendario", icon: CalendarClock, count: (alertas.prazos_atrasados ?? d.prazos_atrasadas) || 0, label: "Prazos atrasados", tone: "red" });
      items.push({ to: "/calendario", icon: CalendarClock, count: (alertas.prazos_proximos ?? d.prazos_proximos_7) || 0, label: "Prazos nos próximos 7 dias", tone: "amber" });
    }
    if (canOF) {
      items.push({ to: "/ordens-fabrico", icon: Factory, count: alertas.ofs_atrasadas || 0, label: "OFs atrasadas", tone: "red" });
      items.push({ to: "/ordens-fabrico", icon: Factory, count: d.ofs_em_producao || 0, label: "OFs em produção", tone: "blue" });
    }
    return items;
  }, [d, alertas, canEnc, canCal, canOF]);

  if (!d || !derived) return <div className="text-sm text-gray-500">A carregar...</div>;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <Greeting nome={user?.name} />
        {d.total_artigos === 0 && (
          <button data-testid="seed-btn" onClick={seed} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium transition-colors">Criar dados demo</button>
        )}
      </div>

      <QuickActions />

      {canFluxo && <FluxoMensalChart fluxo={derived.fluxo} />}

      <AttentionCenter items={attentionItems} />

      {canCal && <PrazosBanner atrasadas={d.prazos_atrasadas || 0} proximos7={d.prazos_proximos_7 || 0} />}

      {canEnc && <PorProduzirCard />}

      {/* KPIs principais (desde Janeiro) */}
      {canEnc && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
          <Stat
            icon={Wallet}
            label={`Vendas ${derived.ytd?.ano || ""}`}
            value={eur(derived.ytd?.vendas ?? d.valor_encomendas)}
            sub={`${derived.ytd?.encomendas ?? d.total_encomendas} encomendas · desde Jan`}
            tid="stat-valor-encomendas"
          />
          <Stat
            icon={Coins}
            label="Recebido / Pendente"
            value={eur(derived.ytd?.valor_pago ?? d.valor_pago_total)}
            sub={`Pendente ${eur(derived.ytd?.valor_pendente ?? d.valor_pendente_total)} · desde Jan`}
            accent="text-emerald-600"
            tid="stat-pago"
          />
          <Stat
            icon={Factory}
            label="Compras / despesas"
            value={eur(derived.ytd?.gastos ?? 0)}
            sub={`Resultado ${eur(derived.ytd?.resultado ?? 0)} · desde Jan`}
            tid="stat-custo-real"
          />
          <Stat
            icon={TrendingUp}
            label="Margem produção"
            value={eur(derived.ytd?.margem ?? d.margem_encomendas)}
            sub="Vendas − custo real · desde Jan"
            accent={(derived.ytd?.margem ?? d.margem_encomendas) >= 0 ? "text-emerald-600" : "text-red-600"}
            tid="stat-margem"
          />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        {canOF && <Stat icon={Factory} label="Ordens de Fabrico" value={d.total_ofs} sub={`${d.ofs_em_producao} em produção · ${d.ofs_concluidas} concluídas`} tid="stat-ofs" />}
        {canEnc && <Stat icon={ShieldAlert} label="Por Autorizar" value={d.encomendas_por_autorizar} sub="Encomendas sem produção autorizada" accent={d.encomendas_por_autorizar > 0 ? "text-amber-600" : "text-gray-900"} tid="stat-autorizar" />}
        {canOrc && <Stat icon={FileText} label="Orçamentos" value={d.total_orcamentos} sub={`${d.orcamentos_aceites} aceites · ${eur(d.valor_aceites)}`} tid="stat-orcamentos" />}
        {canArt && <Stat icon={Boxes} label="Artigos" value={d.total_artigos} sub={`Custo médio ${eur(d.custo_medio)}`} tid="stat-artigos" />}
      </div>

      {/* Análise rápida + Atividade */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {canEnc && <QuickAnalysis d={d} />}
        {canHist && <RecentActivity />}
      </div>

      {canEnc && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <EncValorCustoChart data={derived.encValorCusto} />
          <PagamentoPie data={derived.pay} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {canOrc && <MensalArea data={derived.mensal} />}
        {canOF && <OFEstadoChart data={derived.ofData} totalOfs={d.total_ofs} />}
      </div>

      {canAnalise && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <TempoChart data={derived.tempo} />
          <TempoCustoTotais tEst={derived.tEst} tReal={derived.tReal} desvioTempo={derived.desvioTempo} custoEst={d.custo_estimado_encomendas} custoReal={d.custo_real_encomendas} desvioCusto={derived.desvioCusto} />
        </div>
      )}

      {canArt && <TopArtigosChart data={derived.top} />}
    </div>
  );
}
