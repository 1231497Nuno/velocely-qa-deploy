import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, eur } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import ArtigoCombobox from "../components/ArtigoCombobox";
import { ArrowLeft, Plus, Trash2, Save, FileText, Factory } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTS = [
  { v: "rascunho", l: "Rascunho" },
  { v: "enviado", l: "Enviado" },
  { v: "aceite", l: "Aceite" },
  { v: "rejeitado", l: "Rejeitado" },
];

export default function OrcamentoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [orc, setOrc] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);

  const load = useCallback(async () => {
    setOrc(await api.get(`/orcamentos/${id}`));
    setArtigos(await api.get("/artigos"));
    setTipos(await api.get("/tipos-personalizacao"));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!orc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setOrc({ ...orc, ...patch });

  const addLinha = () =>
    upd({
      linhas: [
        ...orc.linhas,
        { artigo_id: "", artigo_nome: "", quantidade: 1, tipo_personalizacao_id: "", tipo_personalizacao_nome: "", custo_producao_unit: 0 },
      ],
    });

  const updLinha = (i, patch) => {
    const l = [...orc.linhas];
    l[i] = { ...l[i], ...patch };
    upd({ linhas: l });
  };
  const delLinha = (i) => upd({ linhas: orc.linhas.filter((_, idx) => idx !== i) });

  const subtotal = orc.linhas.reduce((s, l) => s + (l.custo_producao_unit || 0) * (l.quantidade || 0), 0);
  const total = subtotal * (1 + (Number(orc.margem) || 0) / 100);

  const save = async () => {
    const body = {
      cliente: orc.cliente,
      data: orc.data,
      validade: orc.validade,
      status: orc.status,
      margem: Number(orc.margem) || 0,
      notas: orc.notas || "",
      linhas: orc.linhas.filter((l) => l.artigo_id).map((l) => ({
        ...l,
        quantidade: Number(l.quantidade) || 0,
      })),
    };
    const updated = await api.put(`/orcamentos/${id}`, body);
    setOrc(updated);
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

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{orc.numero}</h1>
            <StatusBadge status={orc.status} testid="orcamento-status-badge" />
          </div>
          <p className="text-sm text-gray-500 mt-1">Orçamento · {orc.cliente}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {orc.of_id && (
            <Link to={`/ordens-fabrico/${orc.of_id}`} data-testid="goto-of-link" className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Factory size={16} /> {orc.of_numero}
            </Link>
          )}
          {orc.status === "aceite" && !orc.of_id && (
            <button data-testid="convert-quote-btn" onClick={converter} className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
              <Factory size={16} /> Converter → OF
            </button>
          )}
          <button data-testid="save-orcamento-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Save size={16} /> Guardar
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Cliente</label>
          <input data-testid="orc-cliente-input" value={orc.cliente} onChange={(e) => upd({ cliente: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[26%]">Artigo</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[22%]">Personalização</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Qtd</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Unit.</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subtotal</th>
              <th className="px-4 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody data-testid="orc-linhas">
            {orc.linhas.map((l, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-4 py-2.5">
                  <ArtigoCombobox
                    artigos={artigos}
                    value={l.artigo_id}
                    testid={`line-artigo-${i}`}
                    onChange={(a) => updLinha(i, { artigo_id: a.id, artigo_nome: a.nome, custo_producao_unit: a.custo_producao_total })}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <select data-testid={`line-tipo-${i}`} value={l.tipo_personalizacao_id || ""} onChange={(e) => { const t = tipos.find((x) => x.id === e.target.value); updLinha(i, { tipo_personalizacao_id: e.target.value, tipo_personalizacao_nome: t ? t.nome : "" }); }} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                    <option value="">—</option>
                    {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2.5">
                  <input data-testid={`line-qtd-${i}`} type="number" min="0" value={l.quantidade} onChange={(e) => updLinha(i, { quantidade: e.target.value })} className="w-20 text-right border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{eur(l.custo_producao_unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{eur((l.custo_producao_unit || 0) * (l.quantidade || 0))}</td>
                <td className="px-4 py-2.5">
                  <button data-testid={`delete-line-${i}`} onClick={() => delLinha(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {orc.linhas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">Sem linhas. Adicione um artigo.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totais */}
      <div className="flex justify-end">
        <div className="bg-white border border-gray-200 rounded-sm p-5 w-full max-w-sm space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Custo de produção total</span>
            <span className="tabular-nums font-medium" data-testid="orc-subtotal">{eur(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <label className="text-gray-500">Margem global (%)</label>
            <input data-testid="orc-margem-input" type="number" value={orc.margem} onChange={(e) => upd({ margem: e.target.value })} className="w-24 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
          </div>
          <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-3">
            <span className="text-gray-500">Lucro estimado</span>
            <span className="tabular-nums text-emerald-600">{eur(total - subtotal)}</span>
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
