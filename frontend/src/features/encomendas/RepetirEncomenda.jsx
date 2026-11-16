import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Repeat } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, eur } from "@/lib/api";

/** «Repetir»: cria uma encomenda nova igual (cliente, artigos, personalização e arte), com as quantidades a ajustar. */
export default function RepetirEncomenda({ enc }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [qtd, setQtd] = useState({});
  const [busy, setBusy] = useState(false);
  const abrir = () => { setQtd(Object.fromEntries((enc.artigos || []).map((l) => [l.id, String(l.quantidade ?? 1)]))); setOpen(true); };
  const criar = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/encomendas/${enc.id}/repetir`, { quantidades: Object.fromEntries(Object.entries(qtd).map(([k, v]) => [k, Number(v) || 0])) });
      toast.success(`Encomenda ${r.numero} criada`);
      setOpen(false);
      nav(`/encomendas/${r.id}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível repetir"); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn btn-secundario" onClick={abrir} data-testid="enc-repetir"><Repeat size={15} /> Repetir</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Repetir a encomenda {enc.numero}</DialogTitle>
            <DialogDescription>Cria uma encomenda nova para {enc.cliente} com os mesmos artigos, personalização, arte e preços. Ajuste as quantidades (0 = não incluir).</DialogDescription>
          </DialogHeader>
          <ul className="divide-y border rounded-sm max-h-[50vh] overflow-y-auto">
            {(enc.artigos || []).map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0"><div className="truncate font-medium">{l.artigo_nome}</div><div className="text-xs text-gray-500">{eur(l.preco_unit)} / un{l.arte_nome ? " · com arte" : ""}</div></div>
                <input type="number" min="0" step="any" value={qtd[l.id] ?? ""} onChange={(e) => setQtd({ ...qtd, [l.id]: e.target.value })} className="w-20 border border-gray-300 rounded-sm px-2 py-1 text-right tabular-nums" />
              </li>
            ))}
          </ul>
          <DialogFooter>
            <button type="button" className="btn btn-secundario" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-primario" disabled={busy} onClick={criar} data-testid="enc-repetir-criar">{busy && <Loader2 size={15} className="animate-spin" />} Criar encomenda</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
