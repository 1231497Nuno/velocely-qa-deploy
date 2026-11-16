import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, eur } from "@/lib/api";
import { METODOS_PAGAMENTO } from "@/features/pagamentos/metodos";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";

/** Nota de crédito sobre uma fatura emitida: por linhas (devolução de artigos) ou por valor (acerto). */
export default function NotaCreditoDialog({ open, doc, onClose }) {
  const nav = useNavigate();
  const [modo, setModo] = useState("linhas");
  const [qtd, setQtd] = useState({});
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [devolver, setDevolver] = useState(false);
  const [metodo, setMetodo] = useState("transferencia");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQtd({}); setValor(""); setMotivo(""); setDevolver(false); setModo("linhas"); } }, [open]);

  const linhas = doc.linhas || [];
  const totalLinhas = linhas.reduce((s, l, i) => s + (Number(qtd[i]) || 0) * ((Number(l.subtotal) || 0) / (Number(l.quantidade) || 1)), 0);
  const fator = 1 + (Number(doc.iva_taxa) || 0) / 100;
  const estimado = modo === "linhas" ? totalLinhas * fator : Number(valor) || 0;

  const criar = async (assinar) => {
    setBusy(true);
    try {
      const body = { motivo, devolver, metodo, assinar };
      if (modo === "linhas") body.linhas = linhas.map((_, i) => ({ indice: i, quantidade: Number(qtd[i]) || 0 })).filter((x) => x.quantidade > 0);
      else body.valor = Number(valor) || 0;
      const nc = await api.post(`/financeiro/documentos/${doc.id}/nota-credito`, body);
      if (nc.aviso_faturacao) toast.error(nc.aviso_faturacao, { duration: 10000 });
      else toast.success(assinar ? `Nota de crédito ${nc.numero} emitida` : "Nota de crédito em rascunho");
      onClose();
      nav(`/financeiro/${nc.id}`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível criar a nota de crédito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="nc-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Nota de crédito — {doc.numero}</DialogTitle>
          <DialogDescription>Para devoluções ou correções. Reduz o valor em dívida da fatura e, se escolher, regista a devolução do dinheiro na encomenda.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 text-sm">
          {[["linhas", "Devolver artigos (por linha)"], ["valor", "Acerto de valor"]].map(([id, l]) => (
            <label key={id} className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 cursor-pointer ${modo === id ? "border-brand bg-brand-soft" : "border-gray-300 text-gray-600"}`}>
              <input type="radio" checked={modo === id} onChange={() => setModo(id)} /> {l}
            </label>
          ))}
        </div>
        {modo === "linhas" ? (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-gray-200"><th className="text-left py-1.5">Linha</th><th className="text-right">Faturado</th><th className="text-right w-28">Creditar</th></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1.5">{l.descricao}</td>
                  <td className="text-right tabular-nums">{l.quantidade}</td>
                  <td className="text-right"><input type="number" min="0" max={l.quantidade} step="any" className={`${inputCls} w-24 text-right tabular-nums`} value={qtd[i] ?? ""} onChange={(e) => setQtd({ ...qtd, [i]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <label className="text-sm text-gray-700">Valor a creditar (c/ IVA)
            <input type="number" min="0" step="0.01" className={`${inputCls} ml-2 w-32 tabular-nums`} value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
        )}
        <input className={`${inputCls} w-full`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obrigatório): artigo com defeito, devolução, erro no preço…" data-testid="nc-motivo" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={devolver} onChange={(e) => setDevolver(e.target.checked)} /> Devolver o dinheiro ao cliente</label>
          {devolver && (
            <select className={inputCls} value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS_PAGAMENTO.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          <span className="ml-auto text-gray-600">Total aproximado: <strong className="tabular-nums">{eur(estimado)}</strong></span>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-secundario">Cancelar</button>
          <button type="button" disabled={busy || !motivo.trim() || estimado <= 0} onClick={() => criar(false)} className="btn btn-secundario">Criar rascunho</button>
          <button type="button" disabled={busy || !motivo.trim() || estimado <= 0} onClick={() => criar(true)} className="btn btn-primario" data-testid="nc-emitir">Emitir</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
