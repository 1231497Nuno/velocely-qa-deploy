import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import FicheirosTab from "@/components/FicheirosTab";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { toast } from "sonner";
import { Save, Trash2 } from "lucide-react";
import { NC_TIPOS } from "@/features/nao_conformidades/AbrirNaoConformidadeDialog";

const ESTADOS = [
  { id: "aberta", label: "Aberta" },
  { id: "em_analise", label: "Em análise" },
  { id: "fechada", label: "Fechada" },
];

export default function NaoConformidadeDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useDetailTab(["nc", "ficheiros", "historico"], "nc");
  const [nc, setNc] = useState(null);

  const load = useCallback(async () => {
    setNc(await api.get(`/nao-conformidades/${id}`));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!nc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setNc({ ...nc, ...patch });

  const save = async () => {
    try {
      const updated = await api.put(`/nao-conformidades/${id}`, {
        tipo: nc.tipo,
        descricao: nc.descricao,
        acao_corretiva: nc.acao_corretiva,
        estado: nc.estado,
        quantidade: Number(nc.quantidade) || 0,
        notas: nc.notas || "",
      });
      setNc(updated);
      toast.success("Não conformidade guardada");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    }
  };

  const remove = async () => {
    if (!window.confirm("Eliminar esta não conformidade?")) return;
    await api.del(`/nao-conformidades/${id}`);
    toast.success("Não conformidade eliminada");
    nav("/nao-conformidades");
  };

  const refLabel = [nc.artigo_codigo, nc.artigo_nome].filter(Boolean).join(" · ") || "—";

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/nao-conformidades")} testid="nc-back-btn" label="Voltar às não conformidades" />}
        title={nc.numero}
        badges={<StatusBadge status={nc.estado} testid="nc-estado-badge" />}
        subtitle={`Não conformidade · ${refLabel}`}
        actions={
          <>
            {can("nao_conformidades", "edit") && (
              <button data-testid="nc-save-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Save size={15} /> Guardar
              </button>
            )}
            {can("nao_conformidades", "delete") && (
              <button data-testid="nc-delete-btn" onClick={remove} className="bg-white text-red-700 border border-red-200 hover:bg-red-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Trash2 size={15} /> Eliminar
              </button>
            )}
          </>
        }
      />

      <DetailTabs
        testid="nc-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "nc", label: "Não conformidade", testid: "nc-tab-nc" },
          { id: "ficheiros", label: "Ficheiros", testid: "nc-tab-ficheiros" },
          { id: "historico", label: "Histórico", testid: "nc-tab-historico" },
        ]}
      />

      {tab === "nc" && (
        <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Referência</h3>
          <div className="text-sm space-y-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-400">Artigo</div>
              <div className="font-medium text-gray-900">{refLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-400">Encomenda</div>
              {nc.encomenda_id ? (
                <Link to={`/encomendas/${nc.encomenda_id}`} className="text-gray-900 hover:underline mono">{nc.encomenda_numero || "Encomenda"}</Link>
              ) : <span>—</span>}
              {nc.cliente ? <span className="text-gray-500"> · {nc.cliente}</span> : null}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-400">Aberta em</div>
              <div className="text-gray-700">{fmtDate(nc.created_at)}{nc.created_by_nome ? ` · ${nc.created_by_nome}` : ""}</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Tratamento</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Tipo</label>
              <select data-testid="nc-tipo" value={nc.tipo} onChange={(e) => upd({ tipo: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white">
                {NC_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Estado</label>
              <select data-testid="nc-estado" value={nc.estado} onChange={(e) => upd({ estado: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white">
                {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Quantidade afectada</label>
            <input data-testid="nc-qtd" type="number" min="0" step="0.01" value={nc.quantidade ?? 0} onChange={(e) => upd({ quantidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm p-5 mt-4 space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
          <textarea data-testid="nc-descricao" rows={4} value={nc.descricao || ""} onChange={(e) => upd({ descricao: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm resize-y" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Acção correctiva</label>
          <textarea data-testid="nc-acao" rows={3} value={nc.acao_corretiva || ""} onChange={(e) => upd({ acao_corretiva: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm resize-y" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Notas</label>
          <textarea data-testid="nc-notas" rows={2} value={nc.notas || ""} onChange={(e) => upd({ notas: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm resize-y" />
        </div>
      </div>
        </>
      )}

      {tab === "ficheiros" && (
        <FicheirosTab tipo="nao_conformidade" id={id} canEdit={can("nao_conformidades", "edit")} />
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="nao_conformidade" id={id} hideTitle />
      )}
    </div>
  );
}
