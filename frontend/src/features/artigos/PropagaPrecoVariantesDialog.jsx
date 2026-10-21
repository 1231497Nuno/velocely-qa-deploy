import { useEffect, useState } from "react";
import { api, eur } from "@/lib/api";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

/**
 * Quando o preço/margem do artigo pai muda, pergunta se quer aplicar às variantes.
 * openPayload: { campos: string[], precoVenda?: number } | null
 */
export default function PropagaPrecoVariantesDialog({
  open,
  onOpenChange,
  paiId,
  paiNome,
  campos = ["margem", "custo_artigo", "preco_compra"],
  precoVenda,
}) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !paiId) return undefined;
    let cancelled = false;
    setLoading(true);
    api.get(`/artigos/${paiId}/variantes`)
      .then((d) => {
        if (cancelled) return;
        const list = (d.variantes || []).filter((v) => v.ativo !== false);
        setRows(list);
        setSelected(new Set(list.map((v) => v.id)));
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          toast.error("Não foi possível carregar as variantes");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, paiId]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allIds = rows.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const aplicar = async () => {
    const ids = [...selected];
    if (!ids.length) {
      toast.error("Seleccione pelo menos uma variante");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post(`/artigos/${paiId}/propagar-preco`, {
        variante_ids: ids,
        campos,
      });
      toast.success(
        res.actualizados === 1
          ? "Preço actualizado em 1 variante"
          : `Preço actualizado em ${res.actualizados} variantes`,
      );
      onOpenChange?.(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao propagar preço");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg sm:rounded-sm" data-testid="propaga-preco-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Actualizar preço nas variantes?</DialogTitle>
          <DialogDescription>
            Alterou o preço{precoVenda != null ? ` (${eur(precoVenda)})` : ""} de «{paiNome || "artigo"}».
            Quer aplicar a mesma margem/custo às variantes?
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-auto border border-gray-200 rounded-sm">
          {loading ? (
            <p className="text-sm text-gray-400 px-3 py-4 text-center">A carregar…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400 px-3 py-4 text-center">Sem variantes activas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      data-testid="propaga-preco-all"
                      checked={allSelected}
                      onChange={() => {
                        setSelected(allSelected ? new Set() : new Set(allIds));
                      }}
                      className="w-4 h-4 accent-black"
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Variante</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço actual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-b border-gray-100 last:border-0" data-testid={`propaga-preco-row-${v.id}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(v.id)}
                        onChange={() => toggle(v.id)}
                        className="w-4 h-4 accent-black"
                        data-testid={`propaga-preco-check-${v.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{v.variante_label || v.nome}</div>
                      {v.codigo && <div className="text-xs text-gray-400 mono">{v.codigo}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{eur(v.preco_venda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            data-testid="propaga-preco-nao"
            disabled={busy}
            onClick={() => onOpenChange?.(false)}
            className="border border-gray-300 rounded-sm px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Não alterar variantes
          </button>
          <button
            type="button"
            data-testid="propaga-preco-sim"
            disabled={busy || loading || selected.size === 0}
            onClick={aplicar}
            className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "A aplicar…" : `Aplicar a ${selected.size || 0}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
