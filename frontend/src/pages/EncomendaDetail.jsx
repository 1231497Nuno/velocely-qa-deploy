import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, fmtDate, eur } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";
import Combobox from "../components/Combobox";
import {
  ArrowLeft, Plus, Factory, User, Mail, Phone, MapPin, Hash, Save, Trash2,
  Wallet, ShieldCheck, ShieldAlert, CheckCircle2, Package, Pencil,
} from "lucide-react";
import { toast } from "sonner";

const PAY_BADGE = { pendente: "pendente", parcial: "parcial", pago: "pago" };

export default function EncomendaDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [enc, setEnc] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [editValor, setEditValor] = useState(false);

  const load = useCallback(async () => {
    const e = await api.get(`/encomendas/${id}`);
    setEnc(e);
    setArtigos(await api.get("/artigos"));
    if (e.cliente_id) {
      const cs = await api.get("/clientes");
      setCliente(cs.find((c) => c.id === e.cliente_id) || null);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!enc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setEnc({ ...enc, ...patch });

  const artigosTotal = (enc.artigos || []).reduce((s, a) => {
    const persUnit = (a.personalizacoes || []).reduce((x, p) => x + (Number(p.valor) || 0), 0);
    return s + ((Number(a.preco_unit) || 0) + persUnit) * (Number(a.quantidade) || 0);
  }, 0);
  const valorMostrado = enc.valor_total_manual ? (Number(enc.valor_total) || 0) : (enc.orcamento_id ? enc.valor_total : artigosTotal);

  const buildBody = (over = {}) => ({
    cliente: enc.cliente,
    cliente_id: enc.cliente_id || null,
    descricao: enc.descricao || "",
    data: enc.data,
    estado: enc.estado,
    notas: enc.notas || "",
    artigos: (enc.artigos || []).map((a) => ({
      ...a,
      quantidade: Number(a.quantidade) || 1,
      preco_unit: Number(a.preco_unit) || 0,
    })),
    valor_total: enc.valor_total_manual ? Number(enc.valor_total) || 0 : null,
    valor_total_manual: !!enc.valor_total_manual,
    valor_pago: Number(enc.valor_pago) || 0,
    autorizada_producao: !!enc.autorizada_producao,
    ...over,
  });

  const save = async (over) => {
    const updated = await api.put(`/encomendas/${id}`, buildBody(over));
    setEnc(updated);
    toast.success("Encomenda guardada");
  };

  const addArtigo = (artigoId) => {
    const a = artigos.find((x) => x.id === artigoId);
    if (!a) return;
    upd({ artigos: [...(enc.artigos || []), { id: crypto.randomUUID(), artigo_id: a.id, artigo_nome: a.nome, quantidade: 1, preco_unit: Number(a.preco_venda) || 0, personalizacoes: [] }] });
  };
  const updArtigo = (i, patch) => {
    const list = [...enc.artigos];
    list[i] = { ...list[i], ...patch };
    upd({ artigos: list });
  };
  const delArtigo = (i) => upd({ artigos: enc.artigos.filter((_, idx) => idx !== i) });

  const criarOF = async () => {
    const itens = (enc.artigos || []).filter((a) => a.artigo_id).map((a) => ({
      artigo_id: a.artigo_id, artigo_nome: a.artigo_nome, quantidade: Number(a.quantidade) || 1,
      personalizacoes: a.personalizacoes || [], operacoes: [],
    }));
    const of = await api.post(`/encomendas/${id}/ordens-fabrico`, { cliente: enc.cliente, itens });
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
            {(cliente?.morada || cliente?.cidade) && <div className="text-gray-600 flex items-start gap-2"><MapPin size={13} className="mt-0.5" /> <span>{[cliente.morada, cliente.codigo_postal, cliente.cidade, cliente.pais].filter(Boolean).join(", ")}</span></div>}
            {cliente?.nif && <div className="text-gray-600 flex items-center gap-2"><Hash size={13} /> {cliente.nif}</div>}
            <div className="text-gray-500 text-xs pt-2 border-t border-gray-100">Data: {fmtDate(enc.data)}</div>
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
              <input data-testid="enc-valor-input" type="number" step="0.01" value={enc.valor_total ?? 0} onChange={(e) => upd({ valor_total: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            ) : (
              <div className="text-lg font-semibold tabular-nums">{eur(enc.valor_total)}<span className="text-xs text-gray-400 font-normal ml-2">(auto · artigos/operações/personalizações)</span></div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Valor pago</label>
            <div className="flex items-center gap-2">
              <input data-testid="enc-pago-input" type="number" step="0.01" value={enc.valor_pago ?? 0} onChange={(e) => upd({ valor_pago: e.target.value })} className="flex-1 border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              <button data-testid="enc-marcar-pago-btn" onClick={() => save({ valor_pago: enc.valor_total })} className="shrink-0 text-xs border border-gray-300 rounded-sm px-2.5 py-2 hover:bg-gray-50 text-gray-700">Pago total</button>
            </div>
          </div>

          <div className={`rounded-sm border p-3 flex items-center gap-2.5 ${podeProduzir ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`} data-testid="enc-producao-status">
            {podeProduzir ? <ShieldCheck size={18} className="text-emerald-600 shrink-0" /> : <ShieldAlert size={18} className="text-amber-600 shrink-0" />}
            <div className="text-sm">
              <div className={`font-medium ${podeProduzir ? "text-emerald-800" : "text-amber-800"}`}>{podeProduzir ? "Produção autorizada" : "Produção bloqueada"}</div>
              <div className="text-xs text-gray-600">{podeProduzir ? "As OFs podem arrancar." : "Pagamento total ou autorização manual em falta."}</div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input data-testid="enc-autorizar-check" type="checkbox" checked={!!enc.autorizada_producao} onChange={(e) => save({ autorizada_producao: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
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
            <table className="w-full text-sm min-w-[560px]" data-testid="enc-artigos-table">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Artigo</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Personalização</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Qtd</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Preço Unit.</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subtotal</th>
                  <th className="px-4 py-2.5 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {enc.artigos.map((a, i) => {
                  const persUnit = (a.personalizacoes || []).reduce((x, p) => x + (Number(p.valor) || 0), 0);
                  const sub = ((Number(a.preco_unit) || 0) + persUnit) * (Number(a.quantidade) || 0);
                  return (
                    <tr key={a.id || i} data-testid={`enc-artigo-row-${i}`} className="border-b border-gray-100">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{a.artigo_nome}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs">{(a.personalizacoes || []).map((p) => p.nome).join(", ") || "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input data-testid={`enc-artigo-qtd-${i}`} type="number" min="1" value={a.quantidade} onChange={(e) => updArtigo(i, { quantidade: e.target.value })} className="w-16 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input data-testid={`enc-artigo-preco-${i}`} type="number" step="0.01" value={a.preco_unit} onChange={(e) => updArtigo(i, { preco_unit: e.target.value })} className="w-24 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{eur(sub)}</td>
                      <td className="px-4 py-2.5"><button data-testid={`enc-artigo-del-${i}`} onClick={() => delArtigo(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">As alterações aos artigos só são contabilizadas após Guardar. Encomendas com origem em orçamento usam o valor do orçamento.</p>
      </div>
    </div>
  );
}
