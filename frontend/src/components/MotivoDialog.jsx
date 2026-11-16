import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

/** Pede um motivo (com sugestões de uma lista de Definições → Listas). */
export default function MotivoDialog({ open, titulo, descricao, sugestoes = [], confirmar = "Confirmar", onConfirm, onClose, testid = "motivo-dialog" }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setMotivo(""); }, [open]);
  const ok = async () => {
    if (!motivo.trim()) return;
    setBusy(true);
    try { await onConfirm(motivo.trim()); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-md" data-testid={testid}>
        <DialogHeader>
          <DialogTitle className="font-display">{titulo}</DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        {sugestoes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sugestoes.map((s) => (
              <button key={s} type="button" onClick={() => setMotivo(s)}
                className={`rounded-full border px-2.5 py-1 text-xs ${motivo === s ? "border-brand bg-brand-soft" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>{s}</button>
            ))}
          </div>
        )}
        <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ok(); }}
          placeholder="Motivo" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm" data-testid={`${testid}-input`} />
        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-secundario">Cancelar</button>
          <button type="button" disabled={busy || !motivo.trim()} onClick={ok} className="btn btn-primario" data-testid={`${testid}-ok`}>{confirmar}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
