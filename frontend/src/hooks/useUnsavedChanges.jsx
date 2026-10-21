import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from "react";
import { useBlocker } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const UnsavedCtx = createContext(null);

function UnsavedChangesDialog({ open, busy, canSave, onSave, onDiscard, onCancel }) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v && !busy) onCancel(); }}>
      <AlertDialogContent data-testid="unsaved-changes-dialog" className="sm:rounded-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Alterações por guardar</AlertDialogTitle>
          <AlertDialogDescription>
            Tem alterações que ainda não foram guardadas. Quer guardá-las antes de sair, ou descartá-las?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            data-testid="unsaved-cancel-btn"
            disabled={busy}
            onClick={onCancel}
            className="border border-gray-300 rounded-sm px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Continuar a editar
          </button>
          <button
            type="button"
            data-testid="unsaved-discard-btn"
            disabled={busy}
            onClick={onDiscard}
            className="border border-red-200 text-red-700 rounded-sm px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
          >
            Descartar
          </button>
          {canSave && (
            <button
              type="button"
              data-testid="unsaved-save-btn"
              disabled={busy}
              onClick={onSave}
              className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? "A guardar…" : "Guardar"}
            </button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Provider único (dentro do Router) que bloqueia navegação e fecho do browser
 * quando algum ecrã regista alterações por guardar.
 */
export function UnsavedChangesProvider({ children }) {
  const entriesRef = useRef(new Map());
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [manualPrompt, setManualPrompt] = useState(null); // { resolve }

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const api = useMemo(() => ({
    set(id, entry) {
      entriesRef.current.set(id, entry);
      bump();
    },
    clear(id) {
      if (!entriesRef.current.has(id)) return;
      entriesRef.current.delete(id);
      bump();
    },
    isDirty() {
      for (const e of entriesRef.current.values()) {
        if (e.dirty) return true;
      }
      return false;
    },
    hasSave() {
      for (const e of entriesRef.current.values()) {
        if (e.dirty && typeof e.onSave === "function") return true;
      }
      return false;
    },
    async saveAll() {
      for (const e of [...entriesRef.current.values()]) {
        if (!e.dirty || typeof e.onSave !== "function") continue;
        const ok = await e.onSave();
        if (ok === false) return false;
      }
      return true;
    },
    /** Para mudanças internas (ex.: tabs) que não passam pelo router. */
    confirmLeave() {
      if (!api.isDirty()) return Promise.resolve(true);
      return new Promise((resolve) => {
        setManualPrompt({ resolve });
      });
    },
  }), [bump]);

  // eslint-disable-next-line no-unused-vars -- version força re-render quando o registo muda
  const dirty = version >= 0 && api.isDirty();
  const canSave = api.hasSave();

  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const closeManual = (ok) => {
    const p = manualPrompt;
    setManualPrompt(null);
    p?.resolve(!!ok);
  };

  const handleCancel = () => {
    if (busy) return;
    if (manualPrompt) closeManual(false);
    else if (blocker.state === "blocked") blocker.reset();
  };

  const handleDiscard = () => {
    if (busy) return;
    if (manualPrompt) closeManual(true);
    else if (blocker.state === "blocked") blocker.proceed();
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await api.saveAll();
      if (!ok) {
        if (manualPrompt) closeManual(false);
        else if (blocker.state === "blocked") blocker.reset();
        return;
      }
      if (manualPrompt) closeManual(true);
      else if (blocker.state === "blocked") blocker.proceed();
    } catch {
      if (manualPrompt) closeManual(false);
      else if (blocker.state === "blocked") blocker.reset();
    } finally {
      setBusy(false);
    }
  };

  const open = !!manualPrompt || blocker.state === "blocked";

  return (
    <UnsavedCtx.Provider value={api}>
      {children}
      <UnsavedChangesDialog
        open={open}
        busy={busy}
        canSave={canSave}
        onSave={handleSave}
        onDiscard={handleDiscard}
        onCancel={handleCancel}
      />
    </UnsavedCtx.Provider>
  );
}

/**
 * Regista o estado dirty desta página/formulário no provider global.
 * @param {{ dirty: boolean, onSave?: () => Promise<boolean|void>|boolean|void, enabled?: boolean }} opts
 * onSave deve devolver false (ou lançar) se a gravação falhar — a navegação fica bloqueada.
 */
export function useUnsavedChanges({ dirty, onSave, enabled = true } = {}) {
  const ctx = useContext(UnsavedCtx);
  const autoId = useId();
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!ctx || !enabled) return undefined;
    const entry = {
      dirty: !!dirty,
      onSave: onSaveRef.current
        ? async () => onSaveRef.current()
        : undefined,
    };
    ctx.set(autoId, entry);
    return () => ctx.clear(autoId);
  }, [ctx, autoId, dirty, enabled]);
}

/** Confirma saída quando há alterações (útil para tabs internas). Devolve true se pode continuar. */
export function useConfirmLeave() {
  const ctx = useContext(UnsavedCtx);
  return useCallback(async () => {
    if (!ctx) return true;
    return ctx.confirmLeave();
  }, [ctx]);
}
