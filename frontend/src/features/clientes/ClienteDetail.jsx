import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import SeccaoPesquisavel from "@/components/SeccaoPesquisavel";
import { toast } from "sonner";
import {
  ArrowLeft, FileText, ClipboardList, Factory, Coins, Wallet, TrendingUp,
  Mail, Phone, MapPin, Hash, ChevronRight, Plus, User,
} from "lucide-react";

const KPI = ({ icon: Icon, label, value, sub, testid }) => (
  <div data-testid={testid} className="bg-white border border-gray-200 rounded-sm p-4 min-w-0 overflow-hidden">
    <div className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 leading-tight">
      <Icon size={14} className="shrink-0" /> {label}
    </div>
    <div className="text-lg sm:text-xl font-bold text-gray-900 mt-2 tabular-nums break-words">{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5 break-words">{sub}</div>}
  </div>
);

const Th = ({ children, align = "left" }) => (
  <th className={`text-${align} px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500`}>{children}</th>
);

const InfoLine = ({ icon: Icon, value }) =>
  value ? (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <Icon size={14} className="text-gray-400 shrink-0" /> {value}
    </div>
  ) : null;

export default function ClienteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [precos, setPrecos] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get(`/clientes/${id}/resumo`));
      setPrecos(await api.get(`/clientes/${id}/historico-precos`).catch(() => []));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="text-sm text-gray-500">A carregar...</div>;
  if (!data) return <div className="text-sm text-gray-500">Cliente não encontrado.</div>;

  const { cliente: c, orcamentos, encomendas, ordens_fabrico, stats } = data;
  const morada = [c.morada, c.codigo_postal, c.cidade, c.pais].filter(Boolean).join(", ");

  const novoOrcamento = async () => {
    const o = await api.post("/orcamentos", { cliente: c.nome, cliente_id: c.id, status: "rascunho", linhas: [] });
    toast.success("Orçamento criado");
    nav(`/orcamentos/${o.id}`);
  };
  const novaEncomenda = async () => {
    const enc = await api.post("/encomendas", { cliente: c.nome, cliente_id: c.id, descricao: "", prazo_entrega: "", notas: "" });
    toast.success("Encomenda criada");
    nav(`/encomendas/${enc.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <button data-testid="cliente-back-btn" onClick={() => nav("/clientes")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          <ArrowLeft size={16} /> Voltar aos clientes
        </button>
        <div className="flex items-center gap-2">
          {can("orcamentos", "create") && (
            <button data-testid="cliente-novo-orcamento-btn" onClick={novoOrcamento} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <FileText size={15} /> Novo Orçamento
            </button>
          )}
          {can("encomendas", "create") && (
            <button data-testid="cliente-nova-encomenda-btn" onClick={novaEncomenda} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Plus size={15} /> Nova Encomenda
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-sm p-5 lg:w-80 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 font-display" data-testid="cliente-nome">{c.nome}</h1>
          <p className="text-xs uppercase tracking-[0.1em] text-gray-500 mt-1" data-testid="cliente-tipo">
            {(c.tipo === "empresa" || (!c.tipo && c.nif)) ? "Empresa" : "Particular"}
          </p>
          <div className="mt-4 space-y-2">
            <InfoLine icon={Hash} value={c.codigo && `Código ${c.codigo}`} />
            <InfoLine icon={Hash} value={c.nif ? `NIF ${c.nif}` : ((c.tipo || "particular") !== "empresa" ? "Sem NIF" : null)} />
            <InfoLine icon={Phone} value={c.contacto} />
            <InfoLine icon={Mail} value={c.email} />
            <InfoLine icon={User} value={c.responsavel && `Responsável: ${c.responsavel}`} />
            <InfoLine icon={MapPin} value={morada} />
          </div>
          {c.notas && <p className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500 whitespace-pre-wrap">{c.notas}</p>}
        </div>

        <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KPI icon={FileText} label="Orçamentos" value={stats.num_orcamentos} sub={`${stats.orcamentos_aceites} aceites`} testid="kpi-orcamentos" />
          <KPI icon={ClipboardList} label="Encomendas" value={stats.num_encomendas} sub={`${stats.num_ofs} OFs`} testid="kpi-encomendas" />
          <KPI icon={Coins} label="Faturado" value={eur(stats.valor_faturado)} testid="kpi-faturado" />
          <KPI icon={Wallet} label="Pago" value={eur(stats.valor_pago)} sub={`Pendente: ${eur(stats.valor_pendente)}`} testid="kpi-pago" />
          <KPI icon={Coins} label="Custo Real" value={eur(stats.custo_real)} testid="kpi-custo" />
          <KPI icon={TrendingUp} label="Margem" value={eur(stats.margem)} testid="kpi-margem" />
        </div>
      </div>

      {/* Encomendas */}
      <SeccaoPesquisavel title="Encomendas" icon={ClipboardList} rows={encomendas} searchKeys={["numero", "estado", "status_pagamento"]} placeholder="Pesquisar encomenda..." testid="cliente-encomendas">
        {(rows) => (
        <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="border-b border-gray-200 bg-gray-50">
              <Th>Nº</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="center">Pagamento</Th>
              <Th align="right">Valor</Th><Th align="right">Pendente</Th><Th>Prazo</Th><th className="w-8"></th>
            </tr></thead>
            <tbody data-testid="cliente-encomendas-table">
              {rows.map((e) => (
                <tr key={e.id} data-testid={`cliente-encomenda-row-${e.id}`} onClick={() => nav(`/encomendas/${e.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{e.numero}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(e.data)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={e.estado} /></td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={e.status_pagamento} /></td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(e.valor_total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{eur(e.valor_pendente)}</td>
                  <td className="px-4 py-3 text-gray-600">{e.prazo_entrega ? fmtDate(e.prazo_entrega) : "—"}</td>
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
      <SeccaoPesquisavel title="Orçamentos" icon={FileText} rows={orcamentos} searchKeys={["numero", "status", "of_numero"]} placeholder="Pesquisar orçamento..." testid="cliente-orcamentos">
        {(rows) => (
        <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="border-b border-gray-200 bg-gray-50">
              <Th>Nº</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="right">Total</Th><Th>OF</Th><th className="w-8"></th>
            </tr></thead>
            <tbody data-testid="cliente-orcamentos-table">
              {rows.map((o) => (
                <tr key={o.id} data-testid={`cliente-orcamento-row-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(o.total)}</td>
                  <td className="px-4 py-3 text-gray-500 mono">{o.of_numero || "—"}</td>
                  <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">Sem orçamentos.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
      </SeccaoPesquisavel>

      {/* Ordens de Fabrico */}
      <SeccaoPesquisavel title="Ordens de Fabrico" icon={Factory} rows={ordens_fabrico} searchKeys={["numero", "status"]} placeholder="Pesquisar OF..." testid="cliente-ofs" className="mb-2">
        {(rows) => (
        <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead><tr className="border-b border-gray-200 bg-gray-50">
              <Th>Nº</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="right">Progresso</Th><th className="w-8"></th>
            </tr></thead>
            <tbody data-testid="cliente-ofs-table">
              {rows.map((o) => (
                <tr key={o.id} data-testid={`cliente-of-row-${o.id}`} onClick={() => nav(`/ordens-fabrico/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero} {o.prioritaria && <span className="text-red-600 text-xs font-semibold">· prioritária</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                  <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">Sem ordens de fabrico.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
      </SeccaoPesquisavel>

      <SeccaoPesquisavel
        title="Histórico de preços por artigo"
        icon={Coins}
        rows={precos}
        searchKeys={["artigo_nome"]}
        placeholder="Pesquisar artigo..."
        testid="cliente-historico-precos"
        className="mt-6"
      >
        {(rows) => (
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400">Sem preços registados em encomendas anteriores.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr><Th>Artigo</Th><Th align="right">Último preço</Th><Th align="right">Nº vezes</Th><Th align="right">Última encomenda</Th></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.artigo_id} data-testid={`preco-hist-${p.artigo_id}`} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 text-gray-900">{p.artigo_nome}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{eur(p.ultimo_preco)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{p.ocorrencias}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{fmtDate(p.ultima_data)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </SeccaoPesquisavel>

      <HistoricoTimeline tipo="cliente" id={id} />
    </div>
  );
}
