import { useEffect, useState } from "react";
import { Mail, ChevronDown, CalendarClock, PackageCheck } from "lucide-react";
import { api, fmtDate, eur } from "@/lib/api";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const VARIANTS = {
  orcamento: {
    path: (id) => `/orcamentos/${id}/enviar-email`,
    label: "Enviar orçamento",
    title: "Enviar orçamento por email",
    description: "O cliente recebe o orçamento em PDF anexo.",
  },
  "encomenda-pronta": {
    path: (id) => `/encomendas/${id}/enviar-email-pronta`,
    label: "Encomenda pronta",
    title: "Notificar encomenda pronta",
    description: "O cliente recebe um email a informar que a encomenda está pronta, com os valores a faturar e PDF anexo.",
  },
  "encomenda-prazo": {
    path: (id) => `/encomendas/${id}/enviar-email-prazo`,
    label: "Data de entrega prevista",
    title: "Notificar data de entrega prevista",
    description: "O cliente recebe a data de entrega prevista, os valores a faturar e o PDF da encomenda.",
  },
};

function EmailDialog({
  open,
  onOpenChange,
  variant,
  recordId,
  defaultTo,
  clienteNome,
  prazoEntrega,
  valorTotal,
  valorPago,
  valorPendente,
  onSent,
}) {
  const meta = VARIANTS[variant];
  const [to, setTo] = useState(defaultTo || "");
  const [mensagem, setMensagem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTo(defaultTo || "");
      setMensagem("");
    }
  }, [open, defaultTo]);

  const send = async () => {
    if (!to.trim() || !to.includes("@")) {
      return toast.error("Indique um email válido");
    }
    setBusy(true);
    try {
      const res = await api.post(meta.path(recordId), { to: to.trim(), mensagem: mensagem.trim() });
      toast.success(res.message || "Email enviado");
      onOpenChange(false);
      onSent?.(res);
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível enviar o email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {clienteNome && (
            <p className="text-sm text-gray-600">
              Cliente: <span className="font-medium text-gray-900">{clienteNome}</span>
            </p>
          )}
          {variant === "encomenda-prazo" && prazoEntrega && (
            <p className="text-sm text-gray-600" data-testid="enviar-email-prazo-valor">
              Data prevista: <span className="font-medium text-gray-900">{fmtDate(prazoEntrega)}</span>
            </p>
          )}
          {variant?.startsWith("encomenda") && (
            <div className="border border-gray-200 rounded-sm px-3 py-2.5 bg-gray-50" data-testid="enviar-email-valores">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5">Valores a faturar</div>
              <div className="space-y-0.5 text-sm">
                <div className="flex justify-between gap-3"><span className="text-gray-600">Total</span><span className="tabular-nums font-medium text-gray-900">{eur(valorTotal)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-600">Já pago</span><span className="tabular-nums text-gray-900">{eur(valorPago)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-600">A faturar</span><span className="tabular-nums font-medium text-gray-900">{eur(valorPendente)}</span></div>
              </div>
            </div>
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
            onClick={() => onOpenChange(false)}
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
  );
}

/**
 * Enviar documento por email ao cliente.
 * variant: "orcamento" | "encomenda" | "encomenda-pronta" | "encomenda-prazo"
 */
export default function EnviarEmailButton({
  variant,
  recordId,
  defaultTo = "",
  clienteNome = "",
  prazoEntrega = "",
  valorTotal,
  valorPago,
  valorPendente,
  disabled = false,
  onSent,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogVariant, setDialogVariant] = useState(variant === "encomenda" ? null : variant);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openKind = (kind) => {
    if (kind === "encomenda-prazo" && !prazoEntrega) {
      return toast.error("Defina a data de entrega prevista na encomenda antes de notificar.");
    }
    setDialogVariant(kind);
    setDialogOpen(true);
  };

  const onDialogOpenChange = (open) => {
    setDialogOpen(open);
    if (!open && variant === "encomenda") setDialogVariant(null);
  };

  if (variant === "encomenda") {
    return (
      <>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="enviar-email-encomenda-btn"
              disabled={disabled}
              className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-60"
            >
              <Mail size={16} /> Notificar <ChevronDown size={14} className="text-gray-400" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-1.5 w-64" align="end">
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">
              Notificar cliente
            </div>
            <button
              type="button"
              data-testid="notificar-prazo-btn"
              onClick={() => { setMenuOpen(false); openKind("encomenda-prazo"); }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-sm text-sm text-gray-700 hover:bg-gray-100 text-left"
            >
              <CalendarClock size={15} className="text-gray-400 shrink-0" />
              <span>
                Data de entrega prevista
                {prazoEntrega ? (
                  <span className="block text-[11px] text-gray-400 font-normal">{fmtDate(prazoEntrega)}</span>
                ) : (
                  <span className="block text-[11px] text-amber-600 font-normal">Sem data definida</span>
                )}
              </span>
            </button>
            <button
              type="button"
              data-testid="notificar-pronta-btn"
              onClick={() => { setMenuOpen(false); openKind("encomenda-pronta"); }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-sm text-sm text-gray-700 hover:bg-gray-100 text-left"
            >
              <PackageCheck size={15} className="text-gray-400 shrink-0" /> Encomenda pronta
            </button>
          </PopoverContent>
        </Popover>
        {dialogVariant && (
          <EmailDialog
            open={dialogOpen}
            onOpenChange={onDialogOpenChange}
            variant={dialogVariant}
            recordId={recordId}
            defaultTo={defaultTo}
            clienteNome={clienteNome}
            prazoEntrega={prazoEntrega}
            valorTotal={valorTotal}
            valorPago={valorPago}
            valorPendente={valorPendente}
            onSent={onSent}
          />
        )}
      </>
    );
  }

  const meta = VARIANTS[variant] || VARIANTS.orcamento;
  return (
    <>
      <button
        type="button"
        data-testid={`enviar-email-${variant}-btn`}
        disabled={disabled}
        onClick={() => { setDialogVariant(variant); setDialogOpen(true); }}
        className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-60"
      >
        <Mail size={16} /> {meta.label}
      </button>
      {dialogVariant && (
        <EmailDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          variant={dialogVariant}
          recordId={recordId}
          defaultTo={defaultTo}
          clienteNome={clienteNome}
          prazoEntrega={prazoEntrega}
          valorTotal={valorTotal}
          valorPago={valorPago}
          valorPendente={valorPendente}
          onSent={onSent}
        />
      )}
    </>
  );
}
