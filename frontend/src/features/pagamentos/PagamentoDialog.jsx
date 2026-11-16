import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { FileSignature, FileText, Lock, Save } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export const METODOS_PAGAMENTO = [
  { id: "transferencia", label: "Transferência bancária" },
  { id: "numerario", label: "Numerário" },
  { id: "mbway", label: "MB WAY" },
  { id: "multibanco", label: "Multibanco" },
  { id: "cheque", label: "Cheque" },
  { id: "cartao", label: "Cartão" },
  { id: "outro", label: "Outro" },
];

const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50 disabled:text-gray-500";

function erro(e, msg) {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : msg);
}

/**
 * Ficha de um pagamento: editar (enquanto não está faturado/assinado) e emitir fatura.
 * `pagamento` vem de GET /pagamentos.
 */
export default function PagamentoDialog({ pagamento, onClose, onChanged }) {
  const { can } = useAuth();
  const confirmAction = useConfirm();
  const nav = useNavigate();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tipoDoc, setTipoDoc] = useState("fatura_recibo");

  useEffect(() => {
    if (pagamento) {
      setForm({ data: pagamento.data || "", valor: pagamento.valor, metodo: pagamento.metodo, nota: pagamento.nota || "" });
      setTipoDoc("fatura_recibo");
    }
  }, [pagamento]);

  if (!pagamento || !form) return null;
  const p = pagamento;
  const podeEditar = can("encomendas", "edit") && !p.bloqueado;
  const podeFaturar = can("financeiro", "create") && p.tipo !== "devolucao" && p.faturado === "nao";
  const mudou = form.data !== (p.data || "") || Number(form.valor) !== Number(p.valor)
    || form.metodo !== p.metodo || form.nota !== (p.nota || "");

  const guardar = async () => {
    setBusy(true);
    try {
      const out = await api.put(`/encomendas/${p.encomenda_id}/pagamentos/${p.id}`, {
        data: form.data, valor: Number(form.valor), metodo: form.metodo, nota: form.nota,
      });
      toast.success("Pagamento atualizado");
      await onChanged?.(out);
      return true;
    } catch (e) {
      erro(e, "Não foi possível guardar");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const faturar = async (assinar) => {
    if (mudou && !(await guardar())) return;
    if (assinar && !await confirmAction({
      title: tipoDoc === "fatura" ? "Emitir e assinar fatura" : "Emitir e assinar fatura-recibo",
      description: `Fica com número e assinada (${eur(p.valor)}). Depois de assinada já não pode ser editada — só anulada.`,
      confirmLabel: "Emitir e assinar",
    })) return;
    setBusy(true);
    try {
      const doc = await api.post(`/encomendas/${p.encomenda_id}/pagamentos/${p.id}/documento`, {
        tipo: tipoDoc, assinar,
      });
      toast.success(assinar ? `${doc.numero} emitida e assinada` : "Rascunho criado — reveja e assine");
      await onChanged?.(null);
      onClose?.();
      nav(`/financeiro/${doc.id}`);
    } catch (e) {
      erro(e, "Não foi possível emitir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!pagamento} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {p.tipo === "devolucao" ? "Devolução" : "Pagamento"} {p.recibo_numero || ""}
          </DialogTitle>
          <DialogDescription>
            <Link to={`/encomendas/${p.encomenda_id}`} className="mono text-gray-900 hover:underline">{p.encomenda_numero}</Link>
            {" · "}{p.cliente}
          </DialogDescription>
        </DialogHeader>

        {p.bloqueado && (
          <div className="flex items-start gap-2 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" data-testid="pagamento-bloqueado">
            <Lock size={15} className="shrink-0 mt-0.5 text-gray-500" />
            <span>
              {p.motivo_bloqueio}. Já não pode ser alterado — para corrigir, anule o documento fiscal.
              {p.documento_id && (
                <> <Link to={`/financeiro/${p.documento_id}`} className="underline">Abrir documento</Link></>
              )}
            </span>
          </div>
        )}
        {p.faturado === "rascunho" && (
          <div className="flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <FileText size={15} className="shrink-0 mt-0.5" />
            <span>
              Tem uma fatura em rascunho. <Link to={`/financeiro/${p.documento_id}`} className="underline font-medium">Rever e assinar</Link>
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 py-1">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Data</label>
            <input type="date" className={inputCls} value={form.data || ""} disabled={!podeEditar} onChange={(e) => setForm({ ...form, data: e.target.value })} data-testid="pagamento-data" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Valor (€)</label>
            <input type="number" min="0" step="0.01" className={`${inputCls} tabular-nums`} value={form.valor} disabled={!podeEditar} onChange={(e) => setForm({ ...form, valor: e.target.value })} data-testid="pagamento-valor" />
          </div>
          <div className="col-span-2">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Método</label>
            <select className={inputCls} value={form.metodo} disabled={!podeEditar} onChange={(e) => setForm({ ...form, metodo: e.target.value })} data-testid="pagamento-metodo">
              {METODOS_PAGAMENTO.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nota</label>
            <textarea rows={2} className={`${inputCls} resize-y`} value={form.nota} disabled={!podeEditar} onChange={(e) => setForm({ ...form, nota: e.target.value })} data-testid="pagamento-nota" />
          </div>
          <div className="col-span-2 text-xs text-gray-400">
            Registado {p.created_at ? fmtDate(p.created_at) : "—"} · origem {p.origem === "fatura" ? "recibo fiscal" : "encomenda"}
          </div>
        </div>

        {podeFaturar && (
          <div className="rounded-sm border border-gray-200 p-3 space-y-2" data-testid="pagamento-faturar">
            <div className="text-sm font-semibold text-gray-800">Emitir documento fiscal</div>
            <div className="flex flex-wrap gap-2 text-sm">
              {[["fatura_recibo", "Fatura-recibo"], ["fatura", "Fatura (+ recibo)"]].map(([id, label]) => (
                <label key={id} className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 cursor-pointer ${tipoDoc === id ? "border-brand bg-brand-soft text-gray-900" : "border-gray-300 text-gray-600"}`}>
                  <input type="radio" name="tipo-doc" className="accent-current" checked={tipoDoc === id} onChange={() => setTipoDoc(id)} />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              O valor do documento é o deste pagamento. Em rascunho ainda pode rever linhas e notas; depois de assinado fica fixo.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={busy} onClick={() => faturar(false)} className="btn btn-secundario btn-sm" data-testid="pagamento-criar-rascunho">
                <FileText size={14} /> Criar rascunho
              </button>
              <button type="button" disabled={busy} onClick={() => faturar(true)} className="btn btn-primario btn-sm" data-testid="pagamento-emitir-assinar">
                <FileSignature size={14} /> Emitir e assinar
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-secundario">Fechar</button>
          {podeEditar && (
            <button type="button" disabled={busy || !mudou} onClick={guardar} className="btn btn-primario" data-testid="pagamento-guardar">
              <Save size={15} /> {busy ? "A guardar…" : "Guardar"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
