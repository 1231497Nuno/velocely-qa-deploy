import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import FicheirosTab from "@/components/FicheirosTab";
import SeccaoPesquisavel from "@/components/SeccaoPesquisavel";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import {
  FileText, ClipboardList, Factory, Coins, Package, TrendingUp, ChevronRight, Plus, X, Pencil, Calculator, Tag,
} from "lucide-react";
import { isDiversosArtigo } from "@/components/LinhaTipoIcon";
import { toast } from "sonner";
import {
  TIPO_ARTIGO_PT,
  normalizarTipo,
  isProduzido,
  buildArtigoBody,
  mostraCampo,
} from "@/features/artigos/artigoTipos";
import ArtigoBlocosShell from "@/features/artigos/ArtigoBlocosShell";
import ArtigoFichaCampos from "@/features/artigos/ArtigoFichaCampos";
import { InlineField, fieldCls, contentWidthCh, fitInputCls, fitSelectCls } from "@/features/artigos/ArtigoInlineEdit";

const toHours = (val, unit) => (Number(val) || 0) / (unit === "h" ? 1 : 60);
const maqHora = (m) => (m ? (Number(m.custo_amortizacao_hora) || 0) + (Number(m.custo_energia_hora) || 0) : 0);

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

function artigoToDraft(a) {
  if (!a) return null;
  const tipo = normalizarTipo(a);
  const produzido = isProduzido({ ...a, tipo_artigo: tipo });
  return {
    nome: a.nome || "",
    descricao: a.descricao || "",
    unidade: a.unidade || "un",
    imagem: a.imagem || "",
    tipo_artigo: tipo,
    produzido,
    custo_artigo: a.custo_artigo ?? 0,
    margem: isDiversosArtigo(a) || tipo === "consumivel" ? 0 : (a.margem ?? 30),
    comissao_pct: a.comissao_pct ?? 0,
    categoria_id: a.categoria_id || "",
    categoria_nome: a.categoria_nome || "",
    subcategoria_id: a.subcategoria_id || "",
    subcategoria_nome: a.subcategoria_nome || "",
    ativo: a.ativo !== false,
    fabricante: a.fabricante || "",
    cod_fabricante: a.cod_fabricante || "",
    fornecedor_id: a.fornecedor_id || "",
    fornecedor_nome: a.fornecedor_nome || "",
    cod_fornecedor: a.cod_fornecedor || "",
    website: a.website || "",
    ficha_produto: a.ficha_produto || "",
    plano_contas: a.plano_contas || "",
    codigo_produto: a.codigo_produto || "",
    comprimento_mm: a.comprimento_mm ?? 0,
    largura_mm: a.largura_mm ?? 0,
    espessura_mm: a.espessura_mm ?? 0,
    peso_kg: a.peso_kg ?? 0,
    comprimento_unidade: a.comprimento_unidade || "mm",
    largura_unidade: a.largura_unidade || "mm",
    espessura_unidade: a.espessura_unidade || "mm",
    peso_unidade: a.peso_unidade || "kg",
    responsavel: a.responsavel || "",
    qtd_uni: a.qtd_uni ?? 1,
    qtd_stock: a.qtd_stock ?? 0,
    nivel_reabastecimento: a.nivel_reabastecimento ?? 0,
    qtd_ultima_compra: a.qtd_ultima_compra ?? 0,
    materiais: Array.isArray(a.materiais) ? a.materiais.map((m) => ({ ...m })) : [],
    roteiro: Array.isArray(a.roteiro) ? a.roteiro.map((op) => ({ ...op })) : [],
    diversos: !!a.diversos,
    codigo: a.codigo || "",
  };
}

