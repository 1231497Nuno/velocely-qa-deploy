import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import ArtigoCombobox from "@/components/ArtigoCombobox";
import PdfExportButton from "@/components/PdfExportButton";
import { OFRoteiroPanel } from "@/features/ordens_fabrico/OFRoteiroPanel";
import { OFItemOperacoes } from "@/features/ordens_fabrico/OFItemOperacoes";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import ImagemUpload from "@/components/ImagemUpload";
import ImagensGaleria from "@/components/ImagensGaleria";
import { ArrowLeft, Plus, Trash2, Save, Clock, Cog, FileText, Flag, Star, User, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import Combobox from "@/components/Combobox";

export default function OrdemFabricoDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [of, setOf] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [utilizadores, setUtilizadores] = useState([]);
  const [, setTick] = useState(0);
  const [itemAberto, setItemAberto] = useState(null);

  const load = useCallback(async () => {
    const [ofData, arts, tipos, maqs, mos, users] = await Promise.all([
      api.get(`/ordens-fabrico/${id}`),
      api.get("/artigos?lite=1"),
      api.get("/tipos-personalizacao"),
      api.get("/maquinas"),
      api.get("/mao-obra"),
      api.get("/utilizadores-lista").catch(() => []),
    ]);
    setOf(ofData);
    setArtigos(arts);
    setTipos(tipos);
    setMaquinas(maqs);
    setMaoObra(mos);
    setUtilizadores(users);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!of) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setOf({ ...of, ...patch });

  const addItem = () => {
    upd({ itens: [...of.itens, { artigo_id: "", artigo_nome: "", quantidade: 1, personalizacoes: [], operacoes: [] }] });
    setItemAberto(of.itens.length);
  };

  const updItem = (i, patch) => {
    const it = [...of.itens];
    it[i] = { ...it[i], ...patch };
    upd({ itens: it });
  };
  const delItem = (i) => {
    upd({ itens: of.itens.filter((_, idx) => idx !== i) });
    setItemAberto((cur) => {
      if (cur == null) return null;
      if (cur === i) return null;
      if (cur > i) return cur - 1;
      return cur;
    });
  };

  const addItemPers = (i, tipoId) => {
    if (!tipoId) return;
    const t = tipos.find((x) => x.id === tipoId);
    if (!t) return;
    const cur = of.itens[i].personalizacoes || [];
    if (cur.some((p) => p.id === t.id)) return;
    updItem(i, { personalizacoes: [...cur, { id: t.id, nome: t.nome, valor: Number(t.valor) || 0, tempo: Number(t.tempo) || 0 }] });
  };
  const delItemPers = (i, pi) => updItem(i, { personalizacoes: (of.itens[i].personalizacoes || []).filter((_, idx) => idx !== pi) });

  const addOp = (i) => {
    const it = [...of.itens];
    it[i] = { ...it[i], operacoes: [...(it[i].operacoes || []), { id: crypto.randomUUID(), nome: "", maquina_id: "", maquina_nome: "", mao_obra_id: "", mao_obra_nome: "", tempo_maquina_base: 0, tempo_mao_obra_base: 0, tempo_maquina: 0, tempo_mao_obra: 0, manual: true }] };
    upd({ itens: it });
  };
  const updOp = (i, opId, patch) => {
    const it = [...of.itens];
    it[i] = { ...it[i], operacoes: (it[i].operacoes || []).map((o) => (o.id === opId ? { ...o, ...patch } : o)) };
    upd({ itens: it });
  };
  const delOp = (i, opId) => {
    const it = [...of.itens];
    it[i] = { ...it[i], operacoes: (it[i].operacoes || []).filter((o) => o.id !== opId) };
    upd({ itens: it });
  };

  const bodyFrom = (o) => ({
    cliente: o.cliente,
    cliente_id: o.cliente_id || null,
    encomenda_id: o.encomenda_id || null,
    descricao: o.descricao || "",
    numero_encomenda: o.numero_encomenda || "",
    data: o.data,
    status: o.status,
    notas: o.notas || "",
    prioritaria: !!o.prioritaria,
    responsavel_id: o.responsavel_id || null,
    responsavel_nome: o.responsavel_nome || "",
    imagens: o.imagens || [],
    itens: (o.itens || []).filter((it) => it.artigo_id).map((it) => ({
      ...it,
      quantidade: Number(it.quantidade) || 1,
    })),
  });

  const save = async () => {
    const updated = await api.put(`/ordens-fabrico/${id}`, bodyFrom(of));
    setOf(updated);
    toast.success("OF guardada · roteiro carregado");
  };

  const saveImagens = async (imgs) => {
    const next = { ...of, imagens: imgs };
    setOf(next);
    try {
      const updated = await api.put(`/ordens-fabrico/${id}`, bodyFrom(next));
      setOf(updated);
    } catch {
      toast.error("Falha ao guardar imagens");
    }
  };

  const toggleOp = async (itemId, opId, concluida) => {
    const updated = await api.post(`/ordens-fabrico/${id}/toggle-operacao`, {
      item_id: itemId,
      operacao_id: opId,
      concluida,
    });
    setOf(updated);
  };

  const iniciarOp = async (itemId, opId) => {
    try {
      setOf(await api.post(`/ordens-fabrico/${id}/operacao/iniciar`, { item_id: itemId, operacao_id: opId }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível iniciar a operação");
    }
  };
  const pararOp = async (itemId, opId) => {
    setOf(await api.post(`/ordens-fabrico/${id}/operacao/parar`, { item_id: itemId, operacao_id: opId }));
  };
  const updOpNota = async (itemId, opId, nota) => {
    setOf(await api.post(`/ordens-fabrico/${id}/operacao/nota`, { item_id: itemId, operacao_id: opId, nota }));
  };
  const finalizar = async () => {
    setOf(await api.post(`/ordens-fabrico/${id}/finalizar`));
    toast.success("Ordem de fabrico finalizada");
  };

  const elapsedSeg = (op) => {
    let s = op.tempo_real_seg || 0;
    if (op.timer_inicio) s += (Date.now() - new Date(op.timer_inicio).getTime()) / 1000;
    return s;
  };
  const fmtDur = (s) => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    return `${m}m ${String(ss).padStart(2, "0")}s`;
  };

  const fmtClock = (s) => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(ss)}`;
  };

  const totalTempo = of.itens.reduce((s, it) => s + (it.operacoes || []).reduce((a, o) => a + (o.tempo_min || 0), 0), 0);
  const totalMaquina = of.itens.reduce((s, it) => s + (it.operacoes || []).reduce((a, o) => a + (o.tempo_maquina || 0), 0), 0);
  const totalMaoObraEst = of.itens.reduce((s, it) => s + (it.operacoes || []).reduce((a, o) => a + (o.tempo_mao_obra || 0), 0), 0);
  const totalRealSeg = of.itens.reduce((s, it) => s + (it.operacoes || []).reduce((a, o) => a + elapsedSeg(o), 0), 0);
  const algumEmCurso = of.itens.some((it) => (it.operacoes || []).some((o) => o.timer_inicio));
  const togglePrioridade = async () => {
    setOf(await api.post(`/ordens-fabrico/${id}/prioridade`, { prioritaria: !of.prioritaria }));
  };

  return (
    <div>
      {/* Barra sticky: ações + dados gerais (não saem com o scroll) */}
      <div className="sticky top-14 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2.5 mb-4 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2 sm:gap-3">
              <button onClick={() => nav("/ordens-fabrico")} className="shrink-0 p-1.5 rounded-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100" title="Voltar" aria-label="Voltar">
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight font-display mono">{of.numero}</h1>
                  <StatusBadge status={of.status} testid="of-status-badge" />
                  {of.prioritaria && (
                    <span data-testid="of-prioritaria-badge" className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                      <Star size={11} className="fill-amber-400 text-amber-500" /> Prioritária
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap sm:justify-end">
              <button data-testid="of-toggle-prioridade-btn" onClick={togglePrioridade} title="Marcar prioridade" className={`rounded-sm px-2.5 py-1.5 text-sm font-medium flex items-center gap-1.5 border transition-colors ${of.prioritaria ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                <Star size={15} className={of.prioritaria ? "fill-amber-400 text-amber-500" : ""} /> {of.prioritaria ? "Prioritária" : "Prioridade"}
              </button>
              <PdfExportButton modulo="of" recordId={id} />
              {of.status !== "concluido" && (
                <button data-testid="finalizar-of-btn" onClick={finalizar} className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                  <Flag size={15} /> Finalizar
                </button>
              )}
              {can("ordens_fabrico", "edit") && (
                <button data-testid="save-of-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                  <Save size={15} /> Guardar
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4" data-testid="of-total-timer">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={`relative flex h-2 w-2 shrink-0 ${algumEmCurso ? "" : "opacity-50"}`}>
                {algumEmCurso && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-70 animate-ping" />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${algumEmCurso ? "bg-emerald-500" : "bg-gray-400"}`} />
              </span>
              <span className="text-xs text-gray-500 truncate">
                {algumEmCurso ? "Cronómetro a contar" : "Cronómetro parado"}
                <span className="text-gray-400"> · Est. {totalMaoObraEst} min · Máq. {totalMaquina} min</span>
              </span>
              <span data-testid="of-total-timer-value" className={`ml-auto sm:ml-2 font-display font-bold tabular-nums text-base sm:text-lg ${algumEmCurso ? "text-emerald-600" : "text-gray-900"}`}>
                {fmtClock(totalRealSeg)}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:w-44 shrink-0">
              <Progress value={of.progresso || 0} className="h-1.5 flex-1" />
              <span className="text-xs tabular-nums text-gray-500 w-8 text-right" data-testid="of-progress-label">{Math.round(of.progresso || 0)}%</span>
            </div>
          </div>

          {/* Dados gerais — zona fixa */}
          <div className="rounded-sm border border-gray-200 bg-gray-50/80 px-3 py-2" data-testid="of-dados-gerais">
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4 text-sm">
              <div className="min-w-0 flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-1.5">
                <div className="min-w-0 col-span-2 sm:col-span-1 lg:col-span-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Cliente</div>
                  <div className="text-gray-900 font-medium truncate text-xs sm:text-sm" data-testid="of-cliente-select" title={of.cliente || ""}>{of.cliente || "—"}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Enc.</div>
                  <div className="mono text-xs text-gray-900 truncate" data-testid="of-encomenda-input">
                    {of.encomenda_id && (of.encomenda_numero || of.numero_encomenda) ? (
                      <Link to={`/encomendas/${of.encomenda_id}`} className="font-medium underline underline-offset-2">{of.encomenda_numero || of.numero_encomenda}</Link>
                    ) : (of.numero_encomenda || "—")}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Data</div>
                  <div className="tabular-nums text-xs text-gray-900" data-testid="of-data-input">{of.data ? fmtDate(of.data) : "—"}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Prazo</div>
                  <div className="tabular-nums text-xs text-gray-900">{of.prazo_entrega ? fmtDate(of.prazo_entrega) : "—"}</div>
                </div>
                {(of.descricao || "").trim() && (
                  <div className="min-w-0 col-span-2 sm:col-span-3 lg:col-span-5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Desc.</div>
                    <div className="text-gray-700 truncate text-xs" data-testid="of-descricao-input" title={of.descricao}>{of.descricao}</div>
                  </div>
                )}
                {of.orcamento_id && (
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Origem</div>
                    <Link to={`/orcamentos/${of.orcamento_id}`} className="font-medium text-gray-900 underline underline-offset-2 mono text-xs">{of.orcamento_numero || "Orçamento"}</Link>
                  </div>
                )}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2 lg:w-72 shrink-0" data-testid="of-responsavel-row">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1 flex items-center gap-1"><User size={11} /> Responsável</div>
                  {can("ordens_fabrico", "edit") ? (
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 min-w-0">
                        <Combobox
                          options={utilizadores.map((u) => ({ value: u.id, label: u.nome, hint: u.login }))}
                          value={of.responsavel_id || ""}
                          onChange={(v, o) => upd({ responsavel_id: v, responsavel_nome: o?.label || "" })}
                          placeholder="Atribuir..."
                          testid="of-responsavel"
                          optionTestidPrefix="of-responsavel-opt"
                        />
                      </div>
                      {of.responsavel_id && (
                        <button data-testid="of-responsavel-clear" onClick={() => upd({ responsavel_id: null, responsavel_nome: "" })} className="text-xs text-gray-400 hover:text-red-600 shrink-0">×</button>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-900 text-xs">{of.responsavel_nome || "—"}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500 shrink-0 pb-0.5">
                  <span className="inline-flex items-center gap-1"><Cog size={11} /> <span className="tabular-nums font-medium text-gray-800" data-testid="of-tempo-maquina-total">{totalMaquina}m</span></span>
                  <span className="inline-flex items-center gap-1"><Clock size={11} /> <span className="tabular-nums font-medium text-gray-800">{totalMaoObraEst}m</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Esquerda: lista compacta de artigos (expandir para editar) */}
          <div className="lg:col-span-1">
            <section className="bg-white border border-gray-200 rounded-sm overflow-hidden flex flex-col h-[min(55vh,26rem)] lg:h-[min(70vh,32rem)]">
              <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-gray-200 bg-white">
                <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <FileText size={16} /> Artigos
                  <span className="text-xs font-normal tabular-nums text-gray-400">{of.itens.length}</span>
                </h2>
                <button data-testid="add-of-item" onClick={addItem} className="text-sm text-gray-900 font-medium flex items-center gap-1 hover:underline">
                  <Plus size={14} /> Artigo
                </button>
              </div>
              <div
                className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain divide-y divide-gray-100"
                data-testid="of-artigos-lista"
              >                {of.itens.map((it, i) => {
                  const aberto = itemAberto === i;
                  const nOps = (it.operacoes || []).length;
                  const nDone = (it.operacoes || []).filter((o) => o.concluida).length;
                  const pers = it.personalizacoes || [];
                  return (
                    <div key={it.id || i} className={`${aberto ? "bg-gray-50/80" : "bg-white hover:bg-gray-50/60"}`} data-testid={`of-item-row-${i}`}>
                      <button
                        type="button"
                        data-testid={`of-item-toggle-${i}`}
                        onClick={() => setItemAberto(aberto ? null : i)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <ImagemUpload value={it.imagem} size={36} editable={false} testid={`of-item-imagem-${i}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {it.artigo_nome || <span className="text-gray-400 font-normal">Escolher artigo…</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 min-w-0">
                            {pers.length > 0 && (
                              <span className="truncate">{pers.map((p) => p.nome).join(", ")}</span>
                            )}
                            {nOps > 0 && (
                              <span className="tabular-nums shrink-0 text-gray-400">{nDone}/{nOps} ops</span>
                            )}
                          </div>
                        </div>
                        <div
                          className="shrink-0 w-24 grid grid-cols-[1.7fr_1fr] gap-x-1 gap-y-0.5 px-1.5 py-1 rounded-sm bg-gray-100 border border-gray-200 text-center"
                          title={`Quantidade: ${it.quantidade || 1} ${it.unidade || "un"}`}
                        >
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 leading-none">Qtd</span>
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 leading-none">Un</span>
                          <span className="text-sm font-bold tabular-nums text-gray-900 leading-none">{it.quantidade || 1}</span>
                          <span className="text-xs font-bold uppercase text-gray-900 leading-none">{it.unidade || "un"}</span>
                        </div>
                        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${aberto ? "rotate-180" : ""}`} />
                      </button>

                      {aberto && (
                        <div className="px-3 pb-3 space-y-2 border-t border-gray-100/80" onClick={(e) => e.stopPropagation()}>
                          <div className="pt-2">
                            <ArtigoCombobox
                              artigos={artigos}
                              value={it.artigo_id}
                              testid={`of-item-artigo-${i}`}
                              onChange={(a) => updItem(i, { artigo_id: a.id, artigo_nome: a.nome, imagem: it.imagem || a.imagem || "", operacoes: [] })}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 shrink-0" htmlFor={`of-item-qtd-${i}`}>Quantidade</label>
                            <input
                              id={`of-item-qtd-${i}`}
                              data-testid={`of-item-qtd-${i}`}
                              type="number"
                              min="1"
                              value={it.quantidade}
                              onChange={(e) => updItem(i, { quantidade: e.target.value })}
                              className="w-24 border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm font-semibold text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                            />
                            <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-sm px-2 py-1.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Unidade</span>
                              <span className="font-semibold text-gray-900 uppercase">{it.unidade || "un"}</span>
                            </span>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={() => delItem(i)}
                              className="p-1.5 rounded-sm hover:bg-red-100 text-red-600 flex justify-center"
                              title="Remover artigo"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div>
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                              {pers.map((p, pi) => (
                                <span key={p.id || pi} data-testid={`of-item-pers-${i}-${pi}`} className="inline-flex items-center gap-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-full pl-2.5 pr-1 py-0.5">
                                  {p.nome}
                                  <button type="button" onClick={() => delItemPers(i, pi)} data-testid={`of-item-pers-del-${i}-${pi}`} className="w-4 h-4 rounded-full hover:bg-gray-200 text-gray-500 flex items-center justify-center leading-none">×</button>
                                </span>
                              ))}
                            </div>
                            <select
                              data-testid={`of-item-add-pers-${i}`}
                              value=""
                              onChange={(e) => { addItemPers(i, e.target.value); e.target.value = ""; }}
                              className="w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                            >
                              <option value="">+ Adicionar personalização</option>
                              {tipos.filter((t) => !pers.some((p) => p.id === t.id)).map((t) => (
                                <option key={t.id} value={t.id}>{t.nome}</option>
                              ))}
                            </select>
                          </div>
                          {it.artigo_id && (
                            <OFItemOperacoes item={it} i={i} maquinas={maquinas} maoObra={maoObra} addOp={addOp} updOp={updOp} delOp={delOp} />
                          )}
                          <p className="text-[11px] text-gray-400">A produção (iniciar/parar) faz-se no roteiro à direita.</p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {of.itens.length === 0 && (
                  <p className="px-3 py-8 text-center text-xs text-gray-400">Sem artigos. Adicione e guarde para carregar o roteiro.</p>
                )}
              </div>
            </section>
          </div>

          {/* Direita: roteiro */}
          <div className="lg:col-span-2 min-h-0">
            <OFRoteiroPanel itens={of.itens} toggleOp={toggleOp} iniciarOp={iniciarOp} pararOp={pararOp} updOpNota={updOpNota} elapsedSeg={elapsedSeg} fmtDur={fmtDur} />
          </div>
        </div>

        <ImagensGaleria value={of.imagens} onChange={saveImagens} title="Imagens da ordem de fabrico" hint="Imagens de referência de toda a OF (herdadas do orçamento/encomenda quando aplicável)." />

        <HistoricoTimeline tipo="ordem_fabrico" id={id} />
      </div>
    </div>
  );
}
