import { useEffect, useState, useCallback, Fragment } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, eur, API } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import ClienteSelector from "../components/ClienteSelector";
import StatusBadge from "../components/StatusBadge";
import PdfExportButton from "../components/PdfExportButton";
import ArtigoCombobox from "../components/ArtigoCombobox";
import { ArrowLeft, Plus, Trash2, Save, FileText, Factory, FileDown, Cog, X, ChevronDown, ChevronRight } from "lucide-react";
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

  const load = useCallback(async () => {
    const o = await api.get(`/orcamentos/${id}`);
    // migrar personalização única (legado) para lista
    o.linhas = (o.linhas || []).map((l) => {
      if ((!l.personalizacoes || l.personalizacoes.length === 0) && l.tipo_personalizacao_id) {
        l.personalizacoes = [{ id: l.tipo_personalizacao_id, nome: l.tipo_personalizacao_nome || "", valor: Number(l.valor_personalizacao) || 0 }];
      } else if (!l.personalizacoes) {
        l.personalizacoes = [];
      }
      return l;
    });
    o.materiais = o.materiais || [];
    setOrc(o);
    setArtigos(await api.get("/artigos"));
    setTipos(await api.get("/tipos-personalizacao"));
    setMaquinas(await api.get("/maquinas"));
    setMaoObra(await api.get("/mao-obra"));
    setConsumiveis(await api.get("/consumiveis"));
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
  const linePreco = (l) => lineCusto(l) * (1 + (Number(l.margem) || 0) / 100);

  const addLinha = () =>
    upd({
      linhas: [
        ...orc.linhas,
        { artigo_id: "", artigo_nome: "", quantidade: 1, tipo_personalizacao_id: "", tipo_personalizacao_nome: "", valor_personalizacao: 0, custo_base_unit: 0, margem: 0, roteiro: [], custo_producao_unit: 0, preco_unit: 0 },
      ],
    });

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

  const subtotalVenda = orc.linhas.reduce((s, l) => s + linePreco(l) * (l.quantidade || 0), 0);
  const subtotalCusto = orc.linhas.reduce((s, l) => s + lineCusto(l) * (l.quantidade || 0), 0);
  const totalPers = orc.linhas.reduce((s, l) => s + persUnit(l) * (l.quantidade || 0), 0);
  const custoMateriais = (orc.materiais || []).reduce((s, m) => s + matCusto(m), 0);
  const totalMateriais = (orc.materiais || []).reduce((s, m) => s + matValor(m), 0);
  const total = subtotalVenda + totalPers + totalMateriais;
  const lucro = total - subtotalCusto - custoMateriais;

  const save = async () => {
    const body = {
      cliente: orc.cliente,
      cliente_id: orc.cliente_id || null,
      descricao: orc.descricao || "",
      numero_encomenda: orc.numero_encomenda || "",
      data: orc.data,
      validade: orc.validade,
      status: orc.status,
      notas: orc.notas || "",
      linhas: orc.linhas.filter((l) => l.artigo_id).map((l) => ({
        ...l,
        quantidade: Number(l.quantidade) || 0,
        personalizacoes: (l.personalizacoes || []).map((p) => ({ id: p.id, nome: p.nome, valor: Number(p.valor) || 0 })),
        valor_personalizacao: persUnit(l),
      })),
      materiais: (orc.materiais || []).map((m) => ({
        ...m,
        custo_unitario: Number(m.custo_unitario) || 0,
        quantidade: Number(m.quantidade) || 0,
        comprimento_mm: Number(m.comprimento_mm) || 0,
        largura_mm: Number(m.largura_mm) || 0,
        margem: Number(m.margem) || 0,
      })),
    };
    await api.put(`/orcamentos/${id}`, body);
    await load();
    toast.success("Orçamento guardado");
  };

  const converter = async () => {
    try {
      const of = await api.post(`/orcamentos/${id}/converter`);
      toast.success(`Ordem de Fabrico ${of.numero} criada`);
      nav(`/ordens-fabrico/${of.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao converter");
    }
  };

  return (
    <div>
      <button onClick={() => nav("/orcamentos")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={16} /> Voltar aos orçamentos
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{orc.numero}</h1>
            <StatusBadge status={orc.status} testid="orcamento-status-badge" />
          </div>
          <p className="text-sm text-gray-500 mt-1">Orçamento · {orc.cliente}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <PdfExportButton modulo="orcamento" recordId={id} />
          {orc.of_id && (
            <Link to={`/ordens-fabrico/${orc.of_id}`} data-testid="goto-of-link" className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Factory size={16} /> {orc.of_numero}
            </Link>
          )}
          {!orc.of_id && can("ordens_fabrico", "create") && (
            <button data-testid="convert-quote-btn" onClick={converter} className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Factory size={16} /> Criar Ordem de Fabrico
            </button>
          )}
          {can("orcamentos", "edit") && (
            <button data-testid="save-orcamento-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Save size={16} /> Guardar
            </button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
          <input data-testid="orc-descricao-input" value={orc.descricao || ""} onChange={(e) => upd({ descricao: e.target.value })} placeholder="Descrição do orçamento" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Nº da Encomenda</label>
          <input data-testid="orc-encomenda-input" value={orc.numero_encomenda || ""} onChange={(e) => upd({ numero_encomenda: e.target.value })} placeholder="Nº de encomenda no software" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
      </div>

      {/* Meta */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Cliente</label>
          <ClienteSelector value={orc.cliente_id} onChange={(id, nome) => upd({ cliente_id: id, cliente: nome })} testid="orc-cliente-select" />
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
      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700"><FileText size={16} /> Linhas do Orçamento</div>
          <button data-testid="add-line-item" onClick={addLinha} className="text-sm text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={14} /> Adicionar linha</button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[24%]">Artigo</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[18%]">Personalização</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pers. €/un</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Qtd</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Preço Unit.</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subtotal</th>
              <th className="px-4 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody data-testid="orc-linhas">
            {orc.linhas.map((l, i) => (
              <Fragment key={i}>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-2.5">
                  <ArtigoCombobox
                    artigos={artigos}
                    value={l.artigo_id}
                    testid={`line-artigo-${i}`}
                    onChange={(a) => updLinha(i, { artigo_id: a.id, artigo_nome: a.nome, custo_base_unit: Math.round(((a.custo_artigo || 0) + (a.custo_materiais || 0)) * 100) / 100, margem: a.margem ?? 30, roteiro: JSON.parse(JSON.stringify(a.roteiro || [])) })}
                  />
                  {l.artigo_id && (
                    <button data-testid={`line-ops-toggle-${i}`} onClick={() => setOpenOps((o) => ({ ...o, [i]: !o[i] }))} className="mt-1.5 text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
                      {openOps[i] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <Cog size={12} /> Operações ({(l.roteiro || []).length})
                    </button>
                  )}
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
                      {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome} ({eur(t.valor)})</option>)}
                    </select>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 align-top" data-testid={`line-pers-total-${i}`}>{eur(persUnit(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <input data-testid={`line-qtd-${i}`} type="number" min="0" value={l.quantidade} onChange={(e) => updLinha(i, { quantidade: e.target.value })} className="w-20 text-right border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 align-top" data-testid={`line-preco-${i}`}>{eur(linePreco(l))}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium align-top">{eur((linePreco(l) + persUnit(l)) * (l.quantidade || 0))}</td>
                <td className="px-4 py-2.5 align-top">
                  <button data-testid={`delete-line-${i}`} onClick={() => delLinha(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
              {openOps[i] && l.artigo_id && (
                <tr className="bg-gray-50/70 border-b border-gray-100">
                  <td colSpan={7} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 flex items-center gap-2"><Cog size={13} /> Operações e tempos desta linha</span>
                      <button data-testid={`line-add-op-${i}`} onClick={() => addOp(i)} className="text-xs text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={13} /> Operação</button>
                    </div>
                    <div className="space-y-2" data-testid={`line-ops-${i}`}>
                      {(l.roteiro || []).map((op, oi) => (
                        <div key={oi} className="grid grid-cols-[1fr_1fr_60px_50px_1fr_60px_50px_28px] gap-1.5 items-center bg-white border border-gray-200 rounded-sm p-1.5">
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
            {orc.linhas.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem linhas. Adicione um artigo.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Materiais / Consumíveis soltos */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 font-display">Materiais / Consumíveis</h2>
            <p className="text-xs text-gray-500">Materiais soltos adicionados ao orçamento, com margem editável por linha.</p>
          </div>
          <select
            data-testid="add-material-select"
            value=""
            onChange={(e) => { if (e.target.value) addMaterial(e.target.value); e.target.value = ""; }}
            className="border border-dashed border-gray-300 rounded-sm px-3 py-2 text-sm bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-black/20 sm:w-64"
          >
            <option value="">+ Adicionar material…</option>
            {consumiveis.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.unidade} · {eur(c.custo_unitario)})</option>)}
          </select>
        </div>

        {(orc.materiais || []).length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Sem materiais adicionados.</p>
        ) : (
          <div className="space-y-3" data-testid="materiais-list">
            {(orc.materiais || []).map((m, i) => (
              <div key={m.id || i} data-testid={`material-row-${i}`} className="border border-gray-200 rounded-sm p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-medium text-gray-900 text-sm">{m.nome} <span className="text-gray-400 font-normal">· {m.unidade} · {eur(m.custo_unitario)}/{m.unidade}</span></div>
                  <button data-testid={`del-material-${i}`} onClick={() => delMaterial(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Quantidade</label>
                    <input data-testid={`material-qtd-${i}`} type="number" min="0" value={m.quantidade} onChange={(e) => updMaterial(i, { quantidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                  </div>
                  {isM2(m.unidade) && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Comprimento (mm)</label>
                        <input data-testid={`material-comp-${i}`} type="number" min="0" value={m.comprimento_mm} onChange={(e) => updMaterial(i, { comprimento_mm: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Largura (mm)</label>
                        <input data-testid={`material-larg-${i}`} type="number" min="0" value={m.largura_mm} onChange={(e) => updMaterial(i, { largura_mm: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Margem (%)</label>
                    <input data-testid={`material-margem-${i}`} type="number" min="0" value={m.margem ?? 50} onChange={(e) => updMaterial(i, { margem: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                  </div>
                  <div className="text-right">
                    <label className="text-xs text-gray-500 mb-1 block">Valor</label>
                    <div className="tabular-nums font-semibold text-gray-900 py-2" data-testid={`material-valor-${i}`}>{eur(matValor(m))}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totais */}
      <div className="flex justify-end">
        <div className="bg-white border border-gray-200 rounded-sm p-5 w-full max-w-sm space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Preço dos artigos</span>
            <span className="tabular-nums font-medium" data-testid="orc-subtotal-venda">{eur(subtotalVenda)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Personalização</span>
            <span className="tabular-nums font-medium" data-testid="orc-personalizacao">{eur(totalPers)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Materiais</span>
            <span className="tabular-nums font-medium" data-testid="orc-materiais">{eur(totalMateriais)}</span>
          </div>
          <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-3">
            <span className="text-gray-400">Custo de produção</span>
            <span className="tabular-nums text-gray-400" data-testid="orc-subtotal">{eur(subtotalCusto + custoMateriais)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Lucro estimado</span>
            <span className="tabular-nums text-emerald-600" data-testid="orc-lucro">{eur(lucro)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-gray-200 pt-3">
            <span className="font-semibold text-gray-900">Preço Final</span>
            <span className="tabular-nums font-bold text-xl font-display" data-testid="orc-total">{eur(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
