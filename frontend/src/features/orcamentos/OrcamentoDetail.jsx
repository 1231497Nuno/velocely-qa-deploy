import { useEffect, useState, useCallback, Fragment } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, eur, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ClienteSelector from "@/components/ClienteSelector";
import StatusBadge from "@/components/StatusBadge";
import PdfExportButton from "@/components/PdfExportButton";
import EnviarEmailButton from "@/components/EnviarEmailButton";
import LinhaTipoIcon, { isDiversosArtigo } from "@/components/LinhaTipoIcon";
import { LinhaTipoSelect, LinhaCodigoSelect, LinhaDescricaoInput } from "@/components/LinhaArtigoFields";
import { OrcamentoMateriais, OrcamentoTotais } from "@/features/orcamentos/OrcamentoPanels";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import ImagemUpload from "@/components/ImagemUpload";
import ImagensGaleria from "@/components/ImagensGaleria";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { Plus, Trash2, Save, FileText, Factory, FileDown, Cog, X, ChevronDown, ChevronRight, RotateCcw, AlertTriangle, ClipboardList } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTS = [
  { v: "rascunho", l: "Rascunho" },
  { v: "enviado", l: "Enviado" },
  { v: "aceite", l: "Aceite" },
  { v: "rejeitado", l: "Rejeitado" },
];

const toHours = (v, u) => (Number(v) || 0) / (u === "h" ? 1 : 60);
const maqHora = (m) => (m ? (Number(m.custo_amortizacao_hora) || 0) + (Number(m.custo_energia_hora) || 0) : 0);

