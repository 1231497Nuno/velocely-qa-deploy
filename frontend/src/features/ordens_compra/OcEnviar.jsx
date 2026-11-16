import { useEffect, useState } from "react";
import { API, api } from "@/lib/api";
import { openAuthenticated } from "@/lib/openAuthenticated";
import { toast } from "sonner";
import { FileText, Send, Bot, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const erro = (e, f) => toast.error(e?.response?.data?.detail || e?.message || f);

/** Botões da OC: nota de encomenda em PDF e «Aprovar e enviar ao fornecedor». */
export function OcEnviarAcoes({ oc, podeEditar, onFeito }) {
  const [aberto, setAberto] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!oc?.id) return null;
  const pdf = () => openAuthenticated(`${API}/ordens-compra/${oc.id}/nota-encomenda.pdf`, { filename: `${oc.codigo || "OC"}.pdf` }).catch((e) => erro(e, "Não foi possível abrir o PDF"));
  const enviar = async (comEmail) => {
    setBusy(true);
    try {
      const r = await api.post(`/ordens-compra/${oc.id}/aprovar-enviar`, { enviar: comEmail, mensagem: msg });
      toast.success(comEmail ? `Nota de encomenda enviada para ${r.enviada_para}` : "Ordem de compra aprovada");
      setAberto(false);
      onFeito?.(r);
    } catch (e) { erro(e, "Não foi possível enviar"); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn btn-secundario" onClick={pdf} data-testid="oc-pdf-btn"><FileText size={15} /> Nota de encomenda</button>
      {podeEditar && (
        <button type="button" className="btn btn-secundario" onClick={() => setAberto(true)} data-testid="oc-enviar-btn">
          <Send size={15} /> {oc.enviada_fornecedor_at ? "Reenviar" : "Enviar ao fornecedor"}
        </button>
      )}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enviar {oc.codigo} ao fornecedor</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">Vai por email ao fornecedor ({oc.fornecedor_nome || "—"}) com a nota de encomenda em PDF, e a OC fica aprovada.</p>
          <label className="block text-xs font-medium text-gray-600 mt-2">Mensagem (opcional)</label>
          <textarea className="w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Ex.: precisamos até sexta-feira" />
          <DialogFooter className="gap-2">
            <button type="button" className="btn btn-secundario" disabled={busy} onClick={() => enviar(false)}>Só aprovar</button>
            <button type="button" className="btn btn-primario" disabled={busy} onClick={() => enviar(true)} data-testid="oc-enviar-confirmar">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Aprovar e enviar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Aviso no topo das OC criadas automaticamente e ainda por aprovar. */
export function OcAutomaticaBanner({ oc }) {
  if (!oc?.automatica || oc.aprovada) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="oc-auto-banner">
      <Bot size={16} className="mt-0.5 shrink-0" />
      <span>Criada automaticamente porque há artigos abaixo do nível de reabastecimento. Reveja as quantidades e use <b>Enviar ao fornecedor</b> para aprovar.</span>
    </div>
  );
}

/** Configuração das compras automáticas (separador Sugestões de compra). */
export function ComprasAutomaticasCard({ podeEditar }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/stock/compras-automaticas").then(setCfg).catch(() => setCfg({ ativo: false })); }, []);
  if (!cfg) return null;
  const mudar = async (ativo) => {
    try { setCfg(await api.put("/stock/compras-automaticas", { ativo })); toast.success(ativo ? "Compras automáticas ligadas" : "Compras automáticas desligadas"); }
    catch (e) { erro(e, "Não foi possível guardar"); }
  };
  const correr = async () => {
    setBusy(true);
    try {
      const r = await api.post("/stock/compras-automaticas/correr", {});
      toast.success(r.criadas.length ? `${r.criadas.length} OC criada(s) para aprovar: ${r.criadas.map((c) => c.codigo).join(", ")}` : "Nada a comprar (ou sem fornecedor definido nos artigos)");
    } catch (e) { erro(e, "Não foi possível criar"); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-sm px-4 py-3 mb-3 flex flex-wrap items-center gap-3" data-testid="compras-auto-card">
      <Bot size={18} className="text-gray-500" />
      <div className="flex-1 min-w-[220px]">
        <div className="font-semibold text-sm">Compras automáticas</div>
        <div className="text-xs text-gray-500">Uma vez por dia o sistema cria as OC (por fornecedor) dos artigos abaixo do nível. Ficam por aprovar e recebe um alerta; nada é enviado sem a sua aprovação.</div>
      </div>
      {podeEditar && (
        <>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => mudar(e.target.checked)} data-testid="compras-auto-toggle" /> Ligado
          </label>
          <button type="button" className="btn btn-secundario" disabled={busy} onClick={correr}>Criar agora</button>
        </>
      )}
    </div>
  );
}