export default function ArtigoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const canEdit = can("artigos", "edit");
  const showOfTab = can("ordens_fabrico", "view");
  const tabIds = [
    "artigo",
    "encomendas",
    "orcamentos",
    ...(showOfTab ? ["ordens_fabrico"] : []),
    "ficheiros",
    "historico",
  ];
  const [tab, setTab] = useDetailTab(tabIds, "artigo");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [maquinas, setMaquinas] = useState([]);
  const [consumiveis, setConsumiveis] = useState([]); // componentes (artigos + legado)
  const [maoObra, setMaoObra] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [saving, setSaving] = useState(false);
  const [fieldSaving, setFieldSaving] = useState(false);
  const [lookupsReady, setLookupsReady] = useState(false);
  const fieldRefs = useRef({});
  const artigoRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    const quickP = api.get(`/artigos/${id}`).then((artigo) => {
      setData((prev) => prev || {
        artigo,
        orcamentos: [],
        encomendas: [],
        ordens_fabrico: [],
        stats: {
          num_orcamentos: "…", num_encomendas: "…", num_ofs: "…",
          qtd_orcada: "…", qtd_encomendada: "…", qtd_produzida: "…",
          receita: null, custo: null, ganho: null,
        },
        _parcial: true,
      });
      setDraft(artigoToDraft(artigo));
      setLoading(false);
    }).catch(() => null);

    const fullP = api.get(`/artigos/${id}/resumo`).then((resumo) => {
      setData({ ...resumo, _parcial: false });
      setDraft(artigoToDraft(resumo.artigo));
      setLoading(false);
      return resumo;
    }).catch(() => null);

    const [, full] = await Promise.all([quickP, fullP]);
    if (full == null) setLoading(false);
  }, [id]);

  useEffect(() => {
    setEditing(false);
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    artigoRef.current = data?.artigo || null;
  }, [data?.artigo]);

  const loadLookups = useCallback(async () => {
    if (lookupsReady) return;
    try {
      const [maq, cons, mo, cats, subs, artsCons, artsAtivo] = await Promise.all([
        api.get("/maquinas"),
        api.get("/consumiveis").catch(() => []),
        api.get("/mao-obra"),
        api.get("/categorias"),
        api.get("/subcategorias"),
        api.get("/artigos?lite=true&tipo=consumivel").catch(() => []),
        api.get("/artigos?lite=true&tipo=ativo").catch(() => []),
      ]);
      setMaquinas(maq);
      setMaoObra(mo);
      setCategorias(cats);
      setSubcategorias(subs);
      const byId = new Map();
      for (const a of [...(Array.isArray(artsCons) ? artsCons : []), ...(Array.isArray(artsAtivo) ? artsAtivo : [])]) {
        byId.set(a.id, a);
      }
      for (const c of cons || []) {
        if (!byId.has(c.id)) {
          byId.set(c.id, { id: c.id, nome: c.nome, unidade: c.unidade, custo_artigo: c.custo_unitario, codigo: c.codigo });
        }
      }
      setConsumiveis([...byId.values()].sort((a, b) => (a.nome || "").localeCompare(b.nome || "")));
      setLookupsReady(true);
    } catch {
      /* ignore */
    }
  }, [lookupsReady]);

  useEffect(() => {
    if (canEdit) loadLookups();
  }, [canEdit, loadLookups]);

  const applyArtigo = useCallback((artigo) => {
    setData((prev) => (prev ? { ...prev, artigo: { ...prev.artigo, ...artigo } } : prev));
    setDraft(artigoToDraft(artigo));
  }, []);

  /** Gravação rápida de 1 campo (fora do modo edição completo). */
  const saveFieldPatch = useCallback(async (patch) => {
    if (!canEdit || editing) return;
    const base = artigoToDraft(artigoRef.current);
    if (!base) return;
    const next = { ...base, ...patch };
    if (!String(next.nome || "").trim()) {
      toast.error("Indique o nome do artigo");
      return;
    }
    setFieldSaving(true);
    try {
      await api.put(`/artigos/${id}`, buildArtigoBody(next));
      const artigo = await api.get(`/artigos/${id}`);
      applyArtigo(artigo);
    } catch (e) {
      toast.error(e?.message || "Erro ao guardar");
    } finally {
      setFieldSaving(false);
    }
  }, [canEdit, editing, id, applyArtigo]);

  const startFullEdit = async () => {
    if (!canEdit || !data?.artigo) return;
    setDraft(artigoToDraft(data.artigo));
    setEditing(true);
    await loadLookups();
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(artigoToDraft(data?.artigo));
  };

  const saveEdit = async () => {
    if (!draft) return;
    if (!String(draft.nome || "").trim()) return toast.error("Indique o nome do artigo");
    setSaving(true);
    try {
      await api.put(`/artigos/${id}`, buildArtigoBody(draft));
      const artigo = await api.get(`/artigos/${id}`);
      applyArtigo(artigo);
      setEditing(false);
      toast.success("Artigo guardado");
      api.get(`/artigos/${id}/resumo`).then((resumo) => {
        setData({ ...resumo, _parcial: false });
        setDraft(artigoToDraft(resumo.artigo));
      }).catch(() => null);
    } catch (e) {
      toast.error(e?.message || "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <div className="text-sm text-gray-500">A carregar...</div>;
  if (!data) return <div className="text-sm text-gray-500">Artigo não encontrado.</div>;

  const { artigo: a, orcamentos, encomendas, ordens_fabrico, stats } = data;
  const parcial = Boolean(data._parcial);
  const view = editing ? draft : (draft || artigoToDraft(a));
  const tipoAtual = normalizarTipo(view || a);
  const produzido = tipoAtual === "ativo" && isProduzido(editing ? draft : (view || a));
  const show = (campo) => mostraCampo(tipoAtual, campo);
  const isDiversos = isDiversosArtigo(view || a);

  // Cálculo em direto (modo edição)
  const custoMateriais = (editing && produzido)
    ? (draft.materiais || []).reduce((s, m) => s + (Number(m.quantidade) || 0) * (Number(m.custo_unitario) || 0), 0)
    : (produzido ? (a.custo_materiais ?? 0) : 0);
  const custoMaquinas = (editing && produzido)
    ? (draft.roteiro || []).reduce((s, op) => {
      const maq = maquinas.find((x) => x.id === op.maquina_id);
      return s + toHours(op.tempo_maquina, op.tempo_maquina_unidade) * maqHora(maq);
    }, 0)
    : (produzido ? (a.custo_maquinas ?? 0) : 0);
  const custoMaoObra = (editing && produzido)
    ? (draft.roteiro || []).reduce((s, op) => {
      const mo = maoObra.find((x) => x.id === op.mao_obra_id);
      return s + toHours(op.tempo_mao_obra, op.tempo_mao_obra_unidade) * (mo ? Number(mo.custo_hora) || 0 : 0);
    }, 0)
    : (produzido ? (a.custo_mao_obra ?? 0) : 0);
  const custoCompra = editing ? (Number(draft?.custo_artigo) || 0) : (Number(a.custo_artigo) || 0);
  const custoTotal = editing
    ? custoCompra + (produzido ? custoMateriais + custoMaquinas + custoMaoObra : 0)
    : (a.custo_producao_total ?? (custoCompra + custoMateriais + custoMaquinas + custoMaoObra));
  const margemPct = isDiversos || tipoAtual === "consumivel" ? 0 : (editing ? (Number(draft?.margem) || 0) : (Number(a.margem) || 0));
  const precoVenda = editing
    ? custoTotal * (1 + margemPct / 100)
    : (a.preco_venda ?? (custoTotal * (1 + margemPct / 100)));

  const kpiVal = (v, money = false) => {
    if (v === "…" || v == null) return parcial ? "…" : (money ? eur(0) : 0);
    return money ? eur(v) : v;
  };

  const tabs = [
    { id: "artigo", label: "Artigo", testid: "artigo-tab-artigo" },
    { id: "encomendas", label: "Encomendas", testid: "artigo-tab-encomendas" },
    { id: "orcamentos", label: "Orçamentos", testid: "artigo-tab-orcamentos" },
    ...(showOfTab ? [{ id: "ordens_fabrico", label: "Ordens de fabrico", testid: "artigo-tab-ofs" }] : []),
    { id: "ficheiros", label: "Ficheiros", testid: "artigo-tab-ficheiros" },
    { id: "historico", label: "Histórico", testid: "artigo-tab-historico" },
  ];

  const setCategoria = (categoria_id) => {
    const cat = categorias.find((c) => c.id === categoria_id);
    if (editing) {
      setDraft((prev) => ({
        ...prev,
        categoria_id: categoria_id || "",
        categoria_nome: cat?.nome || "",
        subcategoria_id: "",
        subcategoria_nome: "",
      }));
    } else {
      saveFieldPatch({
        categoria_id: categoria_id || "",
        categoria_nome: cat?.nome || "",
        subcategoria_id: "",
        subcategoria_nome: "",
      });
    }
  };

  const setSubcategoria = (subcategoria_id) => {
    const sub = subcategorias.find((s) => s.id === subcategoria_id);
    if (editing) {
      setDraft((prev) => ({
        ...prev,
        subcategoria_id: subcategoria_id || "",
        subcategoria_nome: sub?.nome || "",
      }));
    } else {
      saveFieldPatch({
        subcategoria_id: subcategoria_id || "",
        subcategoria_nome: sub?.nome || "",
      });
    }
  };

  const setTipo = (tipo_artigo) => {
    const apply = (prev) => {
      const nextTipo = tipo_artigo === "produzido" ? "ativo" : tipo_artigo;
      const keepProd = nextTipo === "ativo" && !!prev.produzido;
      return {
        ...prev,
        tipo_artigo: nextTipo,
        produzido: keepProd,
        margem: nextTipo === "consumivel" || prev.diversos ? 0 : (prev.margem ?? 30),
        materiais: keepProd ? (prev.materiais || []) : [],
        roteiro: keepProd ? (prev.roteiro || []) : [],
        comprimento_mm: nextTipo === "servico" ? 0 : prev.comprimento_mm,
        largura_mm: nextTipo === "servico" ? 0 : prev.largura_mm,
        espessura_mm: nextTipo === "servico" ? 0 : prev.espessura_mm,
        peso_kg: nextTipo === "servico" ? 0 : prev.peso_kg,
        ativo: nextTipo !== "inativo",
      };
    };
    if (editing) setDraft((prev) => apply(prev));
    else saveFieldPatch(apply(artigoToDraft(a)));
  };

  const setProduzido = (checked) => {
    const apply = (prev) => ({
      ...prev,
      produzido: checked,
      materiais: checked ? (prev.materiais || []) : [],
      roteiro: checked ? (prev.roteiro || []) : [],
    });
    if (editing) setDraft((prev) => apply(prev));
    else saveFieldPatch(apply(artigoToDraft(a)));
  };

  const updMat = (i, patch) => {
    setDraft((prev) => {
      const materiais = [...(prev.materiais || [])];
      materiais[i] = { ...materiais[i], ...patch };
      return { ...prev, materiais };
    });
  };
  const updOp = (i, patch) => {
    setDraft((prev) => {
      const roteiro = [...(prev.roteiro || [])];
      roteiro[i] = { ...roteiro[i], ...patch };
      return { ...prev, roteiro };
    });
  };

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/artigos")} testid="artigo-back-btn" label="Voltar aos artigos" />}
        title={
          <div className="min-w-0">
            {(view?.codigo || a.codigo) && (
              <div className="mono text-xs tabular-nums text-gray-500" data-testid="artigo-codigo">{view?.codigo || a.codigo}</div>
            )}
            {editing ? (
              <input
                ref={(el) => { fieldRefs.current.nome = el; }}
                data-testid="artigo-nome-input"
                value={draft?.nome || ""}
                onChange={(e) => setDraft((p) => ({ ...p, nome: e.target.value }))}
                className={`${fieldCls} font-bold text-lg font-display max-w-xl`}
              />
            ) : (
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-gray-900 font-display" data-testid="artigo-nome">
                <InlineField
                  value={a.nome}
                  canEdit={canEdit}
                  onSave={(v) => saveFieldPatch({ nome: String(v).trim() })}
                  className="font-bold text-lg sm:text-xl font-display text-left"
                  testid="artigo-nome-edit"
                  placeholder="Nome do artigo"
                />
              </h1>
            )}
          </div>
        }
        subtitle={
          editing
            ? `${TIPO_ARTIGO_PT[tipoAtual] || tipoAtual}${produzido ? " · Produzido" : ""} — campos conforme o tipo · Guardar ou Cancelar`
            : ([TIPO_ARTIGO_PT[tipoAtual], produzido ? "Produzido" : null, a.categoria_nome, a.subcategoria_nome].filter(Boolean).join(" · ")
              || (canEdit ? "Clique num campo para editar · Editar para modo completo" : null))
        }
        actions={
          <div className="flex items-center gap-2 sm:gap-3 text-sm flex-wrap justify-end">
            {!editing && (
              <>
                <span className="text-gray-500">Venda <span className="tabular-nums font-bold text-emerald-700">{eur(a.preco_venda)}</span></span>
                <span className="text-gray-400">Custo <span className="tabular-nums font-medium text-gray-700">{eur(a.custo_producao_total)}</span></span>
                {fieldSaving && <span className="text-xs text-gray-400">A guardar…</span>}
              </>
            )}
            {canEdit && !editing && (
              <button
                type="button"
                data-testid="artigo-edit-btn"
                onClick={startFullEdit}
                className="inline-flex items-center gap-1.5 bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium"
              >
                <Pencil size={14} /> Editar
              </button>
            )}
            {editing && (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  data-testid="artigo-save-btn"
                  onClick={saveEdit}
                  disabled={saving}
                  className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                >
                  {saving ? "A guardar…" : "Guardar"}
                </button>
              </>
            )}
          </div>
        }
      />

      <DetailTabs testid="artigo-tabs" value={tab} onChange={setTab} tabs={tabs} />

      {tab === "artigo" && (
        <>
          {/* KPIs gerais no topo */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <KPI icon={FileText} label="Orçamentos" value={kpiVal(stats.num_orcamentos)} sub={`${kpiVal(stats.qtd_orcada)} un orçadas`} testid="artigo-kpi-orcamentos" />
            <KPI icon={ClipboardList} label="Encomendas" value={kpiVal(stats.num_encomendas)} sub={`${kpiVal(stats.qtd_encomendada)} un encomendadas`} testid="artigo-kpi-encomendas" />
            {showOfTab && (
              <KPI icon={Factory} label="Ordens de Fabrico" value={kpiVal(stats.num_ofs)} sub={`${kpiVal(stats.qtd_produzida)} un em produção`} testid="artigo-kpi-ofs" />
            )}
            <KPI icon={Package} label="Un. Encomendadas" value={kpiVal(stats.qtd_encomendada)} testid="artigo-kpi-qtd-enc" />
            <KPI icon={Coins} label="Receita" value={kpiVal(stats.receita, true)} sub={`Custo ${kpiVal(stats.custo, true)}`} testid="artigo-kpi-receita" />
            <KPI icon={TrendingUp} label="Ganho estimado" value={kpiVal(stats.ganho, true)} sub="Receita − custo de produção" testid="artigo-kpi-ganho" />
          </div>

          <ArtigoBlocosShell
            tipo={tipoAtual}
            produzido={produzido}
            renderBlock={(blocoId) => {
              if (blocoId === "detalhes" || blocoId === "dimensoes" || blocoId === "preco" || blocoId === "stock") {
                return (
                  <ArtigoFichaCampos
                    blocoId={blocoId}
                    artigo={a}
                    draft={draft}
                    editing={editing}
                    canEdit={canEdit}
                    categorias={categorias}
                    subcategorias={subcategorias}
                    precoVenda={precoVenda}
                    onChange={(patch) => setDraft((p) => ({ ...p, ...patch }))}
                    onPatch={saveFieldPatch}
                    onSetTipo={setTipo}
                    onSetProduzido={setProduzido}
                    onSetCategoria={setCategoria}
                    onSetSubcategoria={setSubcategoria}
                  />
                );
              }

              if (blocoId === "materiais") {
                return (
                  <div className="overflow-x-auto" data-testid="artigo-materiais">
                    {editing && (
                      <div className="px-4 py-2 border-b border-gray-100 flex justify-end">
                        <button
                          type="button"
                          data-testid="artigo-add-material"
                          onClick={() => setDraft((p) => ({
                            ...p,
                            materiais: [...(p.materiais || []), { material_id: "", material_nome: "", unidade: "un", quantidade: 1, custo_unitario: 0 }],
                          }))}
                          className="text-xs font-medium text-gray-900 inline-flex items-center gap-1 hover:underline"
                        >
                          <Plus size={13} /> Material
                        </button>
                      </div>
                    )}
                    <table className="w-full text-sm min-w-[420px]">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <Th>Artigo / componente</Th>
                          <Th align="right">Qtd</Th>
                          <Th>Un.</Th>
                          <Th align="right">Custo unit.</Th>
                          <Th align="right">Total</Th>
                          {editing && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {((editing ? draft?.materiais : a.materiais) || []).map((m, i) => {
                          const qtd = Number(m.quantidade) || 0;
                          const custo = Number(m.custo_unitario) || 0;
                          return (
                            <tr key={m.id || i} className="border-b border-gray-50" data-testid={`artigo-material-row-${i}`}>
                              <td className="px-4 py-2">
                                {editing ? (
                                  <select
                                    value={m.material_id || ""}
                                    onChange={(e) => {
                                      const c = consumiveis.find((x) => x.id === e.target.value);
                                      updMat(i, {
                                        material_id: e.target.value,
                                        material_nome: c?.nome || "",
                                        unidade: c?.unidade || "un",
                                        custo_unitario: c?.custo_artigo ?? c?.custo_unitario ?? 0,
                                      });
                                    }}
                                    className={fieldCls}
                                  >
                                    <option value="">Selecionar artigo…</option>
                                    {consumiveis.map((c) => (
                                      <option key={c.id} value={c.id}>{c.nome}{c.codigo ? ` (${c.codigo})` : ""}</option>
                                    ))}
                                  </select>
                                ) : (m.material_nome || "—")}
                              </td>
                              <td className="px-4 py-2 text-right">
                                {editing ? (
                                  <input type="number" step="0.01" value={m.quantidade} onChange={(e) => updMat(i, { quantidade: e.target.value })} className={`${fieldCls} text-right tabular-nums`} />
                                ) : <span className="tabular-nums">{qtd}</span>}
                              </td>
                              <td className="px-4 py-2.5 text-gray-600">{m.unidade || "un"}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{eur(custo)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium">{eur(qtd * custo)}</td>
                              {editing && (
                                <td className="px-2 py-2">
                                  <button type="button" onClick={() => setDraft((p) => ({ ...p, materiais: p.materiais.filter((_, idx) => idx !== i) }))} className="p-1 rounded-sm hover:bg-red-100 text-red-600">
                                    <X size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {((editing ? draft?.materiais : a.materiais) || []).length === 0 && (
                          <tr>
                            <td colSpan={editing ? 6 : 5} className="px-4 py-8 text-center text-gray-400 text-sm">
                              {editing ? "Clique em + Material para adicionar componentes." : "Sem materiais definidos."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (blocoId === "operacoes") {
                return (
                  <div className="overflow-x-auto" data-testid="artigo-operacoes">
                    {editing && (
                      <div className="px-4 py-2 border-b border-gray-100 flex justify-end">
                        <button
                          type="button"
                          data-testid="artigo-add-operacao"
                          onClick={() => setDraft((p) => ({
                            ...p,
                            roteiro: [...(p.roteiro || []), {
                              nome: "", maquina_id: "", maquina_nome: "", tempo_maquina: 0, tempo_maquina_unidade: "min",
                              mao_obra_id: "", mao_obra_nome: "", tempo_mao_obra: 0, tempo_mao_obra_unidade: "min",
                            }],
                          }))}
                          className="text-xs font-medium text-gray-900 inline-flex items-center gap-1 hover:underline"
                        >
                          <Plus size={13} /> Operação
                        </button>
                      </div>
                    )}
                    <table className="w-full text-sm min-w-[520px]">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <Th>Operação</Th>
                          <Th>Máquina</Th>
                          <Th align="right">Tempo máq.</Th>
                          <Th>Mão de obra</Th>
                          <Th align="right">Tempo MO</Th>
                          {editing && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {((editing ? draft?.roteiro : a.roteiro) || []).map((op, i) => (
                          <tr key={op.id || i} className="border-b border-gray-50" data-testid={`artigo-op-row-${i}`}>
                            <td className="px-4 py-2">
                              {editing ? (
                                <input value={op.nome || ""} onChange={(e) => updOp(i, { nome: e.target.value })} className={fieldCls} placeholder="Nome" />
                              ) : (op.nome || "—")}
                            </td>
                            <td className="px-4 py-2">
                              {editing ? (
                                <select
                                  value={op.maquina_id || ""}
                                  onChange={(e) => {
                                    const mq = maquinas.find((x) => x.id === e.target.value);
                                    updOp(i, { maquina_id: e.target.value, maquina_nome: mq?.nome || "" });
                                  }}
                                  className={fieldCls}
                                >
                                  <option value="">—</option>
                                  {maquinas.map((mq) => <option key={mq.id} value={mq.id}>{mq.nome}</option>)}
                                </select>
                              ) : (op.maquina_nome || "—")}
                            </td>
                            <td className="px-4 py-2 text-right">
                          {editing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                value={op.tempo_maquina}
                                onChange={(e) => updOp(i, { tempo_maquina: e.target.value })}
                                className={`${fitInputCls} text-right`}
                                style={{
                                  width: contentWidthCh(op.tempo_maquina, { min: 5, max: 12, pad: 2.5 }),
                                  minWidth: "5ch",
                                  maxWidth: "12ch",
                                }}
                              />
                              <select
                                value={op.tempo_maquina_unidade || "min"}
                                onChange={(e) => updOp(i, { tempo_maquina_unidade: e.target.value })}
                                className={fitSelectCls}
                                style={{ minWidth: "3.5rem", maxWidth: "4.5rem", width: contentWidthCh(op.tempo_maquina_unidade || "min", { min: 5.5, max: 7, pad: 3 }) }}
                              >
                                <option value="min">min</option>
                                <option value="h">h</option>
                              </select>
                            </div>
                          ) : (
                            <span className="tabular-nums">{Number(op.tempo_maquina) || 0} {op.tempo_maquina_unidade || "min"}</span>
                          )}
                            </td>
                            <td className="px-4 py-2">
                              {editing ? (
                                <select
                                  value={op.mao_obra_id || ""}
                                  onChange={(e) => {
                                    const mo = maoObra.find((x) => x.id === e.target.value);
                                    updOp(i, { mao_obra_id: e.target.value, mao_obra_nome: mo?.nome || "" });
                                  }}
                                  className={fieldCls}
                                >
                                  <option value="">—</option>
                                  {maoObra.map((mo) => <option key={mo.id} value={mo.id}>{mo.nome}</option>)}
                                </select>
                              ) : (op.mao_obra_nome || "—")}
                            </td>
                            <td className="px-4 py-2 text-right">
                          {editing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                value={op.tempo_mao_obra}
                                onChange={(e) => updOp(i, { tempo_mao_obra: e.target.value })}
                                className={`${fitInputCls} text-right`}
                                style={{
                                  width: contentWidthCh(op.tempo_mao_obra, { min: 5, max: 12, pad: 2.5 }),
                                  minWidth: "5ch",
                                  maxWidth: "12ch",
                                }}
                              />
                              <select
                                value={op.tempo_mao_obra_unidade || "min"}
                                onChange={(e) => updOp(i, { tempo_mao_obra_unidade: e.target.value })}
                                className={fitSelectCls}
                                style={{ minWidth: "3.5rem", maxWidth: "4.5rem", width: contentWidthCh(op.tempo_mao_obra_unidade || "min", { min: 5.5, max: 7, pad: 3 }) }}
                              >
                                <option value="min">min</option>
                                <option value="h">h</option>
                              </select>
                            </div>
                          ) : (
                            <span className="tabular-nums">{Number(op.tempo_mao_obra) || 0} {op.tempo_mao_obra_unidade || "min"}</span>
                          )}
                            </td>
                            {editing && (
                              <td className="px-2 py-2">
                                <button type="button" onClick={() => setDraft((p) => ({ ...p, roteiro: p.roteiro.filter((_, idx) => idx !== i) }))} className="p-1 rounded-sm hover:bg-red-100 text-red-600">
                                  <X size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                        {((editing ? draft?.roteiro : a.roteiro) || []).length === 0 && (
                          <tr>
                            <td colSpan={editing ? 6 : 5} className="px-4 py-8 text-center text-gray-400 text-sm">
                              {editing ? "Clique em + Operação para adicionar." : "Sem operações definidas."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (blocoId === "custo") {
                return (
                  <section className="bg-gray-900 text-white p-5" data-testid="artigo-custo-calculado">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-300 mb-4">
                      <Calculator size={14} /> Custo Total Calculado
                    </div>
                    <div className={`grid grid-cols-2 ${produzido ? "sm:grid-cols-4" : "sm:grid-cols-2"} gap-4 mb-4 text-sm`}>
                      <div>
                        <div className="text-gray-400 text-xs">Valor de compra</div>
                        <div className="tabular-nums font-medium" data-testid="calc-artigo">{eur(custoCompra)}</div>
                      </div>
                      {produzido && (
                        <>
                          <div>
                            <div className="text-gray-400 text-xs">Materiais</div>
                            <div className="tabular-nums font-medium" data-testid="calc-materiais">{eur(custoMateriais)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 text-xs">Máquinas</div>
                            <div className="tabular-nums font-medium" data-testid="calc-maquinas">{eur(custoMaquinas)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 text-xs">Mão de Obra</div>
                            <div className="tabular-nums font-medium" data-testid="calc-maoobra">{eur(custoMaoObra)}</div>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-end justify-between border-t border-gray-700 pt-4">
                      <span className="text-sm text-gray-300">{produzido ? "Custo de Produção por unidade" : "Custo por unidade"}</span>
                      <span className="tabular-nums font-bold text-2xl font-display" data-testid="calc-total">{eur(custoTotal)}</span>
                    </div>
                    {!isDiversos && show("margem") && tipoAtual !== "consumivel" && (
                      <div className="flex items-center justify-between border-t border-gray-700 pt-4 mt-4">
                        <label className="text-sm text-gray-300 flex items-center gap-2">
                          <Tag size={14} /> Margem de Lucro (%)
                        </label>
                        {editing ? (
                          <input
                            ref={(el) => { fieldRefs.current.margem = el; }}
                            data-testid="artigo-margem-input"
                            type="number"
                            value={draft?.margem ?? 0}
                            onChange={(e) => setDraft((p) => ({ ...p, margem: e.target.value }))}
                            className="w-24 text-right border border-gray-600 bg-gray-800 text-white rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-white/30"
                          />
                        ) : (
                          <InlineField
                            value={margemPct}
                            display={`${margemPct}%`}
                            type="number"
                            canEdit={canEdit}
                            mono
                            onSave={(v) => saveFieldPatch({ margem: Number(v) || 0 })}
                            testid="artigo-margem"
                            className="text-white hover:bg-gray-800"
                          />
                        )}
                      </div>
                    )}
                    {(!isDiversos && show("margem") && tipoAtual !== "consumivel") && (
                      <div className="flex items-end justify-between pt-3">
                        <span className="text-sm font-semibold text-emerald-300">Preço de Venda</span>
                        <span className="tabular-nums font-bold text-3xl font-display text-emerald-300" data-testid="calc-preco-venda">{eur(precoVenda)}</span>
                      </div>
                    )}
                    {(isDiversos || tipoAtual === "consumivel") && (
                      <div className="flex items-end justify-between pt-3">
                        <span className="text-sm font-semibold text-emerald-300">{isDiversos ? "Preço (sem margem)" : "Custo"}</span>
                        <span className="tabular-nums font-bold text-3xl font-display text-emerald-300" data-testid="calc-preco-venda">{eur(precoVenda)}</span>
                      </div>
                    )}
                  </section>
                );
              }

              return null;
            }}
          />

          {parcial && !editing && (
            <div className="text-sm text-gray-400 mb-4 mt-4">A carregar relações do artigo…</div>
          )}
        </>
      )}

      {tab === "encomendas" && (
        <SeccaoPesquisavel title="Encomendas" icon={ClipboardList} rows={encomendas} searchKeys={["numero", "cliente", "estado"]} placeholder="Pesquisar pelo início do nº ou cliente..." testid="artigo-encomendas">
          {(rows) => (
            <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <Th>Nº</Th><Th>Cliente</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="center">Pagamento</Th><Th align="right">Qtd</Th><Th align="right">Valor</Th><th className="w-8"></th>
                </tr></thead>
                <tbody data-testid="artigo-encomendas-table">
                  {rows.map((e) => (
                    <tr key={e.id} data-testid={`artigo-encomenda-row-${e.id}`} onClick={() => nav(`/encomendas/${e.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{e.numero}</td>
                      <td className="px-4 py-3 text-gray-700">{e.cliente}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(e.data)}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={e.estado} /></td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={e.status_pagamento} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{e.quantidade}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(e.valor_total)}</td>
                      <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">{parcial ? "A carregar…" : "Sem encomendas."}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </SeccaoPesquisavel>
      )}

      {tab === "orcamentos" && (
        <SeccaoPesquisavel title="Orçamentos" icon={FileText} rows={orcamentos} searchKeys={["numero", "cliente", "status"]} placeholder="Pesquisar pelo início do nº ou estado..." testid="artigo-orcamentos">
          {(rows) => (
            <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <Th>Nº</Th><Th>Cliente</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="right">Qtd</Th><Th align="right">Total</Th><th className="w-8"></th>
                </tr></thead>
                <tbody data-testid="artigo-orcamentos-table">
                  {rows.map((o) => (
                    <tr key={o.id} data-testid={`artigo-orcamento-row-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero || "Rascunho"}</td>
                      <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{o.quantidade}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(o.total)}</td>
                      <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem orçamentos.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </SeccaoPesquisavel>
      )}

      {tab === "ordens_fabrico" && showOfTab && (
        <SeccaoPesquisavel title="Ordens de Fabrico" icon={Factory} rows={ordens_fabrico} searchKeys={["numero", "cliente", "status"]} placeholder="Pesquisar pelo início do nº ou estado..." testid="artigo-ofs" className="mb-2">
          {(rows) => (
            <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <Th>Nº</Th><Th>Cliente</Th><Th>Data</Th><Th align="center">Estado</Th><Th align="right">Qtd</Th><Th align="right">Progresso</Th><th className="w-8"></th>
                </tr></thead>
                <tbody data-testid="artigo-ofs-table">
                  {rows.map((o) => (
                    <tr key={o.id} data-testid={`artigo-of-row-${o.id}`} onClick={() => nav(`/ordens-fabrico/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                      <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{o.quantidade}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                      <td className="px-4 py-3 text-gray-400"><ChevronRight size={16} /></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sem ordens de fabrico.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </SeccaoPesquisavel>
      )}

      {tab === "ficheiros" && (
        <FicheirosTab tipo="artigo" id={id} canEdit={canEdit && !editing} addLabel="Adicionar ficheiro ou foto" />
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="artigo" id={id} hideTitle />
      )}
    </div>
  );
}
