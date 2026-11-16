import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, RotateCcw } from "lucide-react";
import { api, eur } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "border border-gray-300 rounded-sm px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";
const num = (v) => (Number(v) || 0).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
const erro = (e, msg) => {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : msg);
};

/** Fecho da OF: quantidade produzida e refugo, materiais realmente consumidos (abatem ao stock) e custo fechado. */
export function FechoOFDialog({ ofId, open, onClose, onDone }) {
  const [pv, setPv] = useState(null);
  const [f, setF] = useState({});
  const [opts, setOpts] = useState({ abater_stock: true, entrada_stock: true, notas: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.get(`/ordens-fabrico/${ofId}/fecho`).then((r) => {
      setPv(r);
      setF(Object.fromEntries(r.itens.map((it) => [it.item_id, {
        qtd_produzida: it.quantidade, qtd_refugo: 0, motivo_refugo: "",
        materiais: Object.fromEntries(it.materiais.map((m) => [m.id, m.qtd_prevista])),
      }])));
    }).catch(() => toast.error("Não foi possível preparar o fecho"));
  }, [open, ofId]);
  const set = (iid, patch) => setF((x) => ({ ...x, [iid]: { ...x[iid], ...patch } }));
  const gravar = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/ordens-fabrico/${ofId}/fechar`, {
        ...opts,
        itens: pv.itens.map((it) => ({
          item_id: it.item_id, qtd_produzida: Number(f[it.item_id].qtd_produzida) || 0, qtd_refugo: Number(f[it.item_id].qtd_refugo) || 0,
          motivo_refugo: f[it.item_id].motivo_refugo,
          materiais: it.materiais.map((m) => ({ id: m.id, qtd_consumida: Number(f[it.item_id].materiais[m.id]) || 0 })),
        })),
      });
      toast.success(`OF fechada — custo real ${eur(r.fecho.custo_total)}`);
      onDone(r);
    } catch (e) { erro(e, "Não foi possível fechar a OF"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fechar ordem de fabrico</DialogTitle>
          <DialogDescription>Confirme o que foi produzido, o refugo e os materiais gastos. O custo fica fechado com os tempos reais e os consumos.</DialogDescription>
        </DialogHeader>
        {pv && (
          <div className="space-y-4">
            {pv.itens.map((it) => (
              <div key={it.item_id} className="border border-gray-200 rounded-sm p-3 space-y-2">
                <div className="font-medium text-sm">{it.artigo_nome} <span className="text-gray-400 font-normal">· previsto {num(it.quantidade)} {it.unidade}</span></div>
                <div className="flex flex-wrap items-end gap-3 text-sm">
                  <label className="flex flex-col text-xs text-gray-600">Produzido (bom)<input type="number" min="0" step="any" className={`${inputCls} w-24`} value={f[it.item_id]?.qtd_produzida ?? ""} onChange={(e) => set(it.item_id, { qtd_produzida: e.target.value })} data-testid={`fecho-prod-${it.item_id}`} /></label>
                  <label className="flex flex-col text-xs text-gray-600">Refugo<input type="number" min="0" step="any" className={`${inputCls} w-20`} value={f[it.item_id]?.qtd_refugo ?? ""} onChange={(e) => set(it.item_id, { qtd_refugo: e.target.value })} data-testid={`fecho-refugo-${it.item_id}`} /></label>
                  {Number(f[it.item_id]?.qtd_refugo) > 0 && <label className="flex flex-col text-xs text-gray-600 flex-1 min-w-[10rem]">Motivo do refugo<input className={inputCls} value={f[it.item_id]?.motivo_refugo || ""} onChange={(e) => set(it.item_id, { motivo_refugo: e.target.value })} /></label>}
                </div>
                {it.materiais.length > 0 && (
                  <table className="w-full text-xs">
                    <thead className="text-gray-500"><tr><th className="text-left py-1">Material</th><th className="text-right">Previsto</th><th className="text-right">Gasto</th></tr></thead>
                    <tbody>
                      {it.materiais.map((m) => (
                        <tr key={m.id} className="border-t border-gray-100">
                          <td className="py-1">{m.nome}</td>
                          <td className="text-right tabular-nums">{num(m.qtd_prevista)} {m.unidade}</td>
                          <td className="text-right"><input type="number" min="0" step="any" className={`${inputCls} w-24 text-right`} value={f[it.item_id]?.materiais?.[m.id] ?? ""} onChange={(e) => set(it.item_id, { materiais: { ...f[it.item_id].materiais, [m.id]: e.target.value } })} data-testid={`fecho-mat-${m.id}`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="text-xs text-gray-500 dado-custo">Operações: estimado {eur(it.custo_operacoes_estimado)} · real {eur(it.custo_operacoes_real)}</div>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opts.abater_stock} onChange={(e) => setOpts({ ...opts, abater_stock: e.target.checked })} /> Abater os materiais gastos ao stock</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opts.entrada_stock} onChange={(e) => setOpts({ ...opts, entrada_stock: e.target.checked })} /> Dar entrada em stock do que foi produzido para stock (linhas sem encomenda)</label>
            <textarea className={`${inputCls} w-full`} rows={2} placeholder="Notas do fecho" value={opts.notas} onChange={(e) => setOpts({ ...opts, notas: e.target.value })} />
          </div>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy || !pv} onClick={gravar} data-testid="fecho-gravar"><ClipboardCheck size={15} /> Fechar OF</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FechoOFResumo({ of, podeEditar, onChanged }) {
  const confirm = useConfirm();
  const fe = of.fecho;
  if (!fe?.fechada) return null;
  const anular = async () => {
    if (!(await confirm({ title: "Anular o fecho?", description: "Os movimentos de stock do fecho são revertidos. Pode voltar a fechar depois.", confirmLabel: "Anular fecho", tone: "danger" }))) return;
    try { onChanged(await api.post(`/ordens-fabrico/${of.id}/fecho/anular`, {})); toast.success("Fecho anulado"); } catch (e) { erro(e, "Não foi possível anular"); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 text-sm" data-testid="of-fecho-resumo">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <ClipboardCheck size={16} className="text-emerald-700" />
        <span className="font-semibold">OF fechada</span>
        <span className="text-gray-500">{fe.por} · {new Date(fe.at).toLocaleString("pt-PT")}</span>
        {podeEditar && <button type="button" className="ml-auto btn btn-secundario" onClick={anular} data-testid="of-fecho-anular"><RotateCcw size={14} /> Anular fecho</button>}
      </div>
      <table className="w-full text-xs">
        <thead className="text-gray-500"><tr><th className="text-left py-1">Artigo</th><th className="text-right">Previsto</th><th className="text-right">Produzido</th><th className="text-right">Refugo</th><th className="text-right dado-custo">Custo real</th><th className="text-right dado-custo">Custo/un.</th><th className="text-right dado-custo">vs estimado</th></tr></thead>
        <tbody>
          {fe.linhas.map((l) => (
            <tr key={l.item_id} className="border-t border-gray-100">
              <td className="py-1">{l.artigo_nome}{l.motivo_refugo ? <span className="text-gray-400"> · {l.motivo_refugo}</span> : null}</td>
              <td className="text-right tabular-nums">{num(l.qtd_prevista)}</td>
              <td className="text-right tabular-nums">{num(l.qtd_produzida)}</td>
              <td className={`text-right tabular-nums ${l.qtd_refugo ? "text-red-700" : ""}`}>{num(l.qtd_refugo)}</td>
              <td className="text-right tabular-nums dado-custo">{eur(l.custo_total)}</td>
              <td className="text-right tabular-nums dado-custo">{eur(l.custo_unitario)}</td>
              <td className={`text-right tabular-nums dado-custo ${l.desvio > 0 ? "text-red-700" : "text-emerald-700"}`}>{l.desvio > 0 ? "+" : ""}{eur(l.desvio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-right dado-custo">Total real <b>{eur(fe.custo_total)}</b> · estimado {eur(fe.custo_estimado)}</div>
      {fe.notas && <div className="mt-1 text-gray-600">{fe.notas}</div>}
    </div>
  );
}
