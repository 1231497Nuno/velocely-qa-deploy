import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import ArtigoCombobox from "../components/ArtigoCombobox";
import { ArrowLeft, Plus, Trash2, Save, Clock, Cog, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "../components/ui/progress";

export default function OrdemFabricoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [of, setOf] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);

  const load = useCallback(async () => {
    setOf(await api.get(`/ordens-fabrico/${id}`));
    setArtigos(await api.get("/artigos"));
    setTipos(await api.get("/tipos-personalizacao"));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

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

  const totalTempo = of.itens.reduce((s, it) => s + (it.operacoes || []).reduce((a, o) => a + (o.tempo_min || 0), 0), 0);

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
        <button data-testid="save-of-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors shrink-0">
          <Save size={16} /> Guardar
        </button>
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
                      {it.tipo_personalizacao_nome && <span className="text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">{it.tipo_personalizacao_nome}</span>}
                    </div>
                    <div className="space-y-1">
                      {it.operacoes.map((op) => (
                        <label key={op.id} data-testid={`op-row-${op.id}`} className={`flex items-center gap-3 px-3 py-2.5 rounded-sm border transition-colors cursor-pointer ${op.concluida ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                          <input type="checkbox" data-testid={`op-check-${op.id}`} checked={op.concluida} onChange={(e) => toggleOp(it.id, op.id, e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                          <div className="flex-1">
                            <div className={`text-sm font-medium ${op.concluida ? "text-emerald-700 line-through" : "text-gray-900"}`}>{op.nome || "Operação"}</div>
                            <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                              <Cog size={12} /> {op.maquina_nome || "Sem máquina"}
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 tabular-nums flex items-center gap-1"><Clock size={12} /> {op.tempo_min} min</div>
                          {op.concluida && <CheckCircle2 size={16} className="text-emerald-600" />}
                        </label>
                      ))}
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
