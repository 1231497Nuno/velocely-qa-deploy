import { useEffect, useState } from "react";
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

export const NC_TIPOS = [
  { id: "defeito", label: "Defeito" },
  { id: "quantidade", label: "Quantidade" },
  { id: "material", label: "Material" },
  { id: "prazo", label: "Prazo" },
  { id: "outro", label: "Outro" },
];

export default function AbrirNaoConformidadeDialog({
  open,
  onOpenChange,
  encomendaId,
  linha,
  artigoCodigo,
  onCreated,
}) {
  const [tipo, setTipo] = useState("defeito");
  const [quantidade, setQuantidade] = useState("");
  const [descricao, setDescricao] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTipo("defeito");
      setQuantidade(linha?.quantidade ? String(linha.quantidade) : "1");
      setDescricao("");
    }
  }, [open, linha]);

  const refLabel = [artigoCodigo, linha?.artigo_nome].filter(Boolean).join(" · ") || "Referência";

  const submit = async () => {
    if (!descricao.trim()) return toast.error("Descreva a não conformidade");
    setBusy(true);
    try {
      const nc = await api.post(`/encomendas/${encomendaId}/nao-conformidades`, {
        encomenda_artigo_id: linha?.id,
        artigo_id: linha?.artigo_id,
        artigo_nome: linha?.artigo_nome || "",
        artigo_codigo: artigoCodigo || "",
        quantidade: Number(quantidade) || 0,
        tipo,
        descricao: descricao.trim(),
      });
      toast.success(`Não conformidade ${nc.numero} aberta`);
      onOpenChange(false);
      onCreated?.(nc);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível abrir a NC");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Abrir não conformidade</DialogTitle>
          <DialogDescription>
            Só sobre material já entregue ao cliente, nesta referência da encomenda.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-gray-700" data-testid="nc-dialog-ref">
            Referência: <span className="font-medium text-gray-900">{refLabel}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Tipo</label>
              <select
                data-testid="nc-dialog-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20"
              >
                {NC_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Quantidade</label>
              <input
                data-testid="nc-dialog-qtd"
                type="number"
                min="0"
                step="0.01"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
            <textarea
              data-testid="nc-dialog-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={4}
              placeholder="O que está em não conformidade…"
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
            data-testid="nc-dialog-confirm"
            disabled={busy}
            onClick={submit}
            className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {busy ? "A abrir..." : "Abrir NC"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
