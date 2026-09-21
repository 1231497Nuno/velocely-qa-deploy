import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import Combobox from "@/components/Combobox";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import ImagemUpload from "@/components/ImagemUpload";
import FicheirosTab from "@/components/FicheirosTab";
import PdfExportButton from "@/components/PdfExportButton";
import EnviarEmailButton from "@/components/EnviarEmailButton";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import {
  Save, Trash2, X,
  ShieldCheck, ShieldAlert, FileOutput, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { EncAlertas, EncKPIs, EncClienteCampos, EncRegistarPagamento, EncPagamentoResumo, EncPagamentosLista, OFsPanel, OrcamentosPanel, NcsPanel, OfFaseadaDialog } from "@/features/encomendas/EncomendaDetailParts";
import { OrcamentoTotais } from "@/features/orcamentos/OrcamentoPanels";
import BlocosShell from "@/components/BlocosShell";
import EmitirDocumentoDialog from "@/features/financeiro/EmitirDocumentoDialog";
import AbrirNaoConformidadeDialog from "@/features/nao_conformidades/AbrirNaoConformidadeDialog";
import { ymdHoje } from "@/lib/orcamento";

const PAY_BADGE = { pendente: "pendente", parcial: "parcial", pago: "pago" };

const ENC_BLOCOS = [
  { id: "cliente", label: "Cliente e prazos" },
  { id: "artigos", label: "Linhas de encomenda" },
  { id: "documentos", label: "Documentos" },
];
const OF_BLOCOS = [
  { id: "autorizacao", label: "Produção" },
  { id: "ofs", label: "Ordens de fabrico" },
];
const ORC_BLOCOS = [{ id: "orcamentos", label: "Orçamentos" }];
const NC_BLOCOS = [{ id: "ncs", label: "Não conformidades" }];

export default function EncomendaDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const tabIds = [
    "encomenda",
    "pagamentos",
    "producao",
    "orcamentos",
    ...(can("nao_conformidades", "view") ? ["nao_conformidades"] : []),
    "ficheiros",
    "historico",
  ];
  const [tab, setTab] = useDetailTab(tabIds, "encomenda");
  const [enc, setEnc] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [precoHist, setPrecoHist] = useState({});
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [empresa, setEmpresa] = useState({});
  const [orcamentos, setOrcamentos] = useState([]);
  const [docs, setDocs] = useState([]);
  const [ofOpen, setOfOpen] = useState(false);
  const [ofQtys, setOfQtys] = useState({});
  const [emitOpen, setEmitOpen] = useState(false);
  const [emitDefaultTipo, setEmitDefaultTipo] = useState("fatura");
  const [ncs, setNcs] = useState([]);
  const [ncOpen, setNcOpen] = useState(false);
  const [ncLinha, setNcLinha] = useState(null);
  const [pagRegistering, setPagRegistering] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const e = await api.get(`/encomendas/${id}`);
      setEnc(e);
      const [arts, tiposData, cs, hist, docsData, ncsData, empresaData, orcsData] = await Promise.all([
        api.get("/artigos?lite=1"),
        api.get("/tipos-personalizacao"),
        e.cliente_id ? api.get("/clientes").catch(() => []) : Promise.resolve([]),
        e.cliente_id ? api.get(`/clientes/${e.cliente_id}/historico-precos`).catch(() => []) : Promise.resolve([]),
        can("financeiro", "view") ? api.get(`/encomendas/${id}/documentos`).catch(() => []) : Promise.resolve([]),
        can("nao_conformidades", "view") ? api.get(`/encomendas/${id}/nao-conformidades`).catch(() => []) : Promise.resolve([]),
        api.get("/settings/empresa").catch(() => ({})),
        can("orcamentos", "view") ? api.get(`/orcamentos?encomenda_id=${id}`).catch(() => []) : Promise.resolve([]),
      ]);
      setArtigos(arts);
      setTipos(tiposData);
      setDocs(Array.isArray(docsData) ? docsData : []);
      setNcs(Array.isArray(ncsData) ? ncsData : []);
      setEmpresa(empresaData || {});
      setOrcamentos(Array.isArray(orcsData) ? orcsData : (orcsData?.items || []));
      if (e.cliente_id) {
        const clientes = Array.isArray(cs) ? cs : (cs.items || []);
        setCliente(clientes.find((c) => c.id === e.cliente_id) || null);
        setPrecoHist(Object.fromEntries((hist || []).map((h) => [h.artigo_id, h])));
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setLoadError(typeof detail === "string" ? detail : "Não foi possível carregar a encomenda.");
      setEnc(null);
    }
  }, [id, can]);
  useEffect(() => { load(); }, [load]);

  const moradaCompleta = useMemo(
    () => [cliente?.morada, cliente?.codigo_postal, cliente?.cidade, cliente?.pais].filter(Boolean).join(", "),
    [cliente]
  );

  const openEmitir = (tipo = "fatura") => {
    setEmitDefaultTipo(tipo);
    setEmitOpen(true);
  };

  if (loadError && !enc) {
    return (
      <div className="text-sm space-y-3 py-8 text-center" data-testid="enc-load-error">
        <p className="text-gray-600">{loadError}</p>
        <button type="button" onClick={() => load()} className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium">
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!enc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setEnc({ ...enc, ...patch });

  const persUnitOf = (a) => (a.personalizacoes || []).reduce((x, p) => x + (Number(p.valor) || 0), 0);
  const lineGross = (a) => ((Number(a.preco_unit) || 0) + persUnitOf(a)) * (Number(a.quantidade) || 0);
  const lineDisc = (a) => {
    const qtd = Number(a.quantidade) || 0;
    const unit = (Number(a.preco_unit) || 0) + persUnitOf(a);
    const base = unit * qtd;
    const d = Number(a.desconto) || 0;
    if (d <= 0 || base <= 0) return 0;
    const tipo = a.desconto_tipo || "pct";
    const porUnidade = (a.desconto_base || "linha") === "unit";
    if (tipo === "eur" && porUnidade) return Math.min(d * qtd, base);
    return tipo === "eur" ? Math.min(d, base) : (base * d) / 100;
  };
  const lineNet = (a) => lineGross(a) - lineDisc(a);

  const subtotalVenda = (enc.artigos || []).reduce((s, a) => s + (Number(a.preco_unit) || 0) * (Number(a.quantidade) || 0), 0);
  const totalPers = (enc.artigos || []).reduce((s, a) => s + persUnitOf(a) * (Number(a.quantidade) || 0), 0);
  const descontoLinhas = (enc.artigos || []).reduce((s, a) => s + lineDisc(a), 0);
  const envioVal = Number(enc.envio) || 0;
  const subtotalLiquido = subtotalVenda + totalPers + envioVal - descontoLinhas;
  const descTotalVal = (() => {
    const d = Number(enc.desconto_total) || 0;
    if (d <= 0) return 0;
    return enc.desconto_total_tipo === "eur" ? Math.min(d, subtotalLiquido) : (subtotalLiquido * d) / 100;
  })();
  const precoFinal = enc.valor_total_manual ? (Number(enc.valor_total) || 0) : (subtotalLiquido - descTotalVal);
  const custoProducao = Number(enc.custo_producao_real) || Number(enc.custo_producao_estimado) || 0;
  const lucro = precoFinal - custoProducao;

  const bodyFrom = (e) => ({
    cliente: e.cliente,
    cliente_id: e.cliente_id || null,
    contacto_id: e.contacto_id || null,
    contacto_nome: e.contacto_nome || "",
    contacto_email: e.contacto_email || "",
    contacto_telefone: e.contacto_telefone || "",
    contacto_cargo: e.contacto_cargo || "",
    contacto_departamento: e.contacto_departamento || "",
    descricao: e.descricao || "",
    data: e.data,
    prazo_entrega: e.prazo_entrega || null,
    estado: e.estado,
    notas: e.notas || "",
    imagens: e.imagens || [],
    pagamentos: e.pagamentos || [],
    desconto_total: Number(e.desconto_total) || 0,
    desconto_total_tipo: e.desconto_total_tipo || "pct",
    envio: Number(e.envio) || 0,
    artigos: (e.artigos || []).map((a) => ({
      ...a,
      quantidade: Number(a.quantidade) || 1,
      preco_unit: Number(a.preco_unit) || 0,
      preco_unit_orcamento: a.preco_unit_orcamento == null || a.preco_unit_orcamento === "" ? null : Number(a.preco_unit_orcamento),
      desconto: Number(a.desconto) || 0,
      desconto_tipo: a.desconto_tipo || "pct",
      desconto_base: a.desconto_base === "unit" ? "unit" : "linha",
      personalizacoes: (a.personalizacoes || []).map((p) => ({ id: p.id, nome: p.nome, valor: Number(p.valor) || 0, tempo: Number(p.tempo) || 0 })),
    })),
    valor_total: e.valor_total_manual ? Number(e.valor_total) || 0 : null,
    valor_total_manual: !!e.valor_total_manual,
    valor_pago: Number(e.valor_pago) || 0,
    autorizada_producao: !!e.autorizada_producao,
    entregue: !!e.entregue,
    data_entrega: e.data_entrega || null,
  });

  const persist = async (patch = {}, msg) => {
    const next = { ...enc, ...patch };
    setEnc(next);
    try {
      const updated = await api.put(`/encomendas/${id}`, bodyFrom(next));
      setEnc(updated);
      if (msg) toast.success(msg);
      return updated;
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Não foi possível guardar");
      await load();
      return null;
    }
  };
  const save = () => persist({}, "Encomenda guardada");

  const addArtigo = (artigoId) => {
    const a = artigos.find((x) => x.id === artigoId);
    if (!a) return;
    persist({ artigos: [...(enc.artigos || []), { id: crypto.randomUUID(), artigo_id: a.id, artigo_nome: a.nome, imagem: a.imagem || "", quantidade: 1, preco_unit: Number(a.preco_venda) || 0, desconto: 0, desconto_tipo: "pct", desconto_base: "linha", personalizacoes: [] }] }, "Artigo adicionado");
  };
  const updArtigo = (i, patch) => {
    const list = [...enc.artigos];
    list[i] = { ...list[i], ...patch };
    upd({ artigos: list });
  };
  const delArtigo = (i) => persist({ artigos: enc.artigos.filter((_, idx) => idx !== i) }, "Artigo removido");

  const artUnidade = (artigoId) => (artigos.find((a) => a.id === artigoId) || {}).unidade || "un";
  const addPers = (i, tipoId) => {
    const t = tipos.find((x) => x.id === tipoId);
    if (!t) return;
    const list = enc.artigos.map((a, idx) => idx === i ? { ...a, personalizacoes: [...(a.personalizacoes || []), { id: t.id, nome: t.nome, valor: Number(t.valor) || 0, tempo: Number(t.tempo) || 0 }] } : a);
    persist({ artigos: list }, "Personalização adicionada");
  };
  const updPers = (i, pi, patch) => {
    const list = [...(enc.artigos[i].personalizacoes || [])];
    list[pi] = { ...list[pi], ...patch };
    updArtigo(i, { personalizacoes: list });
  };
  const delPers = (i, pi) => {
    const list = enc.artigos.map((a, idx) => idx === i ? { ...a, personalizacoes: (a.personalizacoes || []).filter((_, x) => x !== pi) } : a);
    persist({ artigos: list }, "Personalização removida");
  };

  const criarOF = async () => {
    const itens = (enc.artigos || [])
      .filter((a) => a.artigo_id && (Number(ofQtys[a.id]) || 0) > 0)
      .map((a) => ({
        artigo_id: a.artigo_id, artigo_nome: a.artigo_nome, imagem: a.imagem || "", quantidade: Number(ofQtys[a.id]) || 0,
        personalizacoes: a.personalizacoes || [], operacoes: [],
      }));
    if (itens.length === 0) return toast.error("Indica pelo menos uma quantidade a produzir");
    const of = await api.post(`/encomendas/${id}/ordens-fabrico`, { cliente: enc.cliente, itens, imagens: enc.imagens || [] });
    toast.success("Ordem de fabrico criada");
    nav(`/ordens-fabrico/${of.id}`);
  };

  const ofQtyByArtigo = (enc.ordens_fabrico || []).reduce((acc, o) => {
    (o.itens || []).forEach((it) => {
      if (it.artigo_id) acc[it.artigo_id] = (acc[it.artigo_id] || 0) + (Number(it.quantidade) || 0);
    });
    return acc;
  }, {});
  const remaining = (a) => Math.max(0, (Number(a.quantidade) || 0) - (ofQtyByArtigo[a.artigo_id] || 0));

  const openCriarOF = () => {
    const init = {};
    (enc.artigos || []).forEach((a) => { if (a.artigo_id) init[a.id] = remaining(a); });
    setOfQtys(init);
    setOfOpen(true);
  };

  const artigoOptions = artigos.map((a) => ({ value: a.id, label: a.nome, hint: eur(a.preco_venda) }));
  const podeProduzir = enc.pode_produzir;

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/encomendas")} testid="encomenda-back-btn" label="Voltar às encomendas" />}
        title={enc.numero}
        badges={
          <>
            <StatusBadge status={enc.estado} testid="encomenda-estado-badge" />
            {enc.entregue && <StatusBadge status="entregue" testid="encomenda-entregue-badge" />}
            <StatusBadge status={PAY_BADGE[enc.status_pagamento]} testid="encomenda-pagamento-badge" />
          </>
        }
        subtitle={`Encomenda${enc.orcamento_numero ? ` · origem ${enc.orcamento_numero}` : ""}`}
        actions={
          <>
            <PdfExportButton modulo="encomenda" recordId={id} />
            {can("encomendas", "edit") && (
              <EnviarEmailButton
                variant="encomenda"
                recordId={id}
                defaultTo={enc.contacto_email || cliente?.email || ""}
                clienteNome={enc.cliente || cliente?.nome || ""}
                prazoEntrega={enc.prazo_entrega || ""}
                valorTotal={enc.total_com_iva ?? enc.valor_total}
                valorPago={enc.valor_pago}
                valorPendente={enc.valor_pendente}
                disabled={enc.estado === "cancelada"}
                onSent={() => load()}
              />
            )}
            {can("financeiro", "create") && enc.estado !== "cancelada" && (
              <button
                data-testid="enc-emitir-doc-btn"
                onClick={() => openEmitir("fatura")}
                className="bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors"
              >
                <FileOutput size={15} /> Emitir fatura
              </button>
            )}
            {can("encomendas", "edit") && (
              <button data-testid="save-encomenda-btn" onClick={() => save()} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors"><Save size={15} /> Guardar</button>
            )}
          </>
        }
      />

      <DetailTabs
        testid="encomenda-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "encomenda", label: "Encomenda", testid: "enc-tab-encomenda" },
          { id: "pagamentos", label: "Pagamentos", testid: "enc-tab-pagamentos" },
          { id: "producao", label: "Ordens de fabrico", testid: "enc-tab-producao" },
          { id: "orcamentos", label: "Orçamentos", testid: "enc-tab-orcamentos" },
          ...(can("nao_conformidades", "view") ? [{ id: "nao_conformidades", label: "Não conformidades", testid: "enc-tab-ncs" }] : []),
          { id: "ficheiros", label: "Ficheiros", testid: "enc-tab-ficheiros" },
          { id: "historico", label: "Histórico", testid: "enc-tab-historico" },
        ]}
      />


      {tab === "encomenda" && (
        <>
          {can("ordens_fabrico", "view") && <EncAlertas enc={enc} />}
          <EncKPIs enc={enc} />
          <div className="mt-4">
            <BlocosShell
              testid="enc-blocos"
              storageKey="encomenda-blocos-layout-v1"
              blocks={ENC_BLOCOS}
              visibleIds={
                can("financeiro", "view") && docs.length > 0
                  ? ["cliente", "artigos", "documentos"]
                  : ["cliente", "artigos"]
              }
              renderBlock={(blocoId) => {
                if (blocoId === "cliente") {
                  return (
                    <EncClienteCampos
                      enc={enc}
                      cliente={cliente}
                      moradaCompleta={moradaCompleta}
                      canEdit={can("encomendas", "edit")}
                      onContactoChange={(cid, c) => {
                        persist(
                          {
                            contacto_id: cid,
                            contacto_nome: c?.nome || "",
                            contacto_email: c?.email || "",
                            contacto_telefone: c?.telefone || "",
                            contacto_cargo: c?.cargo || "",
                            contacto_departamento: c?.departamento || "",
                          },
                          cid ? "Contacto actualizado" : "Contacto removido",
                        );
                      }}
                      onPrazoChange={(e) => upd({ prazo_entrega: e.target.value })}
                      onPrazoBlur={() => persist({}, "Prazo atualizado")}
                      onEntregaToggle={() => {
                        const next = !enc.entregue;
                        persist(
                          { entregue: next, data_entrega: next ? (enc.data_entrega || ymdHoje()) : null },
                          next ? "Material marcado como entregue" : "Entrega removida",
                        );
                      }}
                      onDataEntregaChange={(e) => upd({ data_entrega: e.target.value })}
                      onDataEntregaBlur={() => persist({}, "Data de entrega atualizada")}
                      onDescricaoChange={(e) => upd({ descricao: e.target.value })}
                      onDescricaoBlur={() => persist({}, "Descrição atualizada")}
                    />
                  );
                }
                if (blocoId === "artigos") {
                  return (
          <div className="overflow-hidden flex flex-col" data-testid="enc-artigos-bloco">
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100">
              <span className="text-xs tabular-nums text-gray-400">{(enc.artigos || []).length} artigo(s)</span>
              {can("encomendas", "edit") && (
                <div className="sm:w-72">
                  <Combobox options={artigoOptions} value="" onChange={(v) => addArtigo(v)} placeholder="+ Adicionar artigo..." searchPlaceholder="Pesquisar artigo..." emptyText="Nenhum artigo." testid="enc-add-artigo" optionTestidPrefix="enc-artigo-option" />
                </div>
              )}
            </div>
            {(enc.artigos || []).length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center px-5">Sem artigos. Adicione artigos ou converta um orçamento.</p>
            ) : (
              <div className="overflow-auto max-h-[min(55vh,28rem)] lg:max-h-[min(65vh,32rem)]" data-testid="enc-artigos-scroll">
                <table className="w-full text-sm min-w-[820px]" data-testid="enc-artigos-table">
                  <thead className="sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Artigo</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Personalização</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Qtd</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Preço Unit.</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Unit. c/Pers</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Desconto</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Subtotal</th>
                      <th className="px-4 py-2.5 w-12 bg-gray-50"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {enc.artigos.map((a, i) => {
                      const unitPers = (Number(a.preco_unit) || 0) + persUnitOf(a);
                      return (
                        <tr key={a.id || i} data-testid={`enc-artigo-row-${i}`} className="border-b border-gray-100">
                          <td className="px-4 py-2.5 font-medium text-gray-900">
                            <div className="flex items-center gap-2.5">
                              <ImagemUpload value={a.imagem} editable={false} size={40} testid={`enc-artigo-imagem-${i}`} />
                              <span>{a.artigo_nome}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <div className="space-y-1.5 min-w-[160px]" data-testid={`enc-artigo-pers-list-${i}`}>
                              {(a.personalizacoes || []).map((p, pi) => (
                                <div key={`${p.id || p.nome}-${pi}`} data-testid={`enc-artigo-pers-${i}-${pi}`} className="flex items-center gap-1.5 bg-gray-100 rounded-sm pl-2 pr-1 py-1">
                                  <span className="flex-1 text-xs text-gray-700 truncate" title={p.nome}>{p.nome}</span>
                                  <input data-testid={`enc-artigo-pers-valor-${i}-${pi}`} type="number" step="0.01" value={p.valor ?? 0} onChange={(e) => updPers(i, pi, { valor: e.target.value })} onBlur={() => persist({})} className="w-14 text-right border border-gray-300 rounded-sm px-1 py-0.5 text-xs tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                                  <span className="text-[10px] text-gray-400">€</span>
                                  <button data-testid={`enc-artigo-pers-del-${i}-${pi}`} onClick={() => delPers(i, pi)} className="p-0.5 rounded-sm hover:bg-red-100 text-red-600"><X size={12} /></button>
                                </div>
                              ))}
                              {can("encomendas", "edit") && (
                                <select data-testid={`enc-artigo-pers-add-${i}`} value="" onChange={(e) => { if (e.target.value) addPers(i, e.target.value); e.target.value = ""; }} className="w-full border border-dashed border-gray-300 rounded-sm px-2 py-1.5 text-xs bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-black/20">
                                  <option value="">+ Personalização…</option>
                                  {tipos.map((t) => <option key={t.id} value={t.id}>{`${t.nome} (${eur(t.valor)})`}</option>)}
                                </select>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right align-top">
                            <div className="flex items-center gap-1.5 justify-end">
                              <input data-testid={`enc-artigo-qtd-${i}`} type="number" min="1" value={a.quantidade} onChange={(e) => updArtigo(i, { quantidade: e.target.value })} onBlur={() => persist({})} className="w-16 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                              <span className="text-xs text-gray-400 shrink-0">{artUnidade(a.artigo_id)}</span>
                            </div>
                            {(() => {
                              const emOfs = ofQtyByArtigo[a.artigo_id] || 0;
                              const tot = Number(a.quantidade) || 0;
                              const nAbertas = (ncs || []).filter((n) => n.encomenda_artigo_id === a.id && n.estado !== "fechada").length;
                              return (
                                <>
                                  {tot > 0 && (emOfs <= 0
                                    ? <div className="text-[10px] text-red-600 font-medium text-right mt-0.5" data-testid={`enc-artigo-semof-${i}`}>sem ordem</div>
                                    : emOfs > tot
                                      ? <div className="text-[10px] text-amber-600 font-medium text-right mt-0.5" data-testid={`enc-artigo-sobre-${i}`}>sobreprod. {emOfs}/{tot}</div>
                                      : <div className="text-[10px] text-gray-400 text-right mt-0.5" data-testid={`enc-artigo-emofs-${i}`}>em OFs {emOfs}/{tot}</div>)}
                                  {nAbertas > 0 && (
                                    <div className="text-[10px] text-amber-700 font-medium text-right mt-0.5" data-testid={`enc-artigo-nc-count-${i}`}>
                                      {nAbertas} NC
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-right align-top">
                            <input
                              data-testid={`enc-artigo-preco-${i}`}
                              type="number"
                              step="0.01"
                              min={a.preco_unit_orcamento != null && a.preco_unit_orcamento !== "" ? a.preco_unit_orcamento : 0}
                              value={a.preco_unit}
                              onChange={(e) => updArtigo(i, { preco_unit: e.target.value })}
                              onBlur={() => {
                                const floor = a.preco_unit_orcamento != null && a.preco_unit_orcamento !== "" ? Number(a.preco_unit_orcamento) : null;
                                const pu = Number(a.preco_unit);
                                if (floor != null && (Number.isNaN(pu) || pu + 0.001 < floor)) {
                                  toast.error(`O preço não pode ser inferior ao do orçamento (${eur(floor)})`);
                                  const artigosNext = enc.artigos.map((x, idx) => (idx === i ? { ...x, preco_unit: floor } : x));
                                  upd({ artigos: artigosNext });
                                  persist({ artigos: artigosNext });
                                  return;
                                }
                                persist({});
                              }}
                              className="w-24 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20"
                            />
                            {a.preco_unit_orcamento != null && a.preco_unit_orcamento !== "" && (
                              <div className="text-[10px] text-gray-400 text-right mt-0.5" data-testid={`enc-preco-piso-${i}`}>
                                Mín. orçamento {eur(a.preco_unit_orcamento)}
                              </div>
                            )}
                            {precoHist[a.artigo_id] && (
                              <button
                                type="button"
                                data-testid={`enc-preco-hint-${i}`}
                                title="Aplicar o último preço praticado a este cliente"
                                onClick={() => {
                                  const floor = a.preco_unit_orcamento != null && a.preco_unit_orcamento !== "" ? Number(a.preco_unit_orcamento) : null;
                                  let p = Number(precoHist[a.artigo_id].ultimo_preco);
                                  if (floor != null && p + 0.001 < floor) {
                                    toast.error(`O último preço (${eur(p)}) é inferior ao do orçamento (${eur(floor)})`);
                                    return;
                                  }
                                  const artigosNext = enc.artigos.map((x, idx) => (idx === i ? { ...x, preco_unit: p } : x));
                                  upd({ artigos: artigosNext });
                                  persist({ artigos: artigosNext });
                                }}
                                className="block ml-auto mt-1 text-[11px] text-blue-600 hover:underline whitespace-nowrap"
                              >
                                Último: {eur(precoHist[a.artigo_id].ultimo_preco)}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900 align-top" data-testid={`enc-artigo-unit-pers-${i}`}>{eur(unitPers)}</td>
                          <td className="px-4 py-2.5 text-right align-top">
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1 justify-end">
                                <input data-testid={`enc-artigo-desc-${i}`} type="number" min="0" step="0.01" value={a.desconto ?? 0} onChange={(e) => updArtigo(i, { desconto: e.target.value })} onBlur={() => persist({})} className="w-14 text-right border border-gray-300 rounded-sm px-1.5 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                                <select data-testid={`enc-artigo-desc-tipo-${i}`} value={a.desconto_tipo || "pct"} onChange={(e) => updArtigo(i, { desconto_tipo: e.target.value })} onBlur={() => persist({})} className="border border-gray-300 rounded-sm px-1 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                                  <option value="pct">%</option>
                                  <option value="eur">€</option>
                                </select>
                              </div>
                              <label
                                className="inline-flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none"
                                title="Se marcado, o desconto em € aplica-se por unidade; senão ao total da linha"
                              >
                                <input
                                  data-testid={`enc-artigo-desc-unit-${i}`}
                                  type="checkbox"
                                  checked={(a.desconto_base || "linha") === "unit"}
                                  onChange={(e) => {
                                    const base = e.target.checked ? "unit" : "linha";
                                    const artigos = enc.artigos.map((x, idx) => (idx === i ? { ...x, desconto_base: base } : x));
                                    upd({ artigos });
                                    persist({ artigos });
                                  }}
                                  className="w-3 h-3 accent-black"
                                />
                                por un.
                              </label>
                              {lineDisc(a) > 0 && <div className="text-[10px] text-red-500 text-right">- {eur(lineDisc(a))}</div>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium align-top" data-testid={`enc-artigo-subtotal-${i}`}>{eur(lineNet(a))}</td>
                          <td className="px-4 py-2.5 align-top">
                            <div className="flex items-center justify-end gap-0.5">
                              {can("nao_conformidades", "create") && enc.estado !== "cancelada" && (
                                <button
                                  type="button"
                                  data-testid={`enc-artigo-nc-${i}`}
                                  title={enc.entregue ? "Abrir não conformidade" : "Só depois de marcar o material como entregue"}
                                  disabled={!enc.entregue}
                                  onClick={() => { if (!enc.entregue) return; setNcLinha(a); setNcOpen(true); }}
                                  className={`p-1.5 rounded-sm ${enc.entregue ? "hover:bg-amber-50 text-amber-700" : "text-gray-300 cursor-not-allowed"}`}
                                >
                                  <AlertTriangle size={15} />
                                </button>
                              )}
                              <button data-testid={`enc-artigo-del-${i}`} onClick={() => delArtigo(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="shrink-0 text-xs text-gray-400 px-5 py-3 border-t border-gray-100">As alterações aos artigos são guardadas automaticamente e o valor é recalculado. Em encomendas geradas de um orçamento o preço pode subir, mas não pode ficar abaixo do cotado.</p>
          </div>
                  );
                }
                if (blocoId === "documentos") {
                  return (
                    <div className="p-4 space-y-1" data-testid="enc-documentos">
                      {docs.map((d) => (
                        <Link
                          key={d.id}
                          to={`/financeiro/${d.id}`}
                          data-testid={`enc-doc-${d.id}`}
                          className="flex items-center justify-between gap-2 border border-gray-200 rounded-sm px-2.5 py-1.5 hover:bg-gray-50 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-medium mono text-gray-900">{d.numero}</span>
                            <span className="text-xs text-gray-400 ml-2">{d.tipo}</span>
                          </span>
                          <span className="text-xs tabular-nums text-gray-500 shrink-0">{eur(d.total)}</span>
                        </Link>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
          </div>
          <div className="mt-4 space-y-3 flex flex-col items-end">
            <OrcamentoTotais
              subtotalVenda={subtotalVenda}
              totalPers={totalPers}
              envio={enc.envio ?? 0}
              onEnvio={can("encomendas", "edit") ? (v) => upd({ envio: v }) : undefined}
              descontoLinhas={descontoLinhas}
              descTotal={enc.desconto_total}
              descTotalTipo={enc.desconto_total_tipo || "pct"}
              descTotalVal={descTotalVal}
              onDescTotal={can("encomendas", "edit") ? (v) => upd({ desconto_total: v }) : undefined}
              onDescTotalTipo={can("encomendas", "edit") ? (t) => persist({ desconto_total_tipo: t }, "Desconto atualizado") : undefined}
              onDescBlur={can("encomendas", "edit") ? () => persist({}, "Totais atualizados") : undefined}
              custoProducao={custoProducao}
              lucro={lucro}
              total={precoFinal}
              ivaTaxa={empresa.iva_isento ? 0 : (Number(empresa.iva_taxa) || 0)}
              ivaIsento={!!empresa.iva_isento}
              condicoesPagamento={empresa.condicoes_pagamento}
            />
            <EncRegistarPagamento
              enc={enc}
              canEdit={can("encomendas", "edit")}
              registering={pagRegistering}
              onRegistar={async ({ valor, metodo }) => {
                setPagRegistering(true);
                try {
                  const updated = await api.post(`/encomendas/${id}/pagamentos`, { valor, metodo, tipo: "pagamento" });
                  setEnc(updated);
                  toast.success("Pagamento registado");
                } catch (e) {
                  const d = e?.response?.data?.detail;
                  toast.error(typeof d === "string" ? d : "Erro ao registar pagamento");
                } finally {
                  setPagRegistering(false);
                }
              }}
            />
          </div>
        </>
      )}

      {tab === "pagamentos" && (
        <div className="space-y-4" data-testid="enc-tab-pagamentos-panel">
          <EncPagamentoResumo enc={enc} />
          <EncPagamentosLista
            enc={enc}
            canEdit={can("encomendas", "edit") && enc.estado !== "cancelada"}
            onDelete={async (p) => {
              if (!window.confirm(`Remover pagamento ${p.recibo_numero || ""}?`)) return;
              try {
                const updated = await api.del(`/encomendas/${id}/pagamentos/${p.id}`);
                setEnc(updated);
                toast.success("Pagamento removido");
              } catch (e) {
                const d = e?.response?.data?.detail;
                toast.error(typeof d === "string" ? d : "Erro ao remover");
              }
            }}
          />
        </div>
      )}

      {tab === "producao" && (
        <div className="space-y-4">
          {can("ordens_fabrico", "view") && <EncAlertas enc={enc} />}
          <BlocosShell
            testid="enc-blocos-producao"
            storageKey="encomenda-blocos-producao-v1"
            blocks={OF_BLOCOS}
            visibleIds={can("ordens_fabrico", "view") ? ["autorizacao", "ofs"] : ["autorizacao"]}
            renderBlock={(blocoId) => {
              if (blocoId === "autorizacao") {
                return (
                  <div className="p-4 space-y-4" data-testid="encomenda-producao">
                    <div className={`rounded-sm border p-3 flex items-center gap-2.5 ${podeProduzir ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`} data-testid="enc-producao-status">
                      {podeProduzir ? <ShieldCheck size={18} className="text-emerald-600 shrink-0" /> : <ShieldAlert size={18} className="text-amber-600 shrink-0" />}
                      <div className="text-sm">
                        <div className={`font-medium ${podeProduzir ? "text-emerald-800" : "text-amber-800"}`}>{podeProduzir ? "Produção autorizada" : "Produção bloqueada"}</div>
                        <div className="text-xs text-gray-600">{podeProduzir ? "As OFs podem arrancar." : "Pagamento total ou autorização manual em falta."}</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input data-testid="enc-autorizar-check" type="checkbox" checked={!!enc.autorizada_producao} onChange={(e) => persist({ autorizada_producao: e.target.checked }, e.target.checked ? "Produção autorizada" : "Autorização removida")} className="w-4 h-4 accent-emerald-600" />
                      Autorizar produção manualmente (override pagamento)
                    </label>
                  </div>
                );
              }
              if (blocoId === "ofs") {
                return <OFsPanel enc={enc} onCriar={openCriarOF} canCreate={can("ordens_fabrico", "create")} embedded />;
              }
              return null;
            }}
          />
        </div>
      )}

      {tab === "orcamentos" && (
        <BlocosShell
          testid="enc-blocos-orcamentos"
          storageKey="encomenda-blocos-orcamentos-v1"
          blocks={ORC_BLOCOS}
          renderBlock={() => (
            <OrcamentosPanel
              orcamentos={orcamentos}
              orcamentoId={enc.orcamento_id}
              orcamentoNumero={enc.orcamento_numero}
              embedded
            />
          )}
        />
      )}

      {tab === "nao_conformidades" && can("nao_conformidades", "view") && (
        <BlocosShell
          testid="enc-blocos-ncs"
          storageKey="encomenda-blocos-ncs-v1"
          blocks={NC_BLOCOS}
          renderBlock={() => <NcsPanel ncs={ncs} embedded />}
        />
      )}

      {tab === "ficheiros" && (
        <FicheirosTab tipo="encomenda" id={id} canEdit={can("encomendas", "edit") && enc.estado !== "cancelada"} />
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="encomenda" id={id} hideTitle />
      )}

      <OfFaseadaDialog
        open={ofOpen}
        onOpenChange={setOfOpen}
        artigos={enc.artigos}
        ofQtys={ofQtys}
        setOfQtys={setOfQtys}
        ofQtyByArtigo={ofQtyByArtigo}
        remaining={remaining}
        artUnidade={artUnidade}
        onCriar={criarOF}
      />

      {can("nao_conformidades", "create") && (
        <AbrirNaoConformidadeDialog
          open={ncOpen}
          onOpenChange={setNcOpen}
          encomendaId={id}
          linha={ncLinha}
          artigoCodigo={(artigos.find((x) => x.id === ncLinha?.artigo_id) || {}).codigo || ""}
          onCreated={(nc) => {
            setNcs((prev) => [nc, ...prev]);
            if (nc?.id) nav(`/nao-conformidades/${nc.id}`);
          }}
        />
      )}

      {can("financeiro", "create") && (
        <EmitirDocumentoDialog
          open={emitOpen}
          onOpenChange={setEmitOpen}
          encomendaId={id}
          enc={enc}
          defaultTipo={emitDefaultTipo}
          onEmitted={() => load()}
        />
      )}
    </div>
  );
}
