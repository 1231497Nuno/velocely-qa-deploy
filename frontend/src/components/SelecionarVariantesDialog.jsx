import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Popup para escolher uma ou mais variantes de um artigo pai + quantidade.
 * onConfirm([{ id, codigo, nome, variante_label, quantidade }])
 */
export default function SelecionarVariantesDialog({
  open,
  onOpenChange,
  paiId,
  paiNome = "",
  onConfirm,
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState({}); // id -> { checked, qtd }

  useEffect(() => {
    if (!open || !paiId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const d = await api.get(`/artigos/${paiId}/variantes`);
        if (cancelled) return;
        const list = (d.variantes || []).filter((v) => v.ativo !== false);
        setRows(list);
        const init = {};
        for (const v of list) {
          init[v.id] = { checked: false, qtd: 1 };
        }
        setSel(init);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Erro a carregar variantes");
        onOpenChange?.(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, paiId, onOpenChange]);

  const toggle = (id) => {
    setSel((prev) => ({
      ...prev,
      [id]: { ...prev[id], checked: !prev[id]?.checked, qtd: prev[id]?.qtd || 1 },
    }));
  };

  const setQtd = (id, qtd) => {
    const n = Math.max(0, Number(qtd) || 0);
    setSel((prev) => ({
      ...prev,
      [id]: { ...prev[id], checked: n > 0 ? true : !!prev[id]?.checked, qtd: n },
    }));
  };

  const confirm = () => {
    const picked = rows
      .filter((v) => sel[v.id]?.checked && (Number(sel[v.id]?.qtd) || 0) > 0)
      .map((v) => ({
        id: v.id,
        codigo: v.codigo || "",
        nome: v.nome || "",
        variante_label: v.variante_label || "",
        quantidade: Number(sel[v.id].qtd) || 1,
        unidade: v.unidade || "un",
        preco_venda: v.preco_venda,
        imagem: v.imagem || "",
      }));
    if (!picked.length) {
      toast.error("Selecione pelo menos uma variante com quantidade");
      return;
    }
    onConfirm?.(picked);
    onOpenChange?.(false);
  };

  const selectedCount = rows.filter((v) => sel[v.id]?.checked).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="selecionar-variantes-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Escolher variantes</DialogTitle>
          <DialogDescription>
            {paiNome
              ? `Artigo «${paiNome}» — selecione uma ou mais variantes e a quantidade.`
              : "Selecione uma ou mais variantes e a quantidade."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto border border-gray-200 rounded-sm">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">A carregar…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Este artigo ainda não tem variantes.
            </div>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 w-10" />
                  <th className="px-3 py-2">Variante</th>
                  <th className="px-3 py-2 w-20">Cód.</th>
                  <th className="px-3 py-2 w-24 text-right">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const s = sel[v.id] || { checked: false, qtd: 1 };
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-gray-50 last:border-0 ${s.checked ? "bg-teal-50/40" : ""}`}
                      data-testid={`variante-pick-row-${v.id}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!!s.checked}
                          onChange={() => toggle(v.id)}
                          className="h-4 w-4 rounded border-gray-300"
                          data-testid={`variante-pick-check-${v.id}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{v.variante_label || v.nome}</div>
                        {v.variante_label && v.nome && v.nome !== v.variante_label && (
                          <div className="text-xs text-gray-400 truncate">{v.nome}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-xs text-gray-500">{v.codigo}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={s.qtd}
                          onChange={(e) => setQtd(v.id, e.target.value)}
                          onFocus={() => {
                            if (!s.checked) toggle(v.id);
                          }}
                          className="w-20 border border-gray-300 rounded-sm px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20"
                          data-testid={`variante-pick-qtd-${v.id}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            className="rounded-sm border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={loading || selectedCount === 0}
            className="rounded-sm bg-black text-white px-3 py-1.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            data-testid="variante-pick-confirm"
          >
            Adicionar{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Artigos de selector: só pais (esconde variantes filhas). */
export function artigosParaSelector(artigos = []) {
  return (artigos || []).filter((a) => !a.pai_id);
}

/** True se o artigo lite/pai tem variantes a escolher. */
export function artigoTemVariantes(a) {
  return !!(a && a.tem_variantes && !a.pai_id);
}
