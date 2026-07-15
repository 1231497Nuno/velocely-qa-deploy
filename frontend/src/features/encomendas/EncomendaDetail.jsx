import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, fmtDate, eur, API, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import Combobox from "@/components/Combobox";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import ImagemUpload from "@/components/ImagemUpload";
import ImagensGaleria from "@/components/ImagensGaleria";
import PdfExportButton from "@/components/PdfExportButton";
import {
  ArrowLeft, Plus, Factory, User, Mail, Phone, MapPin, Hash, Save, Trash2, X,
  Wallet, ShieldCheck, ShieldAlert, CheckCircle2, Package, Pencil, Receipt,
} from "lucide-react";
import { toast } from "sonner";

const PAY_BADGE = { pendente: "pendente", parcial: "parcial", pago: "pago" };
const METODO_PT = { transferencia: "Transferência", numerario: "Numerário", mbway: "MB WAY", cheque: "Cheque", cartao: "Cartão", outro: "Outro" };

export default function EncomendaDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [enc, setEnc] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [precoHist, setPrecoHist] = useState({});
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [editValor, setEditValor] = useState(false);
  const [pagValor, setPagValor] = useState("");
  const [pagMetodo, setPagMetodo] = useState("transferencia");
  const [pagNota, setPagNota] = useState("");

  const addPagamento = async (valorOverride, notaOverride) => {
    const v = Number(valorOverride ?? pagValor);
    if (!v || v <= 0) return toast.error("Indica um valor positivo");
    const updated = await api.post(`/encomendas/${id}/pagamentos`, { valor: v, metodo: pagMetodo, nota: notaOverride ?? pagNota });
    setEnc(updated); setPagValor(""); setPagNota("");
    toast.success("Pagamento registado");
  };
  const delPagamento = async (pid) => {
    const updated = await api.delete(`/encomendas/${id}/pagamentos/${pid}`);
    setEnc(updated); toast.success("Pagamento removido");
  };
  const reciboUrl = (pid) => `${API}/encomendas/${id}/pagamentos/${pid}/recibo?auth=${getToken()}`;

  const load = useCallback(async () => {
    const e = await api.get(`/encomendas/${id}`);
    setEnc(e);
    setArtigos(await api.get("/artigos"));
    setTipos(await api.get("/tipos-personalizacao"));
    if (e.cliente_id) {
      const cs = await api.get("/clientes");
      setCliente(cs.find((c) => c.id === e.cliente_id) || null);
      const hist = await api.get(`/clientes/${e.cliente_id}/historico-precos`).catch(() => []);
      setPrecoHist(Object.fromEntries((hist || []).map((h) => [h.artigo_id, h])));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const moradaCompleta = useMemo(
    () => [cliente?.morada, cliente?.codigo_postal, cliente?.cidade, cliente?.pais].filter(Boolean).join(", "),
    [cliente]
  );

  if (!enc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setEnc({ ...enc, ...patch });

  const persUnitOf = (a) => (a.personalizacoes || []).reduce((x, p) => x + (Number(p.valor) || 0), 0);
  const lineGross = (a) => ((Number(a.preco_unit) || 0) + persUnitOf(a)) * (Number(a.quantidade) || 0);
  const lineDisc = (a) => {
    const base = lineGross(a);
    const d = Number(a.desconto) || 0;
    if (d <= 0) return 0;
    return a.desconto_tipo === "eur" ? Math.min(d, base) : (base * d) / 100;
  };
  const lineNet = (a) => lineGross(a) - lineDisc(a);

  const subtotalLiquidoArtigos = (enc.artigos || []).reduce((s, a) => s + lineNet(a), 0);
  const descTotalVal = (() => {
    const d = Number(enc.desconto_total) || 0;
    if (d <= 0) return 0;
    return enc.desconto_total_tipo === "eur" ? Math.min(d, subtotalLiquidoArtigos) : (subtotalLiquidoArtigos * d) / 100;
  })();
  const artigosTotal = subtotalLiquidoArtigos - descTotalVal;
  const valorMostrado = enc.valor_total_manual ? (Number(enc.valor_total) || 0) : (enc.orcamento_id ? enc.valor_total : artigosTotal);

  const bodyFrom = (e) => ({
    cliente: e.cliente,
    cliente_id: e.cliente_id || null,
    descricao: e.descricao || "",
    data: e.data,
    prazo_entrega: e.prazo_entrega || null,
    estado: e.estado,
    notas: e.notas || "",
    imagens: e.imagens || [],
    pagamentos: e.pagamentos || [],
    desconto_total: Number(e.desconto_total) || 0,
    desconto_total_tipo: e.desconto_total_tipo || "pct",
    artigos: (e.artigos || []).map((a) => ({
      ...a,
      quantidade: Number(a.quantidade) || 1,
      preco_unit: Number(a.preco_unit) || 0,
      desconto: Number(a.desconto) || 0,
      desconto_tipo: a.desconto_tipo || "pct",
      personalizacoes: (a.personalizacoes || []).map((p) => ({ id: p.id, nome: p.nome, valor: Number(p.valor) || 0, tempo: Number(p.tempo) || 0 })),
    })),
    valor_total: e.valor_total_manual ? Number(e.valor_total) || 0 : null,
    valor_total_manual: !!e.valor_total_manual,
    valor_pago: Number(e.valor_pago) || 0,
    autorizada_producao: !!e.autorizada_producao,
  });

  const persist = async (patch = {}, msg) => {
    const next = { ...enc, ...patch };
    setEnc(next);
    const updated = await api.put(`/encomendas/${id}`, bodyFrom(next));
    setEnc(updated);
    if (msg) toast.success(msg);
  };
  const save = () => persist({}, "Encomenda guardada");

  const addArtigo = (artigoId) => {
    const a = artigos.find((x) => x.id === artigoId);
    if (!a) return;
    persist({ artigos: [...(enc.artigos || []), { id: crypto.randomUUID(), artigo_id: a.id, artigo_nome: a.nome, imagem: a.imagem || "", quantidade: 1, preco_unit: Number(a.preco_venda) || 0, desconto: 0, desconto_tipo: "pct", personalizacoes: [] }] }, "Artigo adicionado");
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
    const itens = (enc.artigos || []).filter((a) => a.artigo_id).map((a) => ({
      artigo_id: a.artigo_id, artigo_nome: a.artigo_nome, imagem: a.imagem || "", quantidade: Number(a.quantidade) || 1,
      personalizacoes: a.personalizacoes || [], operacoes: [],
    }));
    const of = await api.post(`/encomendas/${id}/ordens-fabrico`, { cliente: enc.cliente, itens, imagens: enc.imagens || [] });
    toast.success("Ordem de fabrico criada");
    nav(`/ordens-fabrico/${of.id}`);
  };

  const artigoOptions = artigos.map((a) => ({ value: a.id, label: a.nome, hint: eur(a.preco_venda) }));
  const podeProduzir = enc.pode_produzir;

  return (
    <div>
      <button onClick={() => nav("/encomendas")} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1.5 mb-4"><ArrowLeft size={15} /> Voltar às encomendas</button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{enc.numero}</h1>
            <StatusBadge status={enc.estado} testid="encomenda-estado-badge" />
            <StatusBadge status={PAY_BADGE[enc.status_pagamento]} testid="encomenda-pagamento-badge" />
          </div>
          <p className="text-sm text-gray-500 mt-1">Encomenda · {enc.cliente}{enc.orcamento_numero ? ` · origem ${enc.orcamento_numero}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <PdfExportButton modulo="encomenda" recordId={id} />
          {can("encomendas", "edit") && (
            <button data-testid="save-encomenda-btn" onClick={() => save()} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Save size={16} /> Guardar</button>
          )}
          {can("ordens_fabrico", "create") && (
            <button data-testid="encomenda-criar-of-btn" onClick={criarOF} className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Criar Ordem de Fabrico</button>
          )}
        </div>
      </div>

      {/* KPIs financeiros */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="enc-kpi-valor">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor da Encomenda</div>
          <div className="text-2xl font-bold tabular-nums font-display mt-1">{eur(enc.valor_total)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="enc-kpi-pago">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pago</div>
          <div className="text-2xl font-bold tabular-nums font-display mt-1 text-emerald-600">{eur(enc.valor_pago)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Pendente {eur(enc.valor_pendente)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="enc-kpi-custo-real">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Produção (real)</div>
          <div className="text-2xl font-bold tabular-nums font-display mt-1">{eur(enc.custo_producao_real)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Estimado {eur(enc.custo_producao_estimado)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="enc-kpi-margem">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Margem (valor − custo real)</div>
          <div className={`text-2xl font-bold tabular-nums font-display mt-1 ${enc.margem_producao >= 0 ? "text-emerald-600" : "text-red-600"}`}>{eur(enc.margem_producao)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cliente */}
        <div className="bg-white border border-gray-200 rounded-sm p-5" data-testid="encomenda-cliente-info">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><User size={15} /> Cliente</h3>
          <div className="space-y-2 text-sm">
            <div className="font-medium text-gray-900">{enc.cliente}</div>
            {cliente?.contacto && <div className="text-gray-600 flex items-center gap-2"><Phone size={13} /> {cliente.contacto}</div>}
            {cliente?.email && <div className="text-gray-600 flex items-center gap-2"><Mail size={13} /> {cliente.email}</div>}
            {(cliente?.morada || cliente?.cidade) && <div className="text-gray-600 flex items-start gap-2"><MapPin size={13} className="mt-0.5" /> <span>{moradaCompleta}</span></div>}
            {cliente?.nif && <div className="text-gray-600 flex items-center gap-2"><Hash size={13} /> {cliente.nif}</div>}
            <div className="text-gray-500 text-xs pt-2 border-t border-gray-100">Data: {fmtDate(enc.data)}</div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-gray-500 shrink-0">Prazo de entrega</span>
              <input data-testid="enc-prazo-input" type="date" value={enc.prazo_entrega || ""} onChange={(e) => upd({ prazo_entrega: e.target.value })} onBlur={() => persist({}, "Prazo atualizado")} className="border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
            </div>
            {enc.descricao && <div className="text-gray-600 text-sm">{enc.descricao}</div>}
          </div>
        </div>

        {/* Pagamento & Produção */}
        <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-4" data-testid="encomenda-financeiro">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Wallet size={15} /> Pagamento & Produção</h3>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor total</label>
              <button data-testid="enc-valor-toggle" onClick={() => { const m = !enc.valor_total_manual; upd({ valor_total_manual: m, valor_total: m ? (enc.valor_total || valorMostrado) : enc.valor_total }); setEditValor(m); }} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"><Pencil size={11} /> {enc.valor_total_manual ? "Auto" : "Manual"}</button>
            </div>
            {enc.valor_total_manual ? (
              <input data-testid="enc-valor-input" type="number" step="0.01" value={enc.valor_total ?? 0} onChange={(e) => upd({ valor_total: e.target.value })} onBlur={() => persist({}, "Valor atualizado")} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            ) : (
              <div className="text-lg font-semibold tabular-nums">{eur(enc.valor_total)}<span className="text-xs text-gray-400 font-normal ml-2">(auto · artigos/operações/personalizações)</span></div>
            )}
          </div>

          {!enc.valor_total_manual && !enc.orcamento_id && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desconto no total</label>
                {descTotalVal > 0 && <span className="text-xs text-red-600 tabular-nums" data-testid="enc-desc-total-val">- {eur(descTotalVal)}</span>}
              </div>
              <div className="flex items-center gap-2">
                <input data-testid="enc-desc-total-input" type="number" min="0" step="0.01" value={enc.desconto_total ?? 0} onChange={(e) => upd({ desconto_total: e.target.value })} onBlur={() => persist({}, "Desconto atualizado")} className="flex-1 border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                <select data-testid="enc-desc-total-tipo" value={enc.desconto_total_tipo || "pct"} onChange={(e) => persist({ desconto_total_tipo: e.target.value }, "Desconto atualizado")} className="border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20">
                  <option value="pct">%</option>
                  <option value="eur">€</option>
                </select>
              </div>
            </div>
          )}

          <div data-testid="enc-pagamentos">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pagamentos</label>
              <span className="text-xs text-gray-500 tabular-nums">Pago {eur(enc.valor_pago)} · Pendente {eur(enc.valor_pendente)}</span>
            </div>
            {(enc.pagamentos || []).length > 0 ? (
              <div className="space-y-1.5 mb-2" data-testid="enc-pagamentos-lista">
                {enc.pagamentos.map((p) => (
                  <div key={p.id} data-testid={`enc-pagamento-${p.id}`} className="flex items-center justify-between gap-2 border border-gray-200 rounded-sm px-2.5 py-1.5">
                    <div className="min-w-0 text-sm">
                      <span className="tabular-nums font-medium text-gray-900">{eur(p.valor)}</span>
                      <span className="text-xs text-gray-400 ml-2">{METODO_PT[p.metodo] || p.metodo} · {fmtDate(p.data)}{p.recibo_numero ? ` · ${p.recibo_numero}` : ""}</span>
                      {p.nota && <span className="text-xs text-gray-400 ml-1">· {p.nota}</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={reciboUrl(p.id)} target="_blank" rel="noreferrer" data-testid={`enc-recibo-${p.id}`} title="Recibo (PDF)" className="p-1 text-gray-400 hover:text-gray-900"><Receipt size={15} /></a>
                      {can("encomendas", "edit") && <button onClick={() => delPagamento(p.id)} data-testid={`enc-pagamento-del-${p.id}`} title="Remover" className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 mb-2">Sem pagamentos registados.</p>}

            {can("encomendas", "edit") && (
              <>
                <div className="flex items-center gap-1.5" data-testid="enc-pagamento-form">
                  <input data-testid="enc-pagamento-valor" type="number" step="0.01" placeholder="Valor" value={pagValor} onChange={(e) => setPagValor(e.target.value)} className="w-24 border border-gray-300 rounded-sm px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                  <select data-testid="enc-pagamento-metodo" value={pagMetodo} onChange={(e) => setPagMetodo(e.target.value)} className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                    {Object.entries(METODO_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input data-testid="enc-pagamento-nota" placeholder="Nota (opcional)" value={pagNota} onChange={(e) => setPagNota(e.target.value)} className="flex-1 min-w-0 border border-gray-300 rounded-sm px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-black/20" />
                  <button data-testid="enc-pagamento-add" onClick={() => addPagamento()} className="shrink-0 bg-gray-900 text-white rounded-sm px-2.5 py-1.5 text-sm hover:bg-gray-800"><Plus size={15} /></button>
                </div>
                {(enc.valor_pendente || 0) > 0 && (
                  <button data-testid="enc-marcar-pago-btn" onClick={() => addPagamento(enc.valor_pendente, "Pagamento total")} className="mt-1.5 text-xs border border-gray-300 rounded-sm px-2.5 py-1.5 hover:bg-gray-50 text-gray-700">Registar pagamento total ({eur(enc.valor_pendente)})</button>
                )}
              </>
            )}
          </div>

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

        {/* OFs */}
        <div className="bg-white border border-gray-200 rounded-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Factory size={15} /> Ordens de Fabrico</h3>
          {(enc.ordens_fabrico || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Ainda sem ordens de fabrico.</p>
          ) : (
            <div className="space-y-2" data-testid="encomenda-ofs">
              {enc.ordens_fabrico.map((o) => (
                <Link key={o.id} to={`/ordens-fabrico/${o.id}`} data-testid={`encomenda-of-${o.id}`} className="flex items-center justify-between gap-3 border border-gray-200 rounded-sm px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="mono tabular-nums font-medium text-gray-900">{o.numero}</span>
                    <span className="text-sm text-gray-500">{Math.round(o.progresso || 0)}%</span>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Artigos da encomenda */}
      <div className="bg-white border border-gray-200 rounded-sm p-5 mt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Package size={15} /> Artigos da Encomenda</h3>
          {can("encomendas", "edit") && (
            <div className="sm:w-72">
              <Combobox options={artigoOptions} value="" onChange={(v) => addArtigo(v)} placeholder="+ Adicionar artigo..." searchPlaceholder="Pesquisar artigo..." emptyText="Nenhum artigo." testid="enc-add-artigo" optionTestidPrefix="enc-artigo-option" />
            </div>
          )}
        </div>
        {(enc.artigos || []).length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Sem artigos. Adicione artigos ou converta um orçamento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]" data-testid="enc-artigos-table">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Artigo</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Personalização</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Qtd</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Preço Unit.</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Unit. c/Pers</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Desconto</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subtotal</th>
                  <th className="px-4 py-2.5 w-12"></th>
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
                              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome} ({eur(t.valor)})</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <div className="flex items-center gap-1.5 justify-end">
                          <input data-testid={`enc-artigo-qtd-${i}`} type="number" min="1" value={a.quantidade} onChange={(e) => updArtigo(i, { quantidade: e.target.value })} onBlur={() => persist({})} className="w-16 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <span className="text-xs text-gray-400 shrink-0">{artUnidade(a.artigo_id)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <input data-testid={`enc-artigo-preco-${i}`} type="number" step="0.01" value={a.preco_unit} onChange={(e) => updArtigo(i, { preco_unit: e.target.value })} onBlur={() => persist({})} className="w-24 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                        {precoHist[a.artigo_id] && (
                          <button
                            type="button"
                            data-testid={`enc-preco-hint-${i}`}
                            title="Aplicar o último preço praticado a este cliente"
                            onClick={() => { updArtigo(i, { preco_unit: precoHist[a.artigo_id].ultimo_preco }); persist({ artigos: enc.artigos.map((x, idx) => idx === i ? { ...x, preco_unit: precoHist[a.artigo_id].ultimo_preco } : x) }); }}
                            className="block ml-auto mt-1 text-[11px] text-blue-600 hover:underline whitespace-nowrap"
                          >
                            Último: {eur(precoHist[a.artigo_id].ultimo_preco)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900 align-top" data-testid={`enc-artigo-unit-pers-${i}`}>{eur(unitPers)}</td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <div className="flex items-center gap-1 justify-end">
                          <input data-testid={`enc-artigo-desc-${i}`} type="number" min="0" step="0.01" value={a.desconto ?? 0} onChange={(e) => updArtigo(i, { desconto: e.target.value })} onBlur={() => persist({})} className="w-16 text-right border border-gray-300 rounded-sm px-1.5 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <select data-testid={`enc-artigo-desc-tipo-${i}`} value={a.desconto_tipo || "pct"} onChange={(e) => updArtigo(i, { desconto_tipo: e.target.value })} onBlur={() => persist({})} className="border border-gray-300 rounded-sm px-1 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                            <option value="pct">%</option>
                            <option value="eur">€</option>
                          </select>
                        </div>
                        {lineDisc(a) > 0 && <div className="text-[10px] text-red-500 text-right mt-0.5">- {eur(lineDisc(a))}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium align-top" data-testid={`enc-artigo-subtotal-${i}`}>{eur(lineNet(a))}</td>
                      <td className="px-4 py-2.5 align-top"><button data-testid={`enc-artigo-del-${i}`} onClick={() => delArtigo(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">As alterações aos artigos são guardadas automaticamente e o valor é recalculado. Encomendas com origem em orçamento usam o valor do orçamento.</p>
      </div>

      <ImagensGaleria value={enc.imagens} onChange={(imgs) => persist({ imagens: imgs })} title="Imagens da encomenda" hint="Imagens de referência de toda a encomenda. Transitam para a ordem de fabrico ao criar." />

      <HistoricoTimeline tipo="encomenda" id={id} />
    </div>
  );
}