export default function OrcamentoDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [orc, setOrc] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [consumiveis, setConsumiveis] = useState([]);
  const [openOps, setOpenOps] = useState({});
  const [empresa, setEmpresa] = useState({});
  const [clienteEmail, setClienteEmail] = useState("");

  const load = useCallback(async () => {
    const o = await api.get(`/orcamentos/${id}`);
    // migrar personalização única (legado) para lista
    o.linhas = (o.linhas || []).map((l) => {
      if ((!l.personalizacoes || l.personalizacoes.length === 0) && l.tipo_personalizacao_id) {
        l.personalizacoes = [{ id: l.tipo_personalizacao_id, nome: l.tipo_personalizacao_nome || "", valor: Number(l.valor_personalizacao) || 0 }];
      } else if (!l.personalizacoes) {
        l.personalizacoes = [];
      }
      if (!l.tipo_linha) l.tipo_linha = "";
      if (l.descricao_livre == null) l.descricao_livre = false;
      return l;
    });
    o.materiais = o.materiais || [];
    setOrc(o);

    const [arts, tipos, maqs, mos, cons, empresa, cs] = await Promise.all([
      api.get("/artigos?lite=1"),
      api.get("/tipos-personalizacao"),
      api.get("/maquinas"),
      api.get("/mao-obra"),
      api.get("/consumiveis"),
      api.get("/settings/empresa").catch(() => ({})),
      o.cliente_id ? api.get("/clientes").catch(() => []) : Promise.resolve([]),
    ]);
    setArtigos(arts);
    setTipos(tipos);
    setMaquinas(maqs);
    setMaoObra(mos);
    setConsumiveis(cons);
    setEmpresa(empresa);
    const clientes = Array.isArray(cs) ? cs : (cs.items || []);
    setClienteEmail(o.cliente_id ? (clientes.find((x) => x.id === o.cliente_id)?.email || "") : "");
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!orc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setOrc({ ...orc, ...patch });

  const lineCusto = (l) => {
    let c = Number(l.custo_base_unit) || 0;
    for (const op of l.roteiro || []) {
      const mq = maquinas.find((x) => x.id === op.maquina_id);
      const mo = maoObra.find((x) => x.id === op.mao_obra_id);
      c += toHours(op.tempo_maquina, op.tempo_maquina_unidade) * maqHora(mq);
      c += toHours(op.tempo_mao_obra, op.tempo_mao_obra_unidade) * (mo ? Number(mo.custo_hora) || 0 : 0);
    }
    return c;
  };
  const linePreco = (l) => (l.preco_unit_manual ? (Number(l.preco_unit) || 0) : compPreco(l));
  const compPreco = (l) => lineCusto(l) * (1 + (Number(l.margem) || 0) / 100);

  const reloadArtigos = async () => {
    const arts = await api.get("/artigos?lite=1");
    setArtigos(arts);
    return arts;
  };

  const emptyLinha = () => ({
    artigo_id: "",
    artigo_nome: "",
    artigo_codigo: "",
    tipo_linha: "",
    descricao_livre: false,
    quantidade: 1,
    tipo_personalizacao_id: "",
    tipo_personalizacao_nome: "",
    valor_personalizacao: 0,
    custo_base_unit: 0,
    margem: 0,
    roteiro: [],
    custo_producao_unit: 0,
    preco_unit: 0,
    personalizacoes: [],
    imagem: "",
  });

  const applyTipoLinha = (i, v) => {
    if (v === "descritor") {
      updLinha(i, {
        tipo_linha: "descritor",
        descricao_livre: true,
        artigo_id: "",
        artigo_codigo: "",
        imagem: "",
        custo_base_unit: 0,
        margem: 0,
        roteiro: [],
        preco_unit_manual: true,
      });
    } else {
      updLinha(i, { tipo_linha: v });
    }
  };

  const applyArtigoLinha = (i, a, opts = {}) => {
    const l = orc.linhas[i];
    const livre = !!opts.descricao_livre || isDiversosArtigo(a);
    const tipoLinha = l.tipo_linha === "servico" ? "servico" : l.tipo_linha === "produto" ? "produto" : (l.tipo_linha || "produto");
    updLinha(i, {
      tipo_linha: tipoLinha,
      descricao_livre: livre,
      artigo_id: a.id,
      artigo_codigo: a.codigo || "",
      artigo_nome: opts.clear_nome ? "" : a.nome,
      imagem: l.imagem || a.imagem || "",
      custo_base_unit: Math.round(((a.custo_artigo || 0) + (a.custo_materiais || 0)) * 100) / 100,
      margem: a.margem ?? 30,
      roteiro: JSON.parse(JSON.stringify(a.roteiro || [])),
      preco_unit_manual: !!livre,
    });
  };

  const addLinha = () => {
    upd({ linhas: [...orc.linhas, emptyLinha()] });
  };

  const updLinha = (i, patch) => {
    const l = [...orc.linhas];
    l[i] = { ...l[i], ...patch };
    upd({ linhas: l });
  };
  const delLinha = (i) => upd({ linhas: orc.linhas.filter((_, idx) => idx !== i) });

  const updOp = (li, oi, patch) => {
    const r = [...(orc.linhas[li].roteiro || [])];
    r[oi] = { ...r[oi], ...patch };
    updLinha(li, { roteiro: r });
  };
  const addOp = (li) => {
    const r = [...(orc.linhas[li].roteiro || []), { nome: "", maquina_id: "", maquina_nome: "", tempo_maquina: 0, tempo_maquina_unidade: "min", mao_obra_id: "", mao_obra_nome: "", tempo_mao_obra: 0, tempo_mao_obra_unidade: "min" }];
    updLinha(li, { roteiro: r });
  };
  const delOp = (li, oi) => updLinha(li, { roteiro: (orc.linhas[li].roteiro || []).filter((_, idx) => idx !== oi) });

  const persUnit = (l) => (l.personalizacoes || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const artUnidade = (artigoId) => (artigos.find((a) => a.id === artigoId) || {}).unidade || "un";
  const addPers = (i, tipoId) => {
    const t = tipos.find((x) => x.id === tipoId);
    if (!t) return;
    const list = [...(orc.linhas[i].personalizacoes || []), { id: t.id, nome: t.nome, valor: Number(t.valor) || 0, tempo: Number(t.tempo) || 0 }];
    updLinha(i, { personalizacoes: list });
  };
  const updPers = (i, pi, patch) => {
    const list = [...(orc.linhas[i].personalizacoes || [])];
    list[pi] = { ...list[pi], ...patch };
    updLinha(i, { personalizacoes: list });
  };
  const delPers = (i, pi) => updLinha(i, { personalizacoes: (orc.linhas[i].personalizacoes || []).filter((_, idx) => idx !== pi) });

  // --- materiais soltos ---
  const isM2 = (u) => ["m²", "m2"].includes((u || "").toLowerCase());
  const matCusto = (m) => {
    if (isM2(m.unidade))
      return ((Number(m.comprimento_mm) || 0) / 1000) * ((Number(m.largura_mm) || 0) / 1000) * (Number(m.custo_unitario) || 0) * (Number(m.quantidade) || 1);
    return (Number(m.quantidade) || 0) * (Number(m.custo_unitario) || 0);
  };
  const matValor = (m) => matCusto(m) * (1 + (Number(m.margem) ?? 50) / 100);
  const updMaterial = (i, patch) => {
    const list = [...(orc.materiais || [])];
    list[i] = { ...list[i], ...patch };
    upd({ materiais: list });
  };
  const addMaterial = (cid) => {
    const c = consumiveis.find((x) => x.id === cid);
    if (!c) return;
    upd({ materiais: [...(orc.materiais || []), { consumivel_id: c.id, nome: c.nome, unidade: c.unidade, custo_unitario: Number(c.custo_unitario) || 0, quantidade: 1, comprimento_mm: 0, largura_mm: 0, margem: 50 }] });
  };
  const delMaterial = (i) => upd({ materiais: (orc.materiais || []).filter((_, idx) => idx !== i) });

  // --- descontos ---
  const lineGross = (l) => (linePreco(l) + persUnit(l)) * (l.quantidade || 0);
  const lineDisc = (l) => {
    const base = lineGross(l);
    const d = Number(l.desconto) || 0;
    if (d <= 0) return 0;
    return l.desconto_tipo === "eur" ? Math.min(d, base) : (base * d) / 100;
  };
  const lineNet = (l) => lineGross(l) - lineDisc(l);

  const subtotalVenda = orc.linhas.reduce((s, l) => s + linePreco(l) * (l.quantidade || 0), 0);
  const subtotalCusto = orc.linhas.reduce((s, l) => s + lineCusto(l) * (l.quantidade || 0), 0);
  const totalPers = orc.linhas.reduce((s, l) => s + persUnit(l) * (l.quantidade || 0), 0);
  const custoMateriais = (orc.materiais || []).reduce((s, m) => s + matCusto(m), 0);
  const totalMateriais = (orc.materiais || []).reduce((s, m) => s + matValor(m), 0);
  const descontoLinhas = orc.linhas.reduce((s, l) => s + lineDisc(l), 0);
  const subtotalLiquido = subtotalVenda + totalPers + totalMateriais - descontoLinhas;
  const descTotalVal = (() => {
    const d = Number(orc.desconto_total) || 0;
    if (d <= 0) return 0;
    return orc.desconto_total_tipo === "eur" ? Math.min(d, subtotalLiquido) : (subtotalLiquido * d) / 100;
  })();
  const total = subtotalLiquido - descTotalVal;
  const lucro = total - subtotalCusto - custoMateriais;
  const linhasAbaixoCusto = orc.linhas.filter((l) => l.artigo_id && linePreco(l) < lineCusto(l)).length;

  const linhaPronta = (l) => {
    if (!l) return false;
    if (l.artigo_id) return true;
    if ((l.tipo_linha === "descritor" || l.descricao_livre) && (l.artigo_nome || "").trim()) return true;
    return !!(l.artigo_nome || "").trim();
  };
  const requisitosEncomenda = (() => {
    if (orc.encomenda_id) return [];
    const faltas = [];
    if (!(orc.cliente_id || (orc.cliente || "").trim())) faltas.push("Selecione o cliente");
    if (!(orc.linhas || []).some(linhaPronta)) faltas.push("Adicione pelo menos uma linha (artigo, serviço ou descritor)");
    if (orc.status !== "aceite") faltas.push("Passe o estado para Aceite");
    return faltas;
  })();
  const podeCriarEncomenda = requisitosEncomenda.length === 0;

  const bodyFrom = (o) => ({
    cliente: o.cliente,
    cliente_id: o.cliente_id || null,
    descricao: o.descricao || "",
    numero_encomenda: o.numero_encomenda || "",
    data: o.data,
    validade: o.validade,
    status: o.status,
    notas: o.notas || "",
    imagens: o.imagens || [],
    desconto_total: Number(o.desconto_total) || 0,
    desconto_total_tipo: o.desconto_total_tipo || "pct",
    linhas: (o.linhas || [])
      .filter((l) => l.artigo_id || ((l.tipo_linha === "descritor" || l.descricao_livre) && (l.artigo_nome || "").trim()))
      .map((l) => ({
      ...l,
      artigo_id: l.artigo_id || "",
      artigo_codigo: l.artigo_codigo || "",
      tipo_linha: l.tipo_linha || "",
      descricao_livre: !!l.descricao_livre || l.tipo_linha === "descritor",
      quantidade: Number(l.quantidade) || 0,
      desconto: Number(l.desconto) || 0,
      desconto_tipo: l.desconto_tipo || "pct",
      personalizacoes: (l.personalizacoes || []).map((p) => ({ id: p.id, nome: p.nome, valor: Number(p.valor) || 0 })),
      valor_personalizacao: persUnit(l),
    })),
    materiais: (o.materiais || []).map((m) => ({
      ...m,
      custo_unitario: Number(m.custo_unitario) || 0,
      quantidade: Number(m.quantidade) || 0,
      comprimento_mm: Number(m.comprimento_mm) || 0,
      largura_mm: Number(m.largura_mm) || 0,
      margem: Number(m.margem) || 0,
    })),
  });

  const save = async () => {
    await api.put(`/orcamentos/${id}`, bodyFrom(orc));
    await load();
    toast.success("Orçamento guardado");
  };

  const saveImagens = async (imgs) => {
    const next = { ...orc, imagens: imgs };
    setOrc(next);
    try {
      await api.put(`/orcamentos/${id}`, bodyFrom(next));
    } catch {
      toast.error("Falha ao guardar imagens");
    }
  };

  const converter = async () => {
    try {
      const enc = await api.post(`/orcamentos/${id}/converter`);
      toast.success(`Encomenda ${enc.numero} criada`);
      nav(`/encomendas/${enc.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao converter");
    }
  };

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/orcamentos")} testid="orcamento-back-btn" label="Voltar aos orçamentos" />}
        title={orc.numero}
        badges={<StatusBadge status={orc.status} testid="orcamento-status-badge" />}
        subtitle={`Orçamento · ${orc.cliente}`}
        actions={
          <>
            <PdfExportButton modulo="orcamento" recordId={id} />
            {can("orcamentos", "edit") && (
              <EnviarEmailButton
                variant="orcamento"
                recordId={id}
                defaultTo={clienteEmail}
                clienteNome={orc.cliente}
                onSent={(res) => {
                  if (res?.status === "enviado") setOrc((o) => ({ ...o, status: "enviado" }));
                  load();
                }}
              />
            )}
            {orc.encomenda_id && (
              <Link to={`/encomendas/${orc.encomenda_id}`} data-testid="goto-encomenda-link" className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <ClipboardList size={15} /> {orc.encomenda_numero}
              </Link>
            )}
            {!orc.encomenda_id && can("encomendas", "create") && (
              <button
                data-testid="convert-quote-btn"
                onClick={converter}
                disabled={!podeCriarEncomenda}
                title={podeCriarEncomenda ? "Criar encomenda" : requisitosEncomenda.join(" · ")}
                className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
              >
                <ClipboardList size={15} /> Criar Encomenda
              </button>
            )}
            {can("orcamentos", "edit") && (
              <button data-testid="save-orcamento-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <Save size={15} /> Guardar
              </button>
            )}
          </>
        }
      />

      {/* Meta */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
          <input data-testid="orc-descricao-input" value={orc.descricao || ""} onChange={(e) => upd({ descricao: e.target.value })} placeholder="Descrição do orçamento" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Referência cliente</label>
          <input data-testid="orc-encomenda-input" value={orc.numero_encomenda || ""} onChange={(e) => upd({ numero_encomenda: e.target.value })} placeholder="Referência do cliente" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
      </div>

      {!orc.encomenda_id && requisitosEncomenda.length > 0 && (
        <div data-testid="orc-requisitos-encomenda" className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-4 py-2.5 mb-3 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <p className="font-medium">Para criar a encomenda:</p>
            <ul className="mt-1 list-disc list-inside text-amber-800/90 space-y-0.5">
              {requisitosEncomenda.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Cliente</label>
          <ClienteSelector
            value={orc.cliente_id}
            onChange={(id, nome, cli) => {
              upd({ cliente_id: id, cliente: nome });
              setClienteEmail(cli?.email || "");
            }}
            testid="orc-cliente-select"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Data</label>
          <input data-testid="orc-data-input" type="date" value={orc.data || ""} onChange={(e) => upd({ data: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Validade</label>
          <input data-testid="orc-validade-input" type="date" value={orc.validade || ""} onChange={(e) => upd({ validade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Estado</label>
          <select data-testid="orc-status-select" value={orc.status} onChange={(e) => upd({ status: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
            {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </div>
      </div>

      {/* Linhas */}
      {linhasAbaixoCusto > 0 && (
        <div data-testid="orc-alerta-margem" className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-sm px-4 py-2.5 mb-3 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span><strong>{linhasAbaixoCusto}</strong> {linhasAbaixoCusto === 1 ? "linha está" : "linhas estão"} com preço abaixo do custo de produção — está a vender a perder.</span>
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText size={16} /> Linhas do Orçamento
            <span className="text-xs font-normal tabular-nums text-gray-400">{orc.linhas.length}</span>
          </div>
        </div>
        <div className="overflow-auto max-h-[min(55vh,28rem)] lg:max-h-[min(65vh,32rem)]">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
            <tr className="border-b border-gray-200">
              <th className="text-left px-2 py-2.5 w-12 bg-white" title="Tipo (só ecrã)">
                <LinhaTipoIcon size={18} className="opacity-70" />
              </th>
              <th className="text-left px-2 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[7.5rem] bg-white">Código</th>
              <th className="text-left px-2 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[22%] bg-white">Descrição</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[16%] bg-white">Personalização</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Pers. €/un</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Qtd</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Preço Unit.</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Unit. c/Pers</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Desconto</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Subtotal</th>
              <th className="px-4 py-2.5 w-12 bg-white"></th>
            </tr>
          </thead>
          <tbody data-testid="orc-linhas">
            {orc.linhas.map((l, i) => (
              <Fragment key={l.id || i}>
              <tr className="border-b border-gray-100">
                <td className="px-2 py-2.5 align-top">
                  <LinhaTipoSelect
                    value={l.tipo_linha}
                    testid={`line-tipo-${i}`}
                    onChange={(v) => applyTipoLinha(i, v)}
                  />
                </td>
                <td className="px-2 py-2.5 align-top">
                  <LinhaCodigoSelect
                    artigos={artigos}
                    linha={l}
                    testid={`line-codigo-${i}`}
                    onArtigosRefresh={reloadArtigos}
                    onPick={(a, opts) => applyArtigoLinha(i, a, opts)}
                  />
                  {l.artigo_id && (
                    <button data-testid={`line-ops-toggle-${i}`} onClick={() => setOpenOps((o) => ({ ...o, [i]: !o[i] }))} className="mt-1 text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
                      {openOps[i] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <Cog size={12} /> Ops ({(l.roteiro || []).length})
                    </button>
                  )}
                </td>
                <td className="px-2 py-2.5 align-top">
                  <div className="flex items-start gap-2">
                    <ImagemUpload value={l.imagem} onChange={(p) => updLinha(i, { imagem: p })} size={36} editable={false} testid={`line-imagem-${i}`} />
                    <div className="flex-1 min-w-0">
                      <LinhaDescricaoInput
                        value={l.artigo_nome}
                        codigo={l.artigo_codigo || (artigos.find((a) => a.id === l.artigo_id) || {}).codigo}
                        showRef={!!l.descricao_livre || l.tipo_linha === "descritor" || isDiversosArtigo(artigos.find((a) => a.id === l.artigo_id))}
                        testid={`line-descricao-${i}`}
                        onChange={(v) => updLinha(i, { artigo_nome: v, descricao_livre: true })}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="space-y-1.5" data-testid={`line-pers-list-${i}`}>
                    {(l.personalizacoes || []).map((p, pi) => (
                      <div key={`${p.id || p.nome}-${pi}`} data-testid={`line-pers-${i}-${pi}`} className="flex items-center gap-1.5 bg-gray-100 rounded-sm pl-2 pr-1 py-1">
                        <span className="flex-1 text-xs text-gray-700 truncate" title={p.nome}>{p.nome}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <input data-testid={`line-pers-valor-${i}-${pi}`} type="number" step="0.01" value={p.valor ?? 0} onChange={(e) => updPers(i, pi, { valor: e.target.value })} className="w-16 text-right border border-gray-300 rounded-sm px-1 py-0.5 text-xs tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <span className="text-[10px] text-gray-400">€</span>
                          <button data-testid={`line-pers-del-${i}-${pi}`} onClick={() => delPers(i, pi)} className="p-0.5 rounded-sm hover:bg-red-100 text-red-600"><X size={12} /></button>
                        </div>
                      </div>
                    ))}
                    <select data-testid={`line-pers-add-${i}`} value="" onChange={(e) => { if (e.target.value) addPers(i, e.target.value); e.target.value = ""; }} className="w-full border border-dashed border-gray-300 rounded-sm px-2 py-1.5 text-xs bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-black/20">
                      <option value="">+ Adicionar personalização…</option>
                      {tipos.map((t) => <option key={t.id} value={t.id}>{`${t.nome} (${eur(t.valor)})`}</option>)}
                    </select>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 align-top" data-testid={`line-pers-total-${i}`}>{eur(persUnit(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-1.5 justify-end">
                    <input data-testid={`line-qtd-${i}`} type="number" min="0" value={l.quantidade} onChange={(e) => updLinha(i, { quantidade: e.target.value })} className="w-20 text-right border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    {l.artigo_id && <span className="text-xs text-gray-400 shrink-0">{artUnidade(l.artigo_id)}</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top" data-testid={`line-preco-${i}`}>
                  <div className="flex items-center gap-1 justify-end">
                    <input data-testid={`line-preco-input-${i}`} type="number" min="0" step="0.01" value={l.preco_unit_manual ? (l.preco_unit ?? 0) : Number(compPreco(l).toFixed(2))} onChange={(e) => updLinha(i, { preco_unit: e.target.value, preco_unit_manual: true })} className="w-24 text-right border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    {l.preco_unit_manual && <button data-testid={`line-preco-reset-${i}`} onClick={() => updLinha(i, { preco_unit_manual: false })} title="Repor preço automático" className="p-1 rounded-sm hover:bg-gray-100 text-gray-500"><RotateCcw size={13} /></button>}
                  </div>
                  {l.preco_unit_manual && <div className="text-[10px] text-blue-500 text-right mt-0.5">manual · auto {eur(compPreco(l))}</div>}
                  {linePreco(l) < lineCusto(l) && <div data-testid={`line-abaixo-custo-${i}`} className="text-[10px] text-red-600 font-medium text-right mt-0.5 flex items-center justify-end gap-1"><AlertTriangle size={10} /> abaixo do custo {eur(lineCusto(l))}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900 align-top" data-testid={`line-unit-pers-${i}`}>{eur(linePreco(l) + persUnit(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-1 justify-end">
                    <input data-testid={`line-desc-${i}`} type="number" min="0" step="0.01" value={l.desconto ?? 0} onChange={(e) => updLinha(i, { desconto: e.target.value })} className="w-16 text-right border border-gray-300 rounded-sm px-1.5 py-1.5 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                    <select data-testid={`line-desc-tipo-${i}`} value={l.desconto_tipo || "pct"} onChange={(e) => updLinha(i, { desconto_tipo: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                      <option value="pct">%</option>
                      <option value="eur">€</option>
                    </select>
                  </div>
                  {lineDisc(l) > 0 && <div className="text-[10px] text-red-500 text-right mt-0.5">- {eur(lineDisc(l))}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium align-top" data-testid={`line-subtotal-${i}`}>{eur(lineNet(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <button data-testid={`delete-line-${i}`} onClick={() => delLinha(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
              {openOps[i] && l.artigo_id && (
                <tr className="bg-gray-50/70 border-b border-gray-100">
                  <td colSpan={11} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 flex items-center gap-2"><Cog size={13} /> Operações e tempos desta linha</span>
                      <button data-testid={`line-add-op-${i}`} onClick={() => addOp(i)} className="text-xs text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={13} /> Operação</button>
                    </div>
                    <div className="space-y-2" data-testid={`line-ops-${i}`}>
                      {(l.roteiro || []).map((op, oi) => (
                        <div key={op.id || oi} className="grid grid-cols-[1fr_1fr_60px_50px_1fr_60px_50px_28px] gap-1.5 items-center bg-white border border-gray-200 rounded-sm p-1.5">
                          <input placeholder="Operação" value={op.nome || ""} onChange={(e) => updOp(i, oi, { nome: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <select value={op.maquina_id || ""} onChange={(e) => { const mq = maquinas.find((x) => x.id === e.target.value); updOp(i, oi, { maquina_id: e.target.value, maquina_nome: mq ? mq.nome : "" }); }} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                            <option value="">Máquina…</option>
                            {maquinas.map((mq) => <option key={mq.id} value={mq.id}>{mq.nome}</option>)}
                          </select>
                          <input type="number" placeholder="t" value={op.tempo_maquina ?? 0} onChange={(e) => updOp(i, oi, { tempo_maquina: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <select value={op.tempo_maquina_unidade || "min"} onChange={(e) => updOp(i, oi, { tempo_maquina_unidade: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20"><option value="min">min</option><option value="h">h</option></select>
                          <select value={op.mao_obra_id || ""} onChange={(e) => { const mo = maoObra.find((x) => x.id === e.target.value); updOp(i, oi, { mao_obra_id: e.target.value, mao_obra_nome: mo ? mo.nome : "" }); }} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                            <option value="">M. Obra…</option>
                            {maoObra.map((mo) => <option key={mo.id} value={mo.id}>{mo.nome}</option>)}
                          </select>
                          <input type="number" placeholder="t" value={op.tempo_mao_obra ?? 0} onChange={(e) => updOp(i, oi, { tempo_mao_obra: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <select value={op.tempo_mao_obra_unidade || "min"} onChange={(e) => updOp(i, oi, { tempo_mao_obra_unidade: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black/20"><option value="min">min</option><option value="h">h</option></select>
                          <button onClick={() => delOp(i, oi)} className="p-1 rounded-sm hover:bg-red-100 text-red-600 flex justify-center"><X size={14} /></button>
                        </div>
                      ))}
                      {(l.roteiro || []).length === 0 && <p className="text-xs text-gray-400">Sem operações. O custo da linha usa apenas o valor base + materiais.</p>}
                      <p className="text-[11px] text-gray-400">Custo de produção da linha: <span className="font-medium text-gray-600 tabular-nums">{eur(lineCusto(l))}</span> · Margem {l.margem ?? 0}% → Preço unit. <span className="font-medium text-gray-600 tabular-nums">{eur(linePreco(l))}</span></p>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            <tr className="border-t border-dashed border-gray-200 bg-gray-50/40">
              <td className="px-4 py-2.5" colSpan={11}>
                <button
                  type="button"
                  data-testid="add-line-item"
                  onClick={addLinha}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1.5"
                >
                  <Plus size={14} /> Adicionar linha
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <OrcamentoMateriais materiais={orc.materiais} consumiveis={consumiveis} addMaterial={addMaterial} delMaterial={delMaterial} updMaterial={updMaterial} matValor={matValor} isM2={isM2} />

      <OrcamentoTotais subtotalVenda={subtotalVenda} totalPers={totalPers} totalMateriais={totalMateriais} descontoLinhas={descontoLinhas} descTotal={orc.desconto_total} descTotalTipo={orc.desconto_total_tipo} descTotalVal={descTotalVal} onDescTotal={(v) => upd({ desconto_total: v })} onDescTotalTipo={(t) => upd({ desconto_total_tipo: t })} custoProducao={subtotalCusto + custoMateriais} lucro={lucro} total={total} ivaTaxa={empresa.iva_isento ? 0 : (Number(empresa.iva_taxa) || 0)} ivaIsento={!!empresa.iva_isento} condicoesPagamento={empresa.condicoes_pagamento} />

      <ImagensGaleria value={orc.imagens} onChange={saveImagens} title="Imagens do orçamento" hint="Imagens de referência de todo o orçamento. Transitam para a encomenda e ordem de fabrico ao converter." />

      <HistoricoTimeline tipo="orcamento" id={id} />
    </div>
  );
}
