import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Columns3, List, SlidersHorizontal } from "lucide-react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import { ListPage } from "@/components/ListPage";
import CrmBoard from "./CrmBoard";
import CrmLista from "./CrmLista";
import LeadSheet from "./LeadSheet";
import EstadosDialog from "./EstadosDialog";
import { apiError, btnPrimary, btnSecondary, gravarVista, lerVista, acaoAtrasada } from "./crmShared";

const selectCls =
  "border border-gray-300 rounded-sm px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20";

export default function Crm() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [estados, setEstados] = useState([]);
  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState({ origens: [], cores: [], responsaveis: [] });
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState(lerVista());
  const [q, setQ] = useState("");
  const [origem, setOrigem] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [sheet, setSheet] = useState({ open: false, leadId: null, estadoId: null });
  const [estadosOpen, setEstadosOpen] = useState(false);
  const pedido = useRef(0);

  const carregarEstados = useCallback(async () => {
    setEstados(await api.get("/crm/estados"));
  }, []);

  const carregarLeads = useCallback(async () => {
    const id = ++pedido.current;
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (origem) qs.set("origem", origem);
    if (responsavel) qs.set("responsavel_id", responsavel);
    try {
      const data = await api.get(`/crm/leads${qs.toString() ? `?${qs}` : ""}`);
      if (id === pedido.current) setLeads(data);
    } catch (e) {
      toast.error(apiError(e, "Não foi possível carregar os leads"));
    }
  }, [q, origem, responsavel]);

  useEffect(() => {
    (async () => {
      try {
        const [m] = await Promise.all([api.get("/crm/meta"), carregarEstados()]);
        setMeta(m);
      } catch (e) {
        toast.error(apiError(e, "Não foi possível carregar o CRM"));
      }
    })();
  }, [carregarEstados]);

  useEffect(() => {
    const t = setTimeout(() => { carregarLeads().finally(() => setLoading(false)); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [carregarLeads, q]);

  // Abrir um lead diretamente: /crm?lead=<id>
  useEffect(() => {
    const lid = params.get("lead");
    if (lid) setSheet({ open: true, leadId: lid, estadoId: null });
  }, [params]);

  function abrir(leadId) {
    setSheet({ open: true, leadId, estadoId: null });
  }

  function fecharSheet(open) {
    if (open) return;
    setSheet((s) => ({ ...s, open: false }));
    if (params.get("lead")) {
      params.delete("lead");
      setParams(params, { replace: true });
    }
  }

  async function mover(leadId, estadoId, antesDeId) {
    const anterior = leads;
    // Atualização otimista: reposiciona o cartão localmente
    setLeads((ls) => {
      const lead = ls.find((l) => l.id === leadId);
      if (!lead) return ls;
      const est = estados.find((e) => e.id === estadoId) || {};
      const resto = ls.filter((l) => l.id !== leadId);
      const naColuna = resto.filter((l) => l.estado_id === estadoId);
      let ordem;
      if (antesDeId) {
        const i = naColuna.findIndex((l) => l.id === antesDeId);
        const alvo = naColuna[i]?.ordem ?? 0;
        const prev = i > 0 ? naColuna[i - 1].ordem : alvo - 2000;
        ordem = (prev + alvo) / 2;
      } else {
        ordem = (naColuna.length ? naColuna[naColuna.length - 1].ordem : 0) + 1000;
      }
      const atualizado = { ...lead, estado_id: estadoId, ordem, estado_nome: est.nome, estado_cor: est.cor, estado_tipo: est.tipo };
      return [...resto, atualizado].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    });
    try {
      await api.post(`/crm/leads/${leadId}/mover`, { estado_id: estadoId, antes_de_id: antesDeId });
      if (anterior.find((l) => l.id === leadId)?.estado_id !== estadoId) carregarEstados();
    } catch (e) {
      setLeads(anterior);
      toast.error(apiError(e, "Não foi possível mover o lead"));
    }
  }

  function onLeadChanged(lead, opts = {}) {
    carregarLeads();
    carregarEstados();
    if (opts.criado) setSheet({ open: true, leadId: lead.id, estadoId: null });
  }

  const resumo = useMemo(() => {
    const tipo = Object.fromEntries(estados.map((e) => [e.id, e.tipo]));
    const abertos = leads.filter((l) => tipo[l.estado_id] === "aberto");
    return {
      abertos: abertos.length,
      pipeline: abertos.reduce((s, l) => s + (Number(l.valor_estimado) || 0), 0),
      atrasados: leads.filter(acaoAtrasada).length,
    };
  }, [leads, estados]);

  const trocarVista = (v) => { setVista(v); gravarVista(v); };
  const origensDisponiveis = useMemo(
    () => [...new Set([...(meta.origens || []), ...leads.map((l) => l.origem).filter(Boolean)])],
    [meta.origens, leads]
  );

  const vistaBtn = (key, Icon, label) => (
    <button
      type="button"
      onClick={() => trocarVista(key)}
      data-testid={`crm-view-${key}`}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm ${vista === key ? "bg-brand text-brand-fg" : "bg-white text-gray-700 hover:bg-gray-50"}`}
    >
      <Icon size={15} /> <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <ListPage
      header={
        <PageHeader
          title="CRM"
          subtitle={`${resumo.abertos} em aberto · ${eur(resumo.pipeline)} em negociação${resumo.atrasados ? ` · ${resumo.atrasados} com ação em atraso` : ""}`}
          actions={
            <>
              {(can("crm", "edit") || can("crm", "delete")) && (
                <button type="button" className={btnSecondary} onClick={() => setEstadosOpen(true)} data-testid="crm-estados-btn">
                  <SlidersHorizontal size={15} /> <span className="hidden sm:inline">Estados</span>
                </button>
              )}
              {can("crm", "create") && (
                <button type="button" className={btnPrimary} onClick={() => setSheet({ open: true, leadId: null, estadoId: null })} data-testid="crm-new-lead">
                  <Plus size={16} /> Novo lead
                </button>
              )}
            </>
          }
        />
      }
      toolbar={
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do nome, empresa, telefone ou email..." testid="crm-search" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <select className={selectCls} value={origem} onChange={(e) => setOrigem(e.target.value)} data-testid="crm-filter-origem">
              <option value="">Todas as origens</option>
              {origensDisponiveis.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {(meta.responsaveis || []).length > 1 && (
              <select className={selectCls} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} data-testid="crm-filter-responsavel">
                <option value="">Todos os responsáveis</option>
                {meta.responsaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            )}
            <div className="inline-flex rounded-sm border border-gray-300 overflow-hidden">
              {vistaBtn("quadro", Columns3, "Quadro")}
              {vistaBtn("lista", List, "Lista")}
            </div>
          </div>
        </div>
      }
    >
      {loading && !leads.length ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500">A carregar...</div>
      ) : vista === "quadro" ? (
        <CrmBoard
          estados={estados}
          leads={leads}
          onOpen={abrir}
          onNew={(estadoId) => setSheet({ open: true, leadId: null, estadoId })}
          onMove={mover}
          canEdit={can("crm", "edit")}
          canCreate={can("crm", "create")}
        />
      ) : (
        <CrmLista estados={estados} leads={leads} onOpen={abrir} />
      )}

      <LeadSheet
        open={sheet.open}
        onOpenChange={fecharSheet}
        leadId={sheet.leadId}
        novoEstadoId={sheet.estadoId}
        estados={estados}
        meta={meta}
        onChanged={onLeadChanged}
        onDeleted={() => { carregarLeads(); carregarEstados(); }}
      />
      <EstadosDialog
        open={estadosOpen}
        onOpenChange={setEstadosOpen}
        estados={estados}
        cores={meta.cores}
        onChanged={async () => { await carregarEstados(); await carregarLeads(); }}
      />
    </ListPage>
  );
}
