import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ConfirmCtx = createContext(null);

/**
 * Pede confirmação com o diálogo da aplicação (nunca window.confirm).
 * @param {{ title?: string, description?: string, confirmLabel?: string, cancelLabel?: string, tone?: "default"|"danger" }} options
 * @returns {Promise<boolean>}
 */
export function useConfirm() {
  const confirm = useContext(ConfirmCtx);
  if (!confirm) {
    throw new Error("useConfirm tem de estar dentro de ConfirmProvider");
  }
  return confirm;
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const finish = useCallback((value) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback((options = {}) => {
    if (resolveRef.current) resolveRef.current(false);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        title: options.title || "Confirmar",
        description: options.description || "",
        confirmLabel: options.confirmLabel || "Confirmar",
        cancelLabel: options.cancelLabel || "Cancelar",
        tone: options.tone === "danger" ? "danger" : "default",
      });
    });
  }, []);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AlertDialog open={!!state} onOpenChange={(open) => { if (!open) finish(false); }}>
        <AlertDialogContent data-testid="app-confirm-dialog" className="sm:rounded-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title}</AlertDialogTitle>
            {state?.description ? (
              <AlertDialogDescription className="whitespace-pre-line text-gray-600">
                {state.description}
              </AlertDialogDescription>
            ) : (
              <AlertDialogDescription className="sr-only">Confirmação</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              data-testid="app-confirm-cancel"
              onClick={() => finish(false)}
              className="border border-gray-300 rounded-sm px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              {state?.cancelLabel || "Cancelar"}
            </button>
            <button
              type="button"
              data-testid="app-confirm-ok"
              onClick={() => finish(true)}
              className={
                state?.tone === "danger"
                  ? "bg-red-600 text-white rounded-sm px-4 py-2 text-sm font-medium hover:bg-red-700"
                  : "bg-brand text-brand-fg rounded-sm px-4 py-2 text-sm font-medium hover:bg-brand-hover"
              }
            >
              {state?.confirmLabel || "Confirmar"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmCtx.Provider>
  );
}
