import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, eur, API, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import { DOC_TIPO_PT } from "@/features/financeiro/Financeiro";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Ban, FileDown, Trash2, Receipt, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const METODO_PT = {
  transferencia: "Transferência", numerario: "Numerário", mbway: "MB WAY",
  cheque: "Cheque", cartao: "Cartão", outro: "Outro",
};

export default function DocumentoFinanceiroDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState(null);
  const [reciboOpen, setReciboOpen] = useState(false);
  const [pagValor, setPagValor] = useState("");
  const [pagMetodo, setPagMetodo] = useState("transferencia");
  const [pagNota, setPagNota] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDoc(await api.get(`/financeiro/documentos/${id}`));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!doc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const isFatura = doc.tipo === "fatura" || doc.tipo === "fatura_recibo";
  const isRecibo = doc.tipo === "recibo";
  const recibos = doc.recibos || [];
  const pendente = Number(doc.valor_pendente) || 0;
  const liquidado = Number(doc.valor_liquidado) || 0;

  const anular = async () => {
    if (!window.confirm(isRecibo ? "Anular este recibo?" : "Anular esta fatura?")) return;
    const updated = await api.post(`/financeiro/documentos/${id}/anular`);
    setDoc(updated);
    toast.success(isRecibo ? "Recibo anulado" : "Fatura anulada");
  };

  const remove = async () => {
    const msg = isFatura
      ? "Eliminar esta fatura e os recibos associados?"
      : "Eliminar este recibo definitivamente?";
    if (!window.confirm(msg)) return;
    await api.del(`/financeiro/documentos/${id}`);
    toast.success(isFatura ? "Fatura eliminada" : "Recibo eliminado");
    if (isRecibo && doc.fatura_id) nav(`/financeiro/${doc.fatura_id}`);
    else nav(`/financeiro?tipo=${doc.tipo === "recibo" ? "fatura" : doc.tipo}`);
  };

  const openRecibo = () => {
    setPagValor(pendente > 0 ? String(pendente) : "");
    setPagMetodo("transferencia");
    setPagNota("");
    setReciboOpen(true);
  };

  const emitirRecibo = async () => {
    const v = Number(pagValor);
    if (!v || v <= 0) return toast.error("Indica um valor positivo");
    setBusy(true);
    try {
      const rec = await api.post(`/financeiro/documentos/${id}/recibos`, {
        valor: v,
        metodo_pagamento: pagMetodo,
        notas: pagNota,
      });
      toast.success(`Recibo ${rec.numero} emitido`);
      setReciboOpen(false);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível emitir o recibo");
    } finally {
      setBusy(false);
    }
  };

  const tipoLabel = DOC_TIPO_PT[doc.tipo] || doc.tipo;
  const valor = isRecibo ? (doc.valor_pago || doc.total) : doc.total;
  const backTipo = isRecibo ? "fatura" : doc.tipo;
  const backTo = isRecibo && doc.fatura_id
    ? () => nav(`/financeiro/${doc.fatura_id}`)
    : () => nav(`/financeiro?tipo=${backTipo}`);

  return (
    <div>
      <button onClick={backTo} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1.5 mb-4">
        <ArrowLeft size={15} /> {isRecibo && doc.fatura_numero ? `Voltar à fatura ${doc.fatura_numero}` : "Voltar às faturas"}
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{doc.numero}</h1>
            <StatusBadge status={doc.estado === "anulada" ? "anulada" : "emitida"} testid="doc-estado-badge" />
            {isFatura && <StatusBadge status={doc.status_pagamento || "pendente"} testid="doc-pagamento-badge" />}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {tipoLabel} · {doc.cliente}
            {doc.encomenda_numero ? (
              <> · origem{" "}
                <Link to={`/encomendas/${doc.encomenda_id}`} className="text-gray-700 hover:underline mono">
                  {doc.encomenda_numero}
                </Link>
              </>
            ) : null}
            {isRecibo && doc.fatura_numero ? (
              <> · fatura{" "}
                <Link to={`/financeiro/${doc.fatura_id}`} className="text-gray-700 hover:underline mono">
                  {doc.fatura_numero}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <a
            href={`${API}/financeiro/documentos/${id}/pdf?auth=${getToken()}`}
            target="_blank"
            rel="noreferrer"
            data-testid="doc-pdf-btn"
            className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2"
          >
            <FileDown size={16} /> PDF
          </a>
          {can("financeiro", "create") && isFatura && doc.estado !== "anulada" && pendente > 0 && (
            <button
              data-testid="doc-emitir-recibo-btn"
              onClick={openRecibo}
              className="bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2"
            >
              <Receipt size={16} /> Registar pagamento
            </button>
          )}
          {can("financeiro", "edit") && doc.estado !== "anulada" && (
            <button data-testid="doc-anular-btn" onClick={anular} className="bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Ban size={16} /> Anular
            </button>
          )}
          {can("financeiro", "delete") && (
            <button data-testid="doc-del-btn" onClick={remove} className="bg-white text-red-700 border border-red-300 hover:bg-red-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Trash2 size={16} /> Eliminar
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-3 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-700">Dados</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs uppercase tracking-[0.1em] text-gray-400">Tipo</dt><dd className="font-medium">{tipoLabel}</dd></div>
            <div><dt className="text-xs uppercase tracking-[0.1em] text-gray-400">Data</dt><dd className="tabular-nums">{fmtDate(doc.data)}</dd></div>
            <div><dt className="text-xs uppercase tracking-[0.1em] text-gray-400">Cliente</dt><dd>{doc.cliente || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-[0.1em] text-gray-400">Encomenda</dt><dd className="mono">{doc.encomenda_numero || "—"}</dd></div>
            {(isRecibo || doc.tipo === "fatura_recibo") && doc.metodo_pagamento && (
              <div>
                <dt className="text-xs uppercase tracking-[0.1em] text-gray-400">Método</dt>
                <dd>{METODO_PT[doc.metodo_pagamento] || doc.metodo_pagamento}</dd>
              </div>
            )}
            {doc.notas && (
              <div className="col-span-2"><dt className="text-xs uppercase tracking-[0.1em] text-gray-400">Notas</dt><dd>{doc.notas}</dd></div>
            )}
          </dl>
        </div>
        <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Totais</h3>
          {!isRecibo && (
            <>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Subtotal</span><span className="tabular-nums">{eur(doc.subtotal)}</span></div>
              {(doc.desconto_total || 0) > 0 && (
                <div className="flex justify-between text-sm"><span className="text-gray-500">Desconto</span><span className="tabular-nums text-red-600">- {eur(doc.desconto_total)}</span></div>
              )}
              {(doc.iva_taxa || 0) > 0 && (
                <div className="flex justify-between text-sm"><span className="text-gray-500">IVA ({doc.iva_taxa}%)</span><span className="tabular-nums">{eur(doc.iva_valor)}</span></div>
              )}
            </>
          )}
          <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-2">
            <span>Total</span>
            <span className="tabular-nums" data-testid="doc-total">{eur(valor)}</span>
          </div>
          {isFatura && (
            <>
              <div className="flex justify-between text-sm text-emerald-700">
                <span>Liquidado</span>
                <span className="tabular-nums" data-testid="doc-liquidado">{eur(liquidado)}</span>
              </div>
              <div className="flex justify-between text-sm text-amber-700">
                <span>Pendente</span>
                <span className="tabular-nums" data-testid="doc-pendente">{eur(pendente)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {!isRecibo && (doc.linhas || []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto mb-4">
          <table className="w-full text-sm min-w-[560px]" data-testid="doc-linhas-table">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Descrição</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Qtd</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Preço Unit.</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {doc.linhas.map((l, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{l.descricao}</div>
                    {(l.personalizacoes || []).length > 0 && (
                      <div className="text-xs text-gray-400">{l.personalizacoes.map((p) => p.nome).join(", ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.quantidade}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{eur(l.preco_unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{eur(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isFatura && (
        <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4" data-testid="doc-recibos-panel">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Receipt size={15} /> Recibos desta fatura
            </h3>
            {can("financeiro", "create") && doc.estado !== "anulada" && pendente > 0 && (
              <button
                data-testid="doc-recibo-add-btn"
                onClick={openRecibo}
                className="text-sm border border-gray-300 rounded-sm px-3 py-1.5 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Plus size={14} /> Novo recibo
              </button>
            )}
          </div>

          {recibos.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              Ainda sem recibos. Usa &quot;Registar pagamento&quot; para emitir o primeiro.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]" data-testid="doc-recibos-table">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Método</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor</th>
                    <th className="px-3 py-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {recibos.map((r) => (
                    <tr
                      key={r.id}
                      data-testid={`doc-recibo-row-${r.id}`}
                      onClick={() => nav(`/financeiro/${r.id}`)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-3 py-2 font-medium mono">{r.numero}</td>
                      <td className="px-3 py-2 tabular-nums text-gray-500">{fmtDate(r.data)}</td>
                      <td className="px-3 py-2 text-gray-600">{METODO_PT[r.metodo_pagamento] || r.metodo_pagamento || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{eur(r.valor_pago || r.total)}</td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={`${API}/financeiro/documentos/${r.id}/pdf?auth=${getToken()}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex p-1 text-gray-400 hover:text-gray-900"
                          title="PDF do recibo"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <HistoricoTimeline tipo="documento_financeiro" id={id} />

      <Dialog open={reciboOpen} onOpenChange={setReciboOpen}>
        <DialogContent className="sm:max-w-md" data-testid="emitir-recibo-dialog">
          <DialogHeader>
            <DialogTitle>Registar pagamento / recibo</DialogTitle>
            <DialogDescription>
              Emite um recibo associado à fatura {doc.numero}. Podes emitir vários até liquidar o total.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex justify-between text-sm bg-gray-50 border border-gray-100 rounded-sm px-3 py-2">
              <span className="text-gray-500">Pendente</span>
              <span className="font-semibold tabular-nums">{eur(pendente)}</span>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Valor</label>
              <input
                data-testid="recibo-valor"
                type="number"
                step="0.01"
                min="0.01"
                value={pagValor}
                onChange={(e) => setPagValor(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Método</label>
              <select
                data-testid="recibo-metodo"
                value={pagMetodo}
                onChange={(e) => setPagMetodo(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20"
              >
                {Object.entries(METODO_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Nota (opcional)</label>
              <input
                data-testid="recibo-nota"
                value={pagNota}
                onChange={(e) => setPagNota(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button type="button" onClick={() => setReciboOpen(false)} className="border border-gray-300 rounded-sm px-4 py-2 text-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              data-testid="recibo-confirm"
              disabled={busy}
              onClick={emitirRecibo}
              className="bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "A emitir…" : "Emitir recibo"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
