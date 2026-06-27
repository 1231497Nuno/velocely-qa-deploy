import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import ArtigoCombobox from "../components/ArtigoCombobox";
import { ArrowLeft, Plus, Trash2, Save, Clock, Cog, FileText, CheckCircle2, FileDown, Play, Square, Flag } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "../components/ui/progress";

export default function OrdemFabricoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [of, setOf] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setOf(await api.get(`/ordens-fabrico/${id}`));
    setArtigos(await api.get("/artigos"));
    setTipos(await api.get("/tipos-personalizacao"));
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
    upd({ itens: [...of.itens, { artigo_id: "", artigo_nome: "", quantidade: 1, tipo_personalizacao_id: "", tipo_personalizacao_nome: "", operacoes: [] }] });

  const updItem = (i, patch) => {
    const it = [...of.itens];
    it[i] = { ...it[i], ...patch };
    upd({ itens: it });
  };
  const delItem = (i) => upd({ itens: of.itens.filter((_, idx) => idx !== i) });

  const save = async () => {
    const body = {
      cliente: of.cliente,
      descricao: of.descricao || "",
      numero_encomenda: of.numero_encomenda || "",
      data: of.data,
      status: of.status,
      notas: of.notas || "",
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
    setOf(await api.post(`/ordens-fabrico/${id}/operacao/iniciar`, { item_id: itemId, operacao_id: opId }));
  };
  const pararOp = async (itemId, opId) => {
    setOf(await api.post(`/ordens-fabrico/${id}/operacao/parar`, { item_id: itemId, operacao_id: opId }));
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
  const totalRealSeg = of.itens.reduce((s, it) => s + (it.operacoes || []).reduce((a, o) => a + elapsedSeg(o), 0), 0);
  const algumEmCurso = of.itens.some((it) => (it.operacoes || []).some((o) => o.timer_inicio));

  return (
    <div>
      <button onClick={() => nav("/ordens-fabrico")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={16} /> Voltar às ordens de fabrico
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{of.numero}</h1>
            <StatusBadge status={of.status} testid="of-status-badge" />
          </div>
          <p className="text-sm text-gray-500 mt-1">Ordem de Fabrico · {of.cliente}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`${API}/ordens-fabrico/${id}/pdf`} target="_blank" rel="noopener noreferrer" data-testid="of-pdf-btn" className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <FileDown size={16} /> PDF
          </a>
          {of.status !== "concluido" && (
            <button data-testid="finalizar-of-btn" onClick={finalizar} className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Flag size={16} /> Declarar Finalizada
            </button>
          )}
          <button data-testid="save-of-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Save size={16} /> Guardar
          </button>
        </div>
      </div>

      <div className="mb-4 bg-gray-900 text-white rounded-sm px-6 py-5 flex items-center justify-between gap-4" data-testid="of-total-timer">
        <div className="flex items-center gap-3">
          <span className={`relative flex h-3 w-3 ${algumEmCurso ? "" : "opacity-60"}`}>
            {algumEmCurso && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${algumEmCurso ? "bg-emerald-400" : "bg-gray-500"}`} />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-gray-400">Tempo total gasto</div>
            <div className="text-xs text-gray-500 mt-0.5">{algumEmCurso ? "Cronómetro a contar…" : "Cronómetro parado"} · Estimado {totalTempo} min</div>
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
              <input data-testid="of-cliente-input" value={of.cliente} onChange={(e) => upd({ cliente: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
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
            <div className="flex items-center gap-2 text-sm text-gray-600 border-t border-gray-200 pt-3">
              <Clock size={15} className="text-gray-400" />
              Tempo total estimado: <span className="tabular-nums font-medium text-gray-900">{totalTempo} min</span>
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
                <div key={i} className="border border-gray-200 rounded-sm p-3 space-y-2">
                  <ArtigoCombobox artigos={artigos} value={it.artigo_id} testid={`of-item-artigo-${i}`} onChange={(a) => updItem(i, { artigo_id: a.id, artigo_nome: a.nome, operacoes: [] })} />
                  <div className="grid grid-cols-[1fr_70px_28px] gap-2 items-center">
                    <select data-testid={`of-item-tipo-${i}`} value={it.tipo_personalizacao_id || ""} onChange={(e) => { const t = tipos.find((x) => x.id === e.target.value); updItem(i, { tipo_personalizacao_id: e.target.value, tipo_personalizacao_nome: t ? t.nome : "" }); }} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                      <option value="">Personalização —</option>
                      {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                    </select>
                    <input data-testid={`of-item-qtd-${i}`} type="number" min="1" value={it.quantidade} onChange={(e) => updItem(i, { quantidade: e.target.value })} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    <button onClick={() => delItem(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600 flex justify-center"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {of.itens.length === 0 && <p className="text-xs text-gray-400">Sem artigos. Adicione e guarde para carregar o roteiro.</p>}
            </div>
          </div>
        </div>

        {/* Right: roteiro */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-sm p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-4"><Cog size={16} /> Roteiro de Operações</div>
          {of.itens.filter((it) => (it.operacoes || []).length > 0).length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">Adicione artigos e guarde a OF para carregar automaticamente o roteiro de operações.</p>
          ) : (
            <div className="space-y-6" data-testid="of-roteiro">
              {of.itens.map((it, idx) => (
                (it.operacoes || []).length > 0 && (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                      <div className="font-medium text-gray-900">{it.artigo_nome} <span className="text-gray-400 text-sm">× {it.quantidade}</span></div>
                      {(it.personalizacoes && it.personalizacoes.length > 0) ? (
                        <div className="flex flex-wrap gap-1 justify-end" data-testid={`of-item-pers-${idx}`}>
                          {it.personalizacoes.map((p, pi) => (
                            <span key={pi} className="text-xs text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">{p.nome}</span>
                          ))}
                        </div>
                      ) : (it.tipo_personalizacao_nome && <span className="text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">{it.tipo_personalizacao_nome}</span>)}
                    </div>
                    <div className="space-y-2">
                      {it.operacoes.map((op) => {
                        const running = !!op.timer_inicio;
                        return (
                          <div key={op.id} data-testid={`op-row-${op.id}`} className={`flex items-center gap-3 px-3 py-2.5 rounded-sm border transition-colors ${op.concluida ? "bg-emerald-50 border-emerald-200" : running ? "bg-blue-50 border-blue-300" : "bg-white border-gray-200"}`}>
                            <input type="checkbox" data-testid={`op-check-${op.id}`} checked={op.concluida} onChange={(e) => toggleOp(it.id, op.id, e.target.checked)} className="w-4 h-4 accent-emerald-600 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${op.concluida ? "text-emerald-700" : "text-gray-900"}`}>{op.nome || "Operação"}</div>
                              <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                                <span className="flex items-center gap-1"><Cog size={12} /> {op.maquina_nome || "—"} · <span className="tabular-nums font-medium text-gray-700">{op.tempo_maquina || 0} min</span></span>
                                <span className="flex items-center gap-1"><Clock size={12} /> {op.mao_obra_nome || "—"} · <span className="tabular-nums font-medium text-gray-700">{op.tempo_mao_obra || 0} min</span></span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] uppercase tracking-wide text-gray-400">Tempo real</div>
                              <div data-testid={`op-real-${op.id}`} className={`text-sm font-semibold tabular-nums ${running ? "text-blue-600" : "text-gray-700"}`}>{fmtDur(elapsedSeg(op))}</div>
                            </div>
                            {!op.concluida && (
                              running ? (
                                <button data-testid={`op-stop-${op.id}`} onClick={() => pararOp(it.id, op.id)} className="shrink-0 bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"><Square size={13} /> Parar</button>
                              ) : (
                                <button data-testid={`op-start-${op.id}`} onClick={() => iniciarOp(it.id, op.id)} className="shrink-0 bg-gray-900 text-white hover:bg-gray-700 rounded-sm px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"><Play size={13} /> Iniciar</button>
                              )
                            )}
                            {op.concluida && <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
