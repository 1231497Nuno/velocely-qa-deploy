import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import SeccaoPesquisavel from "@/components/SeccaoPesquisavel";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { toast } from "sonner";
import {
  ShoppingCart, Coins, Wallet, Package, Wrench, Layers,
  Mail, Phone, MapPin, Hash, ChevronRight, Plus, User, Globe, FileQuestion,
} from "lucide-react";

const TIPO_DESPESA_LABEL = {
  compra: "Compra",
  despesa_normal: "Despesa",
  despesa_diversa: "Despesa diversa",
};

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

export default function FornecedorDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useDetailTab(["fornecedor", "historico"], "fornecedor");
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get(`/fornecedores/${id}/resumo`));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="text-sm text-gray-500">A carregar...</div>;
  if (!data) return <div className="text-sm text-gray-500">Fornecedor não encontrado.</div>;

  const { fornecedor: f, ordens_compra: ordens, stats } = data;
  const morada = [f.morada, f.codigo_postal, f.cidade, f.pais].filter(Boolean).join(", ");

  const novaOc = async () => {
    try {
      const oc = await api.post("/ordens-compra", {
        assunto: "",
        fornecedor_id: f.id,
        fornecedor_nome: f.nome,
        tipo_despesa: "compra",
        estado: "criada",
        linhas: [],
      });
      toast.success("Ordem de compra criada");
      nav(`/ordens-compra/${oc.id}`, { state: { edit: true } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao criar ordem");
    }
  };

  const novoPedidoCotacao = async () => {
    try {
      const pc = await api.post("/pedidos-cotacao", {
        assunto: "",
        fornecedor_id: f.id,
        fornecedor_nome: f.nome,
        estado: "rascunho",
        linhas: [],
      });
      toast.success("Pedido de cotação criado");
      nav(`/pedidos-cotacao/${pc.id}`, { state: { edit: true } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao criar pedido");
    }
  };

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/fornecedores")} testid="fornecedor-back-btn" label="Voltar aos fornecedores" />}
        title={<h1 className="text-lg sm:text-xl font-bold tracking-tight font-display" data-testid="fornecedor-nome">{f.nome}</h1>}
        subtitle={`${(f.tipo === "empresa" || (!f.tipo && f.nif)) ? "Empresa" : "Particular"}${f.categoria ? ` · ${f.categoria}` : ""}`}
        actions={
          <>
            {can("pedidos_cotacao", "create") && (
              <button data-testid="fornecedor-nova-pc-btn" onClick={novoPedidoCotacao} className="border border-gray-300 text-gray-800 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <FileQuestion size={15} /> Novo pedido de cotação
              </button>
            )}
            {can("ordens_compra", "create") && (
              <button data-testid="fornecedor-nova-oc-btn" onClick={novaOc} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <Plus size={15} /> Nova Ordem de Compra
              </button>
            )}
          </>
        }
      />

      <DetailTabs
        testid="fornecedor-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "fornecedor", label: "Fornecedor", testid: "fornecedor-tab-fornecedor" },
          { id: "historico", label: "Histórico", testid: "fornecedor-tab-historico" },
        ]}
      />

      {tab === "fornecedor" && (
        <>
      <div className="flex flex-col lg:flex-row gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-sm p-5 lg:w-80 shrink-0">
          <div className="text-xs uppercase tracking-[0.1em] text-gray-500" data-testid="fornecedor-tipo">
            {(f.tipo === "empresa" || (!f.tipo && f.nif)) ? "Empresa" : "Particular"}
            {f.categoria ? ` · ${f.categoria}` : ""}
          </div>
          <div className="mt-3 space-y-2">
            <InfoLine icon={Hash} value={f.codigo && `Código ${f.codigo}`} />
            <InfoLine icon={Hash} value={f.nif ? `NIF ${f.nif}` : null} />
            <InfoLine icon={Phone} value={f.contacto} />
            <InfoLine icon={Mail} value={f.email} />
            <InfoLine icon={Globe} value={f.website} />
            <InfoLine icon={User} value={f.responsavel && `Responsável: ${f.responsavel}`} />
            <InfoLine icon={MapPin} value={morada} />
          </div>
          {f.notas && <p className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500 whitespace-pre-wrap">{f.notas}</p>}
        </div>

        <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KPI icon={ShoppingCart} label="Ordens de compra" value={stats.num_ordens} sub={`${stats.recebidas} recebidas`} testid="kpi-ocs" />
          <KPI icon={Coins} label="Total" value={eur(stats.total)} testid="kpi-total" />
          <KPI icon={Wallet} label="Pago" value={eur(stats.valor_pago)} sub={`Pendente: ${eur(stats.pendente)}`} testid="kpi-pago" />
          <KPI icon={Package} label="Compra" value={eur(stats.compra)} testid="kpi-compra" />
          <KPI icon={Wrench} label="Despesa" value={eur(stats.despesa_normal)} testid="kpi-despesa-normal" />
          <KPI icon={Layers} label="Despesa diversa" value={eur(stats.despesa_diversa)} testid="kpi-despesa-diversa" />
        </div>
      </div>

      <SeccaoPesquisavel
        title="Ordens de compra / despesas"
        icon={ShoppingCart}
        rows={ordens}
        searchKeys={["codigo", "codigo_origem", "assunto", "tipo_compra", "tipo_despesa", "estado"]}
        placeholder="Pesquisar pelo início do código ou assunto..."
        testid="fornecedor-ocs"
        className="mb-2"
      >
        {(rows) => (
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <Th>Nº</Th><Th>Data</Th><Th>Assunto</Th><Th>Tipo</Th>
                <Th align="center">Estado</Th><Th align="right">Total</Th><th className="w-8"></th>
              </tr></thead>
              <tbody data-testid="fornecedor-ocs-table">
                {rows.map((o) => (
                  <tr key={o.id} data-testid={`fornecedor-oc-row-${o.id}`} onClick={() => nav(`/ordens-compra/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.codigo}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                    <td className="px-4 py-3 text-gray-800">{o.assunto || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      <div>{TIPO_DESPESA_LABEL[o.tipo_despesa] || o.tipo_despesa}</div>
                      {o.tipo_compra && <div className="text-gray-400">{o.tipo_compra}</div>}
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={o.estado} /></td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(o.total)}</td>
                    <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem ordens de compra.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </SeccaoPesquisavel>
        </>
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="fornecedor" id={id} hideTitle />
      )}
    </div>
  );
}
