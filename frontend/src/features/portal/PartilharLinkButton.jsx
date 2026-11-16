import { useState } from "react";
import { toast } from "sonner";
import { Copy, CreditCard, Link2, Mail, MessageCircle, Smartphone } from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const soDigitos = (t) => (t || "").replace(/\D/g, "");
function waLink(telefone, texto) {
  let n = soDigitos(telefone);
  if (n.length === 9) n = `351${n}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

/** Botão «Link do cliente»: gera o link público e permite enviá-lo (copiar, WhatsApp, email). Encomendas: referências MB. */
export default function PartilharLinkButton({ tipo, doc, telefone = "", email = "" }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState([]);
  const [tel, setTel] = useState("");
  const url = link ? `${window.location.origin}${link.caminho}` : "";
  const enc = tipo === "encomenda";

  const abrir = async () => {
    setOpen(true);
    setBusy(true);
    try {
      setLink(await api.post("/portal/links", { tipo, id: doc.id }));
      if (enc) setRefs(await api.get(`/encomendas/${doc.id}/pagamentos-online`).catch(() => []));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível criar o link");
      setOpen(false);
    } finally { setBusy(false); }
  };
  const gerar = async (metodo) => {
    setBusy(true);
    try {
      await api.post(`/encomendas/${doc.id}/pagamentos-online`, { metodo, telemovel: tel });
      toast.success(metodo === "mbway" ? "Pedido MB WAY enviado ao telemóvel do cliente" : "Referência Multibanco criada");
      setRefs(await api.get(`/encomendas/${doc.id}/pagamentos-online`));
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível criar o pagamento"); } finally { setBusy(false); }
  };
  const textoBase = enc
    ? (doc.estado === "concluida"
      ? `Olá! A sua encomenda ${doc.numero} está pronta. Pode ver os detalhes aqui: ${url}`
      : `Olá! Pode acompanhar a sua encomenda ${doc.numero} (e pagar online) aqui: ${url}`)
    : `Olá! Segue o orçamento ${doc.numero}. Pode ver, aprovar a maqueta e aceitar aqui: ${url}`;
  const copiar = async (t) => {
    try { await navigator.clipboard.writeText(t); toast.success("Copiado"); } catch { toast.error("Não foi possível copiar"); }
  };

  return (
    <>
      <button type="button" className="btn btn-secundario" onClick={abrir} disabled={!doc?.numero} title="Link para o cliente ver, aprovar e pagar" data-testid={`${tipo}-link-cliente`}>
        <Link2 size={15} /> Link do cliente
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link do cliente — {doc?.numero}</DialogTitle>
            <DialogDescription>
              {enc ? "O cliente vê o estado, o que falta pagar e pode pagar por Multibanco/MB WAY." : "O cliente vê o orçamento, descarrega o PDF, aprova as maquetas e aceita ou recusa."} Não precisa de conta.
            </DialogDescription>
          </DialogHeader>
          {link && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input readOnly className="flex-1 border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-gray-50" value={url} data-testid="link-cliente-url" />
                <button type="button" className="btn btn-secundario" onClick={() => copiar(url)}><Copy size={15} /></button>
              </div>
              <div className="text-xs text-gray-500">Válido até {fmtDate(link.expira)} · {link.visto_at ? `aberto pelo cliente em ${fmtDate(link.visto_at)}` : "ainda não aberto"}</div>
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-secundario" href={waLink(telefone, textoBase)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
                {email && <a className="btn btn-secundario" href={`mailto:${email}?subject=${encodeURIComponent(`${enc ? "Encomenda" : "Orçamento"} ${doc.numero}`)}&body=${encodeURIComponent(textoBase)}`}><Mail size={15} /> Email</a>}
                <button type="button" className="btn btn-secundario" onClick={() => copiar(textoBase)}><Copy size={15} /> Copiar mensagem</button>
              </div>
              {enc && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div className="text-sm font-medium flex items-center gap-1.5"><CreditCard size={15} /> Pagamento online</div>
                  {refs.map((r) => (
                    <div key={r.id} className="text-xs text-gray-700 flex justify-between gap-2 border border-gray-200 rounded-sm px-2 py-1.5">
                      <span>{r.metodo === "multibanco" ? `MB Ent. ${r.entidade} Ref. ${r.referencia}` : `MB WAY ${r.telemovel || ""}`}</span>
                      <span>{eur(r.valor)} · {r.estado === "pago" ? "pago" : "pendente"}</span>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-secundario" disabled={busy} onClick={() => gerar("multibanco")}>Gerar referência MB</button>
                    <input className="border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm w-36" placeholder="Telemóvel" value={tel} onChange={(e) => setTel(e.target.value)} />
                    <button type="button" className="btn btn-secundario" disabled={busy} onClick={() => gerar("mbway")}><Smartphone size={15} /> Pedir MB WAY</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter><button type="button" className="btn btn-primario" onClick={() => setOpen(false)}>Fechar</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
