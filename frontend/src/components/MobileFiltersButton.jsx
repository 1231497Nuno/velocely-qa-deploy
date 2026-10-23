import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import useMediaQuery from "@/hooks/useMediaQuery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Em desktop (≥ md): filtros inline.
 * Em mobile: botão "Filtros" que abre um popup para escolher.
 *
 * children pode ser um nó React ou uma função ({ mobile }) => nó
 * para ajustar layout (ex.: className w-full no popup).
 */
export default function MobileFiltersButton({
  children,
  activeCount = 0,
  onClear,
  title = "Filtros",
  description = "Escolhe os filtros a aplicar à lista.",
  testid = "mobile-filters",
  applyLabel = "Ver resultados",
}) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const count = Number(activeCount) || 0;

  const renderFilters = (mobile) =>
    typeof children === "function" ? children({ mobile }) : children;

  if (isDesktop) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={`${testid}-desktop`}>
        {renderFilters(false)}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2" data-testid={`${testid}-mobile`}>
        <button
          type="button"
          data-testid={`${testid}-btn`}
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-sm font-medium rounded-sm border min-h-[var(--touch)] transition-colors ${
            count > 0
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          <SlidersHorizontal size={15} />
          Filtros
          {count > 0 && (
            <span
              data-testid={`${testid}-count`}
              className="text-[11px] font-bold tabular-nums rounded-full min-w-[1.25rem] text-center px-1.5 py-0.5 bg-white/20"
            >
              {count}
            </span>
          )}
        </button>
        {count > 0 && onClear && (
          <button
            type="button"
            data-testid={`${testid}-clear-inline`}
            onClick={onClear}
            className="inline-flex items-center gap-1 px-2 py-2 text-sm text-gray-600 border border-gray-300 rounded-sm hover:bg-gray-50 min-h-[var(--touch)]"
          >
            <X size={14} /> Limpar
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid={`${testid}-dialog`}>
          <DialogHeader>
            <DialogTitle className="font-display">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3" data-testid={`${testid}-fields`}>
            {renderFilters(true)}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            {onClear && (
              <button
                type="button"
                data-testid={`${testid}-clear`}
                onClick={onClear}
                disabled={count <= 0}
                className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2.5 text-sm font-medium disabled:opacity-40 min-h-11"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              data-testid={`${testid}-apply`}
              onClick={() => setOpen(false)}
              className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2.5 text-sm font-medium min-h-11"
            >
              {applyLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
