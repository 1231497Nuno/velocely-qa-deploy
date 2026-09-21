import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import BlocosShell, { FieldGrid, FieldRow } from "@/components/BlocosShell";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { toast } from "sonner";
import {
  FileText, ClipboardList, Factory, Coins, Wallet, TrendingUp,
  Plus, Pencil, Trash2, ChevronRight,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const CONDICOES_PAGAMENTO = [
  "", "Pronto pagamento", "15 dias", "30 dias", "45 dias", "60 dias", "90 dias",
];

const CLI_BLOCOS = [
  { id: "identificacao", label: "Identificação" },
  { id: "morada", label: "Morada e contacto" },
  { id: "financeiro", label: "Dados financeiros" },
  { id: "contactos", label: "Contactos" },
  { id: "encomendas", label: "Encomendas" },
  { id: "orcamentos", label: "Orçamentos" },
  { id: "ofs", label: "Ordens de fabrico" },
  { id: "precos", label: "Histórico de preços" },
];

const emptyContacto = () => ({
  id: crypto.randomUUID?.() || `c-${Date.now()}`,
  nome: "",
  cargo: "",
  email: "",
  telefone: "",
  departamento: "",
  notas: "",
  ativo: true,
});

const KPI = ({ icon: Icon, label, value, sub, testid }) => (
  <div data-testid={testid} className="bg-white border border-gray-200 rounded-sm p-4 min-w-0 overflow-hidden">
    <div className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 leading-tight">
      <Icon size={14} className="shrink-0" /> {label}
    </div>
    <div className="text-lg sm:text-xl font-bold text-gray-900 mt-2 tabular-nums break-words">{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5 break-words">{sub}</div>}
  </div>
);

const Th = ({ children, align = "left", className = "" }) => (
  <th className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className}`}>
    {children}
  </th>
);

const inputCls = "w-full max-w-[18rem] border border-gray-300 rounded-sm px-2 py-1 text-sm text-right bg-white focus:outline-none focus:ring-1 focus:ring-black/20";

function apiDetail(e) {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return typeof d === "string" ? d : null;
}

function clientePayload(c) {
  return {
    nome: c.nome || "",
    tipo: c.tipo || "empresa",
    morada: c.morada || "",
    codigo_postal: c.codigo_postal || "",
    cidade: c.cidade || "",
    pais: c.pais || "Portugal",
    contacto: c.contacto || "",
    email: c.email || "",
    nif: c.nif || "",
    notas: c.notas || "",
    responsavel: c.responsavel || "",
    condicoes_pagamento: c.condicoes_pagamento || "",
    desconto_comercial_pct: c.desconto_comercial_pct == null || c.desconto_comercial_pct === "" ? null : Number(c.desconto_comercial_pct),
    limite_credito: c.limite_credito == null || c.limite_credito === "" ? null : Number(c.limite_credito),
    contactos: (c.contactos || []).map((ct) => ({
      id: ct.id,
      nome: (ct.nome || "").trim(),
      cargo: (ct.cargo || "").trim(),
      email: (ct.email || "").trim(),
      telefone: (ct.telefone || "").trim(),
      departamento: (ct.departamento || "").trim(),
      notas: (ct.notas || "").trim(),
      ativo: ct.ativo !== false,
    })),
    sistema: !!c.sistema,
    is_default: !!c.is_default,
  };
}

export default function ClienteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useDetailTab(["cliente", "historico"], "cliente");
  const [data, setData] = useState(null);
  const [precos, setPrecos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contactoOpen, setContactoOpen] = useState(false);
  const [contactoForm, setContactoForm] = useState(emptyContacto());
  const [contactoEditId, setContactoEditId] = useState(null);

  const canEdit = can("clientes", "edit");

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
  const empresa = c && (c.tipo === "empresa" || (!c.tipo && c.nif));
  const contactos = c.contactos || [];
  const moradaCompleta = [c.morada, c.codigo_postal, c.cidade, c.pais].filter(Boolean).join(", ");

  const saveCliente = async (patch, msg) => {
    try {
      const updated = await api.put(`/clientes/${id}`, clientePayload({ ...c, ...patch }));
      setData((d) => ({ ...d, cliente: { ...c, ...updated } }));
      if (msg) toast.success(msg);
      return updated;
    } catch (e) {
      toast.error(apiDetail(e) || "Erro ao guardar");
      throw e;
    }
  };

  const persistField = (patch, msg) => saveCliente(patch, msg).catch(() => {});

  const openNewContacto = () => {
    setContactoForm(emptyContacto());
    setContactoEditId(null);
    setContactoOpen(true);
  };

  const openEditContacto = (ct) => {
    setContactoForm({
      id: ct.id,
      nome: ct.nome || "",
      cargo: ct.cargo || "",
      email: ct.email || "",
      telefone: ct.telefone || "",
      departamento: ct.departamento || "",
      notas: ct.notas || "",
      ativo: ct.ativo !== false,
    });
    setContactoEditId(ct.id);
    setContactoOpen(true);
  };

  const saveContacto = async () => {
    if (!(contactoForm.nome || "").trim()) return toast.error("Nome do contacto obrigatório");
    const next = contactoEditId
      ? contactos.map((ct) => (ct.id === contactoEditId ? { ...contactoForm } : ct))
      : [...contactos, { ...contactoForm }];
    await saveCliente({ contactos: next }, "Contacto guardado");
    setContactoOpen(false);
  };

  const removeContacto = async (ct) => {
    if (!window.confirm(`Eliminar contacto «${ct.nome}»?`)) return;
    await saveCliente({ contactos: contactos.filter((x) => x.id !== ct.id) }, "Contacto eliminado");
  };

  const novoOrcamento = async () => {
    const body = { cliente: c.nome, cliente_id: c.id, status: "rascunho", linhas: [] };
    if (c.desconto_comercial_pct != null && Number(c.desconto_comercial_pct) > 0) {
      body.desconto_total = Number(c.desconto_comercial_pct);
      body.desconto_total_tipo = "pct";
    }
    const o = await api.post("/orcamentos", body);
    toast.success("Rascunho criado");
    nav(`/orcamentos/${o.id}`);
  };
  const novaEncomenda = async () => {
    const enc = await api.post("/encomendas", { cliente: c.nome, cliente_id: c.id, descricao: "", prazo_entrega: "", notas: "" });
    toast.success("Encomenda criada");
    nav(`/encomendas/${enc.id}`);
  };

  const visibleIds = [
    "identificacao",
    "morada",
    ...(empresa ? ["financeiro", "contactos"] : []),
    "encomendas",
    "orcamentos",
    ...(can("ordens_fabrico", "view") ? ["ofs"] : []),
    "precos",
  ];

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/clientes")} testid="cliente-back-btn" label="Voltar aos clientes" />}
        title={<h1 className="text-lg sm:text-xl font-bold tracking-tight font-display" data-testid="cliente-nome">{c.nome}</h1>}
        subtitle={empresa ? "Empresa" : "Particular"}
        actions={
          <>
            {can("orcamentos", "create") && (
              <button data-testid="cliente-novo-orcamento-btn" onClick={novoOrcamento} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <FileText size={15} /> Novo Orçamento
              </button>
            )}
            {can("encomendas", "create") && (
              <button data-testid="cliente-nova-encomenda-btn" onClick={novaEncomenda} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <Plus size={15} /> Nova Encomenda
              </button>
            )}
          </>
        }
      />

      <DetailTabs
        testid="cliente-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "cliente", label: "Cliente", testid: "cliente-tab-cliente" },
          { id: "historico", label: "Histórico", testid: "cliente-tab-historico" },
        ]}
      />

      {tab === "cliente" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <KPI icon={FileText} label="Orçamentos" value={stats.num_orcamentos} sub={`${stats.orcamentos_aceites} ganhos`} testid="kpi-orcamentos" />
            <KPI icon={ClipboardList} label="Encomendas" value={stats.num_encomendas} sub={can("ordens_fabrico", "view") ? `${stats.num_ofs} OFs` : undefined} testid="kpi-encomendas" />
            <KPI icon={Coins} label="Faturado" value={eur(stats.valor_faturado)} testid="kpi-faturado" />
            <KPI icon={Wallet} label="Pago" value={eur(stats.valor_pago)} sub={`Pendente: ${eur(stats.valor_pendente)}`} testid="kpi-pago" />
            <KPI icon={Coins} label="Custo Real" value={eur(stats.custo_real)} testid="kpi-custo" />
            <KPI icon={TrendingUp} label="Margem" value={eur(stats.margem)} testid="kpi-margem" />
          </div>

          <BlocosShell
            testid="cliente-blocos"
            storageKey="cliente-detail-blocos-v1"
            blocks={CLI_BLOCOS}
            visibleIds={visibleIds}
            renderBlock={(blocoId) => {
              if (blocoId === "identificacao") {
                return (
                  <FieldGrid>
                    <FieldRow label="Tipo" testid="cli-campo-tipo">
                      <span>{empresa ? "Empresa" : "Particular"}</span>
                    </FieldRow>
                    <FieldRow label="Código" testid="cli-campo-codigo">
                      <span className="tabular-nums mono">{c.codigo || "—"}</span>
                    </FieldRow>
                    <FieldRow label="Nome" testid="cli-campo-nome" full>
                      {canEdit && !c.sistema ? (
                        <input
                          data-testid="cli-nome-input"
                          value={c.nome || ""}
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, nome: e.target.value } }))}
                          onBlur={() => persistField({ nome: c.nome }, "Nome actualizado")}
                          className={inputCls + " max-w-md"}
                        />
                      ) : (
                        <span className="truncate" title={c.nome}>{c.nome}</span>
                      )}
                    </FieldRow>
                    <FieldRow label="NIF" testid="cli-campo-nif">
                      {canEdit && !c.sistema ? (
                        <input
                          data-testid="cli-nif-input"
                          value={c.nif || ""}
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, nif: e.target.value } }))}
                          onBlur={() => persistField({ nif: c.nif })}
                          className={inputCls + " tabular-nums"}
                        />
                      ) : (
                        <span className="tabular-nums mono">{c.nif || "—"}</span>
                      )}
                    </FieldRow>
                    <FieldRow label="Responsável" testid="cli-campo-responsavel">
                      {canEdit ? (
                        <input
                          data-testid="cli-responsavel-input"
                          value={c.responsavel || ""}
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, responsavel: e.target.value } }))}
                          onBlur={() => persistField({ responsavel: c.responsavel })}
                          className={inputCls}
                        />
                      ) : (
                        <span className="truncate">{c.responsavel || "—"}</span>
                      )}
                    </FieldRow>
                    <FieldRow label="Notas" testid="cli-campo-notas" full>
                      {canEdit ? (
                        <textarea
                          data-testid="cli-notas-input"
                          value={c.notas || ""}
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, notas: e.target.value } }))}
                          onBlur={() => persistField({ notas: c.notas })}
                          rows={2}
                          className="w-full max-w-lg border border-gray-300 rounded-sm px-2 py-1 text-sm text-left bg-white focus:outline-none focus:ring-1 focus:ring-black/20"
                        />
                      ) : (
                        <span className="text-left whitespace-pre-wrap font-normal text-gray-600">{c.notas || "—"}</span>
                      )}
                    </FieldRow>
                  </FieldGrid>
                );
              }

              if (blocoId === "morada") {
                return (
                  <FieldGrid>
                    <FieldRow label="Morada" testid="cli-campo-morada" full>
                      {canEdit ? (
                        <input
                          data-testid="cli-morada-input"
                          value={c.morada || ""}
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, morada: e.target.value } }))}
                          onBlur={() => persistField({ morada: c.morada })}
                          className={inputCls + " max-w-md"}
                        />
                      ) : (
                        <span className="truncate" title={moradaCompleta}>{c.morada || "—"}</span>
                      )}
                    </FieldRow>
                    <FieldRow label="Código postal" testid="cli-campo-cp">
                      {canEdit ? (
                        <input data-testid="cli-cp-input" value={c.codigo_postal || ""} onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, codigo_postal: e.target.value } }))} onBlur={() => persistField({ codigo_postal: c.codigo_postal })} className={inputCls} />
                      ) : <span>{c.codigo_postal || "—"}</span>}
                    </FieldRow>
                    <FieldRow label="Cidade" testid="cli-campo-cidade">
                      {canEdit ? (
                        <input data-testid="cli-cidade-input" value={c.cidade || ""} onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, cidade: e.target.value } }))} onBlur={() => persistField({ cidade: c.cidade })} className={inputCls} />
                      ) : <span>{c.cidade || "—"}</span>}
                    </FieldRow>
                    <FieldRow label="País" testid="cli-campo-pais">
                      {canEdit ? (
                        <input data-testid="cli-pais-input" value={c.pais || ""} onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, pais: e.target.value } }))} onBlur={() => persistField({ pais: c.pais })} className={inputCls} />
                      ) : <span>{c.pais || "—"}</span>}
                    </FieldRow>
                    <FieldRow label="Telefone / contacto" testid="cli-campo-contacto">
                      {canEdit ? (
                        <input data-testid="cli-contacto-input" value={c.contacto || ""} onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, contacto: e.target.value } }))} onBlur={() => persistField({ contacto: c.contacto })} className={inputCls} />
                      ) : <span>{c.contacto || "—"}</span>}
                    </FieldRow>
                    <FieldRow label="Email" testid="cli-campo-email">
                      {canEdit ? (
                        <input data-testid="cli-email-input" value={c.email || ""} onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, email: e.target.value } }))} onBlur={() => persistField({ email: c.email })} className={inputCls} />
                      ) : <span className="truncate" title={c.email}>{c.email || "—"}</span>}
                    </FieldRow>
                  </FieldGrid>
                );
              }

              if (blocoId === "financeiro") {
                return (
                  <FieldGrid>
                    <FieldRow label="Condições de pagamento" testid="cli-campo-condicoes">
                      {canEdit ? (
                        <select
                          data-testid="cli-condicoes-input"
                          value={c.condicoes_pagamento || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setData((d) => ({ ...d, cliente: { ...c, condicoes_pagamento: v } }));
                            persistField({ condicoes_pagamento: v }, "Condições actualizadas");
                          }}
                          className={inputCls}
                        >
                          {CONDICOES_PAGAMENTO.map((opt) => (
                            <option key={opt || "vazio"} value={opt}>{opt || "—"}</option>
                          ))}
                        </select>
                      ) : <span>{c.condicoes_pagamento || "—"}</span>}
                    </FieldRow>
                    <FieldRow label="Desconto comercial %" testid="cli-campo-desconto">
                      {canEdit ? (
                        <input
                          data-testid="cli-desconto-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.desconto_comercial_pct ?? ""}
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, desconto_comercial_pct: e.target.value === "" ? null : e.target.value } }))}
                          onBlur={() => persistField({ desconto_comercial_pct: c.desconto_comercial_pct === "" ? null : c.desconto_comercial_pct })}
                          className={inputCls + " tabular-nums"}
                        />
                      ) : (
                        <span className="tabular-nums">{c.desconto_comercial_pct != null ? `${c.desconto_comercial_pct} %` : "—"}</span>
                      )}
                    </FieldRow>
                    <FieldRow label="Limite de crédito" testid="cli-campo-credito" full>
                      {canEdit ? (
                        <input
                          data-testid="cli-credito-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.limite_credito ?? ""}
                          placeholder="Sem limite"
                          onChange={(e) => setData((d) => ({ ...d, cliente: { ...c, limite_credito: e.target.value === "" ? null : e.target.value } }))}
                          onBlur={() => persistField({ limite_credito: c.limite_credito === "" ? null : c.limite_credito })}
                          className={inputCls + " tabular-nums"}
                        />
                      ) : (
                        <span className="tabular-nums">{c.limite_credito != null ? eur(c.limite_credito) : "Sem limite"}</span>
                      )}
                    </FieldRow>
                  </FieldGrid>
                );
              }

              if (blocoId === "contactos") {
                return (
                  <div data-testid="cliente-contactos-panel">
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100">
                      <span className="text-xs tabular-nums text-gray-400">{contactos.length} contacto(s)</span>
                      {canEdit && (
                        <button type="button" data-testid="cliente-contacto-add-btn" onClick={openNewContacto} className="text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center gap-1.5">
                          <Plus size={14} /> Novo contacto
                        </button>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[720px]">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <Th className="w-[18%]">Nome</Th>
                            <Th className="w-[16%]">Cargo</Th>
                            <Th className="w-[14%]">Departamento</Th>
                            <Th className="w-[20%]">Email</Th>
                            <Th className="w-[12%]">Telefone</Th>
                            <Th className="w-[10%]" align="center">Estado</Th>
                            <Th className="w-[10%]" />
                          </tr>
                        </thead>
                        <tbody data-testid="cliente-contactos-table">
                          {contactos.map((ct) => (
                            <tr key={ct.id} data-testid={`cliente-contacto-row-${ct.id}`} className="border-b border-gray-100 last:border-0">
                              <td className="px-4 py-2.5 font-medium text-gray-900 truncate max-w-[10rem]" title={ct.nome}>{ct.nome}</td>
                              <td className="px-4 py-2.5 text-gray-600 truncate max-w-[9rem]" title={ct.cargo}>{ct.cargo || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600 truncate max-w-[8rem]" title={ct.departamento}>{ct.departamento || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600 truncate max-w-[12rem]" title={ct.email}>{ct.email || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{ct.telefone || "—"}</td>
                              <td className="px-4 py-2.5 text-center text-gray-600 text-xs">{ct.ativo === false ? "Inactivo" : "Activo"}</td>
                              <td className="px-4 py-2.5">
                                {canEdit && (
                                  <div className="flex items-center justify-end gap-1">
                                    <button type="button" data-testid={`edit-contacto-${ct.id}`} onClick={() => openEditContacto(ct)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>
                                    <button type="button" data-testid={`delete-contacto-${ct.id}`} onClick={() => removeContacto(ct)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                          {contactos.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem contactos. Adicione pessoas desta empresa.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              }

              if (blocoId === "encomendas") {
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <Th className="w-[12%]">Nº</Th>
                          <Th className="w-[12%]">Data</Th>
                          <Th className="w-[14%]" align="center">Estado</Th>
                          <Th className="w-[14%]" align="center">Pagamento</Th>
                          <Th className="w-[14%]" align="right">Valor</Th>
                          <Th className="w-[14%]" align="right">Pendente</Th>
                          <Th className="w-[14%]">Prazo</Th>
                          <Th className="w-8" />
                        </tr>
                      </thead>
                      <tbody data-testid="cliente-encomendas-table">
                        {encomendas.map((e) => (
                          <tr key={e.id} data-testid={`cliente-encomenda-row-${e.id}`} onClick={() => nav(`/encomendas/${e.id}`)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer last:border-0">
                            <td className="px-4 py-2.5 mono tabular-nums font-medium text-gray-900 whitespace-nowrap">{e.numero}</td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{fmtDate(e.data)}</td>
                            <td className="px-4 py-2.5 text-center"><StatusBadge status={e.estado} /></td>
                            <td className="px-4 py-2.5 text-center"><StatusBadge status={e.status_pagamento} /></td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{eur(e.valor_total)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 whitespace-nowrap">{eur(e.valor_pendente)}</td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{e.prazo_entrega ? fmtDate(e.prazo_entrega) : "—"}</td>
                            <td className="px-4 py-2.5 text-gray-400"><ChevronRight size={16} /></td>
                          </tr>
                        ))}
                        {encomendas.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">Sem encomendas.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (blocoId === "orcamentos") {
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <Th className="w-[18%]">Nº</Th>
                          <Th className="w-[16%]">Data</Th>
                          <Th className="w-[18%]" align="center">Estado</Th>
                          <Th className="w-[18%]" align="right">Total</Th>
                          <Th className="w-[18%]">OF</Th>
                          <Th className="w-8" />
                        </tr>
                      </thead>
                      <tbody data-testid="cliente-orcamentos-table">
                        {orcamentos.map((o) => (
                          <tr key={o.id} data-testid={`cliente-orcamento-row-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer last:border-0">
                            <td className="px-4 py-2.5 mono tabular-nums font-medium text-gray-900 whitespace-nowrap">{o.numero || "Rascunho"}</td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{fmtDate(o.data)}</td>
                            <td className="px-4 py-2.5 text-center"><StatusBadge status={o.status} /></td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{eur(o.total)}</td>
                            <td className="px-4 py-2.5 text-gray-500 mono whitespace-nowrap">{o.of_numero || "—"}</td>
                            <td className="px-4 py-2.5 text-gray-400"><ChevronRight size={16} /></td>
                          </tr>
                        ))}
                        {orcamentos.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">Sem orçamentos.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (blocoId === "ofs") {
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <Th className="w-[28%]">Nº</Th>
                          <Th className="w-[18%]">Data</Th>
                          <Th className="w-[22%]" align="center">Estado</Th>
                          <Th className="w-[22%]" align="right">Progresso</Th>
                          <Th className="w-8" />
                        </tr>
                      </thead>
                      <tbody data-testid="cliente-ofs-table">
                        {ordens_fabrico.map((o) => (
                          <tr key={o.id} data-testid={`cliente-of-row-${o.id}`} onClick={() => nav(`/ordens-fabrico/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer last:border-0">
                            <td className="px-4 py-2.5 mono tabular-nums font-medium text-gray-900 whitespace-nowrap">
                              {o.numero}{o.prioritaria && <span className="text-red-600 text-xs font-semibold ml-1">· prioritária</span>}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{fmtDate(o.data)}</td>
                            <td className="px-4 py-2.5 text-center"><StatusBadge status={o.status} /></td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                            <td className="px-4 py-2.5 text-gray-400"><ChevronRight size={16} /></td>
                          </tr>
                        ))}
                        {ordens_fabrico.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">Sem ordens de fabrico.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (blocoId === "precos") {
                return (
                  <div className="overflow-x-auto">
                    {precos.length === 0 ? (
                      <div className="px-4 py-8 text-sm text-center text-gray-400">Sem preços registados em encomendas anteriores.</div>
                    ) : (
                      <table className="w-full text-sm min-w-[520px]">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <Th className="w-[40%]">Artigo</Th>
                            <Th className="w-[20%]" align="right">Último preço</Th>
                            <Th className="w-[15%]" align="right">Nº vezes</Th>
                            <Th className="w-[25%]" align="right">Última encomenda</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {precos.map((p) => (
                            <tr key={p.artigo_id} data-testid={`preco-hist-${p.artigo_id}`} className="border-b border-gray-100 last:border-0">
                              <td className="px-4 py-2.5 text-gray-900 truncate max-w-[16rem]" title={p.artigo_nome}>{p.artigo_nome}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{eur(p.ultimo_preco)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{p.ocorrencias}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums whitespace-nowrap">{fmtDate(p.ultima_data)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              }

              return null;
            }}
          />
        </>
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="cliente" id={id} hideTitle />
      )}

      <Dialog open={contactoOpen} onOpenChange={setContactoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{contactoEditId ? "Editar contacto" : "Novo contacto"}</DialogTitle>
            <DialogDescription>Pessoa de contacto desta empresa.</DialogDescription>
          </DialogHeader>
          <div className="border border-gray-200 rounded-sm overflow-hidden">
            <FieldGrid>
              <FieldRow label="Nome *" testid="contacto-campo-nome" full>
                <input data-testid="contacto-nome-input" value={contactoForm.nome} onChange={(e) => setContactoForm({ ...contactoForm, nome: e.target.value })} className={inputCls + " max-w-xs"} />
              </FieldRow>
              <FieldRow label="Cargo" testid="contacto-campo-cargo">
                <input data-testid="contacto-cargo-input" value={contactoForm.cargo} onChange={(e) => setContactoForm({ ...contactoForm, cargo: e.target.value })} placeholder="ex.: Comprador" className={inputCls} />
              </FieldRow>
              <FieldRow label="Departamento" testid="contacto-campo-departamento">
                <input data-testid="contacto-departamento-input" value={contactoForm.departamento} onChange={(e) => setContactoForm({ ...contactoForm, departamento: e.target.value })} placeholder="ex.: Compras" className={inputCls} />
              </FieldRow>
              <FieldRow label="Email" testid="contacto-campo-email">
                <input data-testid="contacto-email-input" value={contactoForm.email} onChange={(e) => setContactoForm({ ...contactoForm, email: e.target.value })} className={inputCls} />
              </FieldRow>
              <FieldRow label="Telefone" testid="contacto-campo-telefone">
                <input data-testid="contacto-telefone-input" value={contactoForm.telefone} onChange={(e) => setContactoForm({ ...contactoForm, telefone: e.target.value })} className={inputCls} />
              </FieldRow>
              <FieldRow label="Notas" testid="contacto-campo-notas" full>
                <textarea data-testid="contacto-notas-input" value={contactoForm.notas} onChange={(e) => setContactoForm({ ...contactoForm, notas: e.target.value })} rows={2} className="w-full max-w-xs border border-gray-300 rounded-sm px-2 py-1 text-sm text-left bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
              </FieldRow>
              <FieldRow label="Activo" testid="contacto-campo-ativo">
                <input type="checkbox" checked={contactoForm.ativo !== false} onChange={(e) => setContactoForm({ ...contactoForm, ativo: e.target.checked })} className="w-4 h-4" />
              </FieldRow>
            </FieldGrid>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setContactoOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button type="button" data-testid="save-contacto-btn" onClick={saveContacto} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
