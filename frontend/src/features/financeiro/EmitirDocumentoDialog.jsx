import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, eur } from "@/lib/api";
import { DOC_TIPOS, DOC_TIPO_PT } from "@/features/financeiro/Financeiro";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const METODO_PT = {
  transferencia: "Transferência", numerario: "Numerário", mbway: "MB WAY",
  cheque: "Cheque", cartao: "Cartão", outro: "Outro",
};

export default function EmitirDocumentoDialog({
  open,
  onOpenChange,
  encomendaId,
  enc,
  onEmitted,
  defaultTipo = "fatura",
}) {
  const nav = useNavigate();
  const [tipo, setTipo] = useState(defaultTipo);
  const [metodo, setMetodo] = useState("transferencia");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumo, setResumo] = useState(null);
  const [qtys, setQtys] = useState({});
  const [adiantamento, setAdiantamento] = useState(false);

  const needsPagamento = tipo === "fatura_recibo";
  const consomeQtd = tipo === "fatura" || tipo === "fatura_recibo";
  const pronta = enc?.estado === "concluida";
  const precisaAdiantamento = consomeQtd && !pronta;

  useEffect(() => {
    if (!open) return;
    setTipo(defaultTipo || "fatura");
    setAdiantamento(false);
    setNotas("");
  }, [open, defaultTipo]);

  useEffect(() => {
    if (!open || !encomendaId) return;
    let alive = true;
    api.get(`/encomendas/${encomendaId}/faturacao`).then((r) => {
      if (!alive) return;
      setResumo(r);
      const init = {};
      (r.artigos || []).forEach((a) => {
        const rest = consomeQtd ? (a.quantidade_restante || 0) : (a.quantidade || 0);
        init[a.encomenda_artigo_id] = rest > 0 ? rest : 0;
      });
      setQtys(init);
    }).catch(() => setResumo(null));
    return () => { alive = false; };
  }, [open, encomendaId, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const artigos = resumo?.artigos || [];

  const preview = useMemo(() => {
    let sub = 0;
    artigos.forEach((a) => {
      const q = Number(qtys[a.encomenda_artigo_id]) || 0;
      if (q > 0) sub += q * (Number(a.preco_unit) || 0);
    });
    const ivaTaxa = enc?.iva_taxa != null ? Number(enc.iva_taxa) : 23;
    const isento = !!enc?.iva_isento || ivaTaxa <= 0;
    const ivaFinal = isento ? 0 : (sub * ivaTaxa) / 100;
    return { subtotal: sub, total: sub + ivaFinal };
  }, [artigos, qtys, enc]);

  const setQty = (id, v) => {
    const a = artigos.find((x) => x.encomenda_artigo_id === id);
    if (!a) return;
    const max = consomeQtd ? (a.quantidade_restante || 0) : (a.quantidade || 0);
    let n = Number(v);
    if (Number.isNaN(n) || n < 0) n = 0;
    if (n > max) n = max;
    setQtys((prev) => ({ ...prev, [id]: n }));
  };

  const preencherRestante = () => {
    const init = {};
    artigos.forEach((a) => {
      const rest = consomeQtd ? (a.quantidade_restante || 0) : (a.quantidade || 0);
      init[a.encomenda_artigo_id] = rest > 0 ? rest : 0;
    });
    setQtys(init);
  };

  const emitir = async () => {
    if (!tipo) return toast.error("Escolhe o tipo de fatura");
    if (precisaAdiantamento && !adiantamento) {
      return toast.error("Confirma adiantamento ou escolhe proforma até a encomenda estar concluída");
    }
    const linhas = artigos
      .map((a) => ({
        encomenda_artigo_id: a.encomenda_artigo_id,
        quantidade: Number(qtys[a.encomenda_artigo_id]) || 0,
      }))
      .filter((l) => l.quantidade > 0);
    if (linhas.length === 0) return toast.error("Indica pelo menos uma quantidade a faturar");

    setBusy(true);
    try {
      const doc = await api.post(`/encomendas/${encomendaId}/documentos`, {
        tipo,
        metodo_pagamento: metodo,
        notas,
        linhas,
        adiantamento: precisaAdiantamento ? adiantamento : false,
      });
      toast.success(`${DOC_TIPO_PT[tipo] || "Fatura"} ${doc.numero} emitida`);
      onOpenChange(false);
      setNotas("");
      setAdiantamento(false);
      if (onEmitted) onEmitted(doc);
      nav(`/financeiro/${doc.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível emitir a fatura");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto" data-testid="emitir-doc-dialog">
        <DialogHeader>
          <DialogTitle>{defaultTipo === "fatura_recibo" ? "Emitir pagamento" : "Emitir fatura"}</DialogTitle>
          <DialogDescription>
            A partir da encomenda {enc?.numero}. Pagamentos ficam associados a fatura ou fatura-recibo (não se registam à mão na encomenda).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-2" data-testid="emitir-doc-tipos">
          {DOC_TIPOS.map((t) => {
            const Icon = t.icon;
            const active = tipo === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`emitir-doc-tipo-${t.id}`}
                onClick={() => setTipo(t.id)}
                className={`text-left border rounded-sm p-3 transition-colors ${active ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-400"}`}
              >
                <div className="flex items-center gap-2 font-medium text-sm text-gray-900">
                  <Icon size={16} className="text-gray-500" />
                  {DOC_TIPO_PT[t.id]}
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-snug">
                  {t.id === "fatura" && "Após material pronto; depois regista o pagamento."}
                  {t.id === "proforma" && "Sem valor fiscal — ok em qualquer altura."}
                  {t.id === "fatura_recibo" && "Fatura + pagamento no mesmo passo."}
                </p>
              </button>
            );
          })}
        </div>

        {precisaAdiantamento && (
          <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2" data-testid="emitir-adiantamento-aviso">
            <p className="text-xs text-amber-900 leading-snug">
              A encomenda ainda não está <strong>concluída</strong> (produção / material pronto).
              A fatura fiscal costuma emitir-se nessa altura. Usa <strong>proforma</strong> entretanto,
              ou confirma adiantamento (sinal / pagamento antecipado).
            </p>
            <label className="flex items-start gap-2 text-sm text-amber-950 cursor-pointer">
              <input
                type="checkbox"
                data-testid="emitir-adiantamento-check"
                checked={adiantamento}
                onChange={(e) => setAdiantamento(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-700"
              />
              <span>Emitir como <strong>adiantamento</strong> antes da conclusão</span>
            </label>
          </div>
        )}

        {pronta && consomeQtd && (
          <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-sm px-3 py-2">
            Encomenda concluída — pronta para faturação fiscal.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Artigos a faturar</label>
            <button type="button" onClick={preencherRestante} className="text-xs text-gray-500 hover:text-gray-900">
              Preencher restante
            </button>
          </div>
          {artigos.length === 0 ? (
            <p className="text-sm text-gray-400 py-3 text-center">Sem artigos na encomenda.</p>
          ) : (
            <div className="border border-gray-200 rounded-sm overflow-hidden" data-testid="emitir-linhas">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Artigo</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Enc.</th>
                    {consomeQtd && <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Já fat.</th>}
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">A faturar</th>
                  </tr>
                </thead>
                <tbody>
                  {artigos.map((a) => {
                    const max = consomeQtd ? (a.quantidade_restante || 0) : (a.quantidade || 0);
                    const disabled = max <= 0;
                    return (
                      <tr key={a.encomenda_artigo_id} className={`border-b border-gray-100 ${disabled ? "opacity-50" : ""}`}>
                        <td className="px-3 py-2 font-medium text-gray-900">{a.artigo_nome}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{a.quantidade}</td>
                        {consomeQtd && (
                          <td className="px-3 py-2 text-right tabular-nums text-gray-400">{a.quantidade_faturada || 0}</td>
                        )}
                        <td className="px-3 py-2 text-right">
                          <input
                            data-testid={`emitir-qtd-${a.encomenda_artigo_id}`}
                            type="number"
                            min="0"
                            step="any"
                            max={max}
                            disabled={disabled}
                            value={qtys[a.encomenda_artigo_id] ?? 0}
                            onChange={(e) => setQty(a.encomenda_artigo_id, e.target.value)}
                            className="w-20 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums disabled:bg-gray-50"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm bg-gray-50 border border-gray-100 rounded-sm px-3 py-2">
            <span className="text-gray-500">Valor estimado (s/ IVA prop.)</span>
            <span className="font-semibold tabular-nums" data-testid="emitir-doc-valor">{eur(preview.total)}</span>
          </div>

          {needsPagamento && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Método de pagamento</label>
              <select
                data-testid="emitir-doc-metodo"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20"
              >
                {Object.entries(METODO_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Notas (opcional)</label>
            <textarea
              data-testid="emitir-doc-notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 resize-none"
              placeholder="Observações na fatura…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button type="button" onClick={() => onOpenChange(false)} className="border border-gray-300 rounded-sm px-4 py-2 text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            data-testid="emitir-doc-confirm"
            disabled={busy || (precisaAdiantamento && !adiantamento)}
            onClick={emitir}
            className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "A emitir…" : `Emitir ${DOC_TIPO_PT[tipo] || "fatura"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
