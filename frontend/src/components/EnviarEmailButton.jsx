import { useState } from "react";
import { Mail } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Enviar documento por email ao cliente.
 * variant: "orcamento" | "encomenda-pronta"
 */
export default function EnviarEmailButton({
  variant,
  recordId,
  defaultTo = "",
  clienteNome = "",
  disabled = false,
  onSent,
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo || "");
  const [mensagem, setMensagem] = useState("");
  const [busy, setBusy] = useState(false);

  const isOrc = variant === "orcamento";
  const label = isOrc ? "Enviar orçamento" : "Notificar pronta";
  const title = isOrc ? "Enviar orçamento por email" : "Notificar encomenda pronta";
  const description = isOrc
    ? "O cliente recebe o orçamento em PDF anexo."
    : "O cliente recebe um email a informar que a encomenda está pronta, com PDF anexo.";

  const openDialog = () => {
    setTo(defaultTo || "");
    setMensagem("");
    setOpen(true);
  };

  const send = async () => {
    if (!to.trim() || !to.includes("@")) {
      return toast.error("Indique um email válido");
    }
    setBusy(true);
    try {
      const path = isOrc
        ? `/orcamentos/${recordId}/enviar-email`
        : `/encomendas/${recordId}/enviar-email-pronta`;
      const res = await api.post(path, { to: to.trim(), mensagem: mensagem.trim() });
      toast.success(res.message || "Email enviado");
      setOpen(false);
      onSent?.(res);
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível enviar o email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid={`enviar-email-${variant}-btn`}
        disabled={disabled || busy}
        onClick={openDialog}
        className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-60"
      >
        <Mail size={16} /> {label}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {clienteNome && (
              <p className="text-sm text-gray-600">
                Cliente: <span className="font-medium text-gray-900">{clienteNome}</span>
              </p>
            )}
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">
                Destinatário
              </label>
              <input
                data-testid="enviar-email-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="cliente@email.com"
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">
                Mensagem (opcional)
              </label>
              <textarea
                data-testid="enviar-email-mensagem"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={3}
                placeholder="Nota adicional para o cliente…"
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black resize-y"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="enviar-email-confirm"
              disabled={busy}
              onClick={send}
              className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {busy ? "A enviar..." : "Enviar email"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
