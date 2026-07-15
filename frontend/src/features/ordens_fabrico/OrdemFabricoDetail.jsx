import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API, fmtDate } from "@/lib/api";
import ClienteSelector from "@/components/ClienteSelector";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import ArtigoCombobox from "@/components/ArtigoCombobox";
import PdfExportButton from "@/components/PdfExportButton";
import { OFRoteiroPanel } from "@/features/ordens_fabrico/OFRoteiroPanel";
import { OFItemOperacoes } from "@/features/ordens_fabrico/OFItemOperacoes";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import ImagemUpload from "@/components/ImagemUpload";
import { ArrowLeft, Plus, Trash2, Save, Clock, Cog, FileText, Flag, Star } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

export default function OrdemFabricoDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [of, setOf] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setOf(await api.get(`/ordens-fabrico/${id}`));
    setArtigos(await api.get("/artigos"));
    setTipos(await api.get("/tipos-personalizacao"));
    setMaquinas(await api.get("/maquinas"));
    setMaoObra(await api.get("/mao-obra"));
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

  const addItem = () =>
    upd({ itens: [...of.itens, { artigo_id: "", artigo_nome: "", quantidade: 1, personalizacoes: [], operacoes: [] }] });

  const updItem = (i, patch) => {
    const it = [...of.itens];
    it[i] = { ...it[i], ...patch };
    upd({ itens: it });
  };
  const delItem = (i) => upd({ itens: of.itens.filter((_, idx) => idx !== i) });

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

  const save = async () => {
    const body = {
      cliente: of.cliente,
      cliente_id: of.cliente_id || null,
      encomenda_id: of.encomenda_id || null,
      descricao: of.descricao || "",
      numero_encomenda: of.numero_encomenda || "",
      data: of.data,
      status: of.status,
      notas: of.notas || "",
      prioritaria: !!of.prioritaria,
      itens: of.itens.filter((it) => it.artigo_id).map((it) => ({
        ...it,
        quantidade: Number(it.quantidade) || 1,
      })),
    };
    const updated = await api.put(`/ordens-fabrico/${id}`, body);
    setOf(updated);
    toast.success("OF guardada · roteiro carregado");
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
      <button onClick={() => nav("/ordens-fabrico")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={16} /> Voltar às ordens de fabrico
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{of.numero}</h1>
            <StatusBadge status={of.status} testid="of-status-badge" />
            {of.prioritaria && <span data-testid="of-prioritaria-badge" className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5"><Star size={12} className="fill-amber-400 text-amber-500" /> Prioritária</span>}
          </div>
          <p className="text-sm text-gray-500 mt-1">Ordem de Fabrico · {of.cliente}{of.encomenda_numero ? (
            <> · <Link to={`/encomendas/${of.encomenda_id}`} data-testid="of-encomenda-link" className="font-medium text-gray-900 underline underline-offset-4 mono">{of.encomenda_numero}</Link></>
          ) : ""}{of.prazo_entrega ? <> · <span className="font-medium text-gray-700">Entrega {fmtDate(of.prazo_entrega)}</span></> : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button data-testid="of-toggle-prioridade-btn" onClick={togglePrioridade} title="Marcar prioridade" className={`rounded-sm px-3 py-2 text-sm font-medium flex items-center gap-2 border transition-colors ${of.prioritaria ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
            <Star size={16} className={of.prioritaria ? "fill-amber-400 text-amber-500" : ""} /> {of.prioritaria ? "Prioritária" : "Prioridade"}
          </button>
          <PdfExportButton modulo="of" recordId={id} />
          {of.status !== "concluido" && (
            <button data-testid="finalizar-of-btn" onClick={finalizar} className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Flag size={16} /> Declarar Finalizada
            </button>
          )}
          {can("ordens_fabrico", "edit") && (
            <button data-testid="save-of-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Save size={16} /> Guardar
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 bg-gray-900 text-white rounded-sm px-5 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="of-total-timer">
        <div className="flex items-center gap-3">
          <span className={`relative flex h-3 w-3 ${algumEmCurso ? "" : "opacity-60"}`}>
            {algumEmCurso && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${algumEmCurso ? "bg-emerald-400" : "bg-gray-500"}`} />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-gray-400">Tempo de mão de obra (real)</div>
            <div className="text-xs text-gray-500 mt-0.5">{algumEmCurso ? "Cronómetro a contar…" : "Cronómetro parado"} · Estimado {totalMaoObraEst} min</div>
          </div>
        </div>
        <div data-testid="of-total-timer-value" className={`font-display font-bold tabular-nums text-4xl sm:text-5xl tracking-tight ${algumEmCurso ? "text-emerald-400" : "text-white"}`}>
          {fmtClock(totalRealSeg)}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>Progresso de produção</span>
          <span className="tabular-nums" data-testid="of-progress-label">{Math.round(of.progresso || 0)}%</span>
        </div>
        <Progress value={of.progresso || 0} className="h-2" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: details */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Cliente</label>
              <ClienteSelector value={of.cliente_id} onChange={(id, nome) => upd({ cliente_id: id, cliente: nome })} testid="of-cliente-select" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
              <input data-testid="of-descricao-input" value={of.descricao || ""} onChange={(e) => upd({ descricao: e.target.value })} placeholder="Descrição da OF" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Nº da Encomenda</label>
              <input data-testid="of-encomenda-input" value={of.numero_encomenda || ""} onChange={(e) => upd({ numero_encomenda: e.target.value })} placeholder="Nº de encomenda no software" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Data</label>
              <input data-testid="of-data-input" type="date" value={of.data || ""} onChange={(e) => upd({ data: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            {of.orcamento_id && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Origem</label>
                <Link to={`/orcamentos/${of.orcamento_id}`} className="text-sm font-medium text-gray-900 underline underline-offset-4 mono">{of.orcamento_numero}</Link>
              </div>
            )}
            <div className="border-t border-gray-200 pt-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-gray-600">
                <span className="flex items-center gap-2"><Cog size={14} className="text-gray-400" /> Tempo de máquina (totalizado)</span>
                <span className="tabular-nums font-medium text-gray-900" data-testid="of-tempo-maquina-total">{totalMaquina} min</span>
              </div>
              <div className="flex items-center justify-between text-gray-600">
                <span className="flex items-center gap-2"><Clock size={14} className="text-gray-400" /> Mão de obra estimada</span>
                <span className="tabular-nums font-medium text-gray-900">{totalMaoObraEst} min</span>
              </div>
              <div className="flex items-center justify-between text-gray-400 text-xs pt-1">
                <span>Estimativa total (máq.+m.obra)</span>
                <span className="tabular-nums">{totalTempo} min</span>
              </div>
            </div>
          </div>

          {/* Items editor */}
          <div className="bg-white border border-gray-200 rounded-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700"><FileText size={16} /> Artigos</div>
              <button data-testid="add-of-item" onClick={addItem} className="text-sm text-gray-900 font-medium flex items-center gap-1 hover:underline"><Plus size={14} /> Artigo</button>
            </div>
            <div className="space-y-3">
              {of.itens.map((it, i) => (
                <div key={it.id || i} className="border border-gray-200 rounded-sm p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <ImagemUpload value={it.imagem} onChange={(p) => updItem(i, { imagem: p })} size={44} editable={!!it.artigo_id} testid={`of-item-imagem-${i}`} />
                    <div className="flex-1 min-w-0">
                      <ArtigoCombobox artigos={artigos} value={it.artigo_id} testid={`of-item-artigo-${i}`} onChange={(a) => updItem(i, { artigo_id: a.id, artigo_nome: a.nome, imagem: it.imagem || a.imagem || "", operacoes: [] })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Qtd</span>
                    <input data-testid={`of-item-qtd-${i}`} type="number" min="1" value={it.quantidade} onChange={(e) => updItem(i, { quantidade: e.target.value })} className="w-20 border border-gray-300 rounded-sm px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    <div className="flex-1" />
                    <button onClick={() => delItem(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600 flex justify-center"><Trash2 size={14} /></button>
                  </div>
                  <div>
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {(it.personalizacoes || []).map((p, pi) => (
                        <span key={p.id || pi} data-testid={`of-item-pers-${i}-${pi}`} className="inline-flex items-center gap-1.5 text-xs text-gray-700 bg-gray-100 rounded-full pl-2.5 pr-1 py-0.5">
                          {p.nome}
                          <button onClick={() => delItemPers(i, pi)} data-testid={`of-item-pers-del-${i}-${pi}`} className="w-4 h-4 rounded-full hover:bg-gray-300 text-gray-500 flex items-center justify-center leading-none">×</button>
                        </span>
                      ))}
                    </div>
                    <select data-testid={`of-item-add-pers-${i}`} value="" onChange={(e) => { addItemPers(i, e.target.value); e.target.value = ""; }} className="w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="">+ Adicionar personalização</option>
                      {tipos.filter((t) => !(it.personalizacoes || []).some((p) => p.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                    </select>
                  </div>
                  {it.artigo_id && (
                    <OFItemOperacoes item={it} i={i} maquinas={maquinas} maoObra={maoObra} addOp={addOp} updOp={updOp} delOp={delOp} />
                  )}
                </div>
              ))}
              {of.itens.length === 0 && <p className="text-xs text-gray-400">Sem artigos. Adicione e guarde para carregar o roteiro.</p>}
            </div>
          </div>
        </div>

        {/* Right: roteiro */}
        <OFRoteiroPanel itens={of.itens} toggleOp={toggleOp} iniciarOp={iniciarOp} pararOp={pararOp} updOpNota={updOpNota} elapsedSeg={elapsedSeg} fmtDur={fmtDur} />
      </div>

      <HistoricoTimeline tipo="ordem_fabrico" id={id} />
    </div>
  );
}
