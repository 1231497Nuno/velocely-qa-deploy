import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, FileDown, Send, Truck } from "lucide-react";
import { API, api, fmtDate } from "@/lib/api";
import { openAuthenticated } from "@/lib/openAuthenticated";
import { useListas } from "@/lib/listas";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";

function Morada({ titulo, m, onChange }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-gray-600">{titulo}</div>
      <input className={inputCls} placeholder="Morada" value={m.morada || ""} onChange={(e) => onChange({ ...m, morada: e.target.value })} />
      <div className="flex gap-1.5">
        <input className={`${inputCls} w-28`} placeholder="Cód. postal" value={m.codigo_postal || ""} onChange={(e) => onChange({ ...m, codigo_postal: e.target.value })} />
        <input className={inputCls} placeholder="Localidade" value={m.cidade || ""} onChange={(e) => onChange({ ...m, cidade: e.target.value })} />
      </div>
    </div>
  );
}

/** Guias de remessa/transporte da encomenda: entregas parciais, locais de carga/descarga, PDF. */
export default function GuiaDialog({ open, encomenda, onClose, onChanged }) {
  const listas = useListas();
  const [pv, setPv] = useState(null);
  const [f, setF] = useState(null);
  const [qtd, setQtd] = useState({});
  const [busy, setBusy] = useState(false);

  const carregar = async () => {
    const r = await api.get(`/encomendas/${encomenda.id}/guias/previsao`);
    setPv(r);
    setF({ tipo: "transporte", data: new Date().toISOString().slice(0, 10), hora_inicio: "", carga: r.carga, descarga: r.descarga,
           matricula: "", transportadora: "", notas: "", marcar_entregue: true });
    setQtd(Object.fromEntries(r.linhas.map((l) => [l.encomenda_artigo_id, l.disponivel])));
  };
  useEffect(() => { if (open) carregar().catch(() => toast.error("Não foi possível carregar")); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const criar = async (emitir) => {
    setBusy(true);
    try {
      const g = await api.post(`/encomendas/${encomenda.id}/guias`, {
        ...f, emitir, linhas: pv.linhas.map((l) => ({ encomenda_artigo_id: l.encomenda_artigo_id, quantidade: Number(qtd[l.encomenda_artigo_id]) || 0 })),
      });
      toast.success(emitir ? `Guia ${g.numero} emitida` : "Guia guardada em rascunho");
      if (g.faturacao?.aviso) toast.message(g.faturacao.aviso);
      if (emitir) openAuthenticated(`${API}/guias/${g.id}/pdf`).catch(() => {});
      await carregar();
      onChanged?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível criar a guia");
    } finally {
      setBusy(false);
    }
  };
  const acao = async (g, a) => {
    try {
      await api.post(`/guias/${g.id}/${a}`);
      toast.success(a === "emitir" ? "Guia emitida" : "Guia anulada");
      await carregar();
      onChanged?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível");
    }
  };

  const falta = (pv?.linhas || []).some((l) => l.disponivel > 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="guia-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Truck size={18} /> Guias — {encomenda.numero}</DialogTitle>
          <DialogDescription>Para enviar tudo ou parte da encomenda. Com o Moloni ligado, a guia de transporte é emitida lá (com código AT); sem programa ligado é uma guia interna.</DialogDescription>
        </DialogHeader>
        {!pv || !f ? <div className="text-sm text-gray-500">A carregar...</div> : (
          <div className="space-y-4">
            {pv.guias.length > 0 && (
              <div className="border border-gray-200 rounded-sm divide-y divide-gray-100">
                {pv.guias.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="mono font-medium">{g.numero || "Rascunho"}</span>
                    <span className="text-gray-500">{fmtDate(g.data)}</span>
                    <span className={`text-[11px] rounded-full px-2 py-0.5 border ${g.estado === "emitida" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : g.estado === "anulada" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{g.estado}</span>
                    <div className="ml-auto flex gap-1">
                      {g.estado === "rascunho" && <button type="button" onClick={() => acao(g, "emitir")} className="btn btn-primario btn-sm"><Send size={13} /> Emitir</button>}
                      {g.estado !== "anulada" && <button type="button" onClick={() => openAuthenticated(`${API}/guias/${g.id}/pdf`).catch((e) => toast.error(e.message))} className="btn btn-secundario btn-sm"><FileDown size={13} /> PDF</button>}
                      {g.estado !== "anulada" && <button type="button" onClick={() => acao(g, "anular")} className="btn btn-secundario btn-sm" title="Anular"><Ban size={13} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {falta ? (
              <>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500 border-b border-gray-200"><th className="text-left py-1.5">Artigo</th><th className="text-right">Encomendado</th><th className="text-right">Já enviado</th><th className="text-right w-28">Enviar agora</th></tr></thead>
                  <tbody>
                    {pv.linhas.map((l) => (
                      <tr key={l.encomenda_artigo_id} className="border-b border-gray-100">
                        <td className="py-1.5">{l.descricao}</td>
                        <td className="text-right tabular-nums">{l.encomendado}</td>
                        <td className="text-right tabular-nums text-gray-500">{l.ja_enviado}</td>
                        <td className="text-right"><input type="number" min="0" max={l.disponivel} step="any" disabled={l.disponivel <= 0} className={`${inputCls} text-right tabular-nums`} value={qtd[l.encomenda_artigo_id] ?? 0} onChange={(e) => setQtd({ ...qtd, [l.encomenda_artigo_id]: e.target.value })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <label className="text-xs text-gray-600">Tipo
                    <select className={`${inputCls} mt-1`} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                      <option value="transporte">Guia de transporte</option><option value="remessa">Guia de remessa</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">Data<input type="date" className={`${inputCls} mt-1`} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
                  <label className="text-xs text-gray-600">Hora de início<input type="time" className={`${inputCls} mt-1`} value={f.hora_inicio} onChange={(e) => setF({ ...f, hora_inicio: e.target.value })} /></label>
                  <label className="text-xs text-gray-600">Matrícula<input className={`${inputCls} mt-1`} value={f.matricula} onChange={(e) => setF({ ...f, matricula: e.target.value })} placeholder="AA-00-BB" /></label>
                  <label className="text-xs text-gray-600 sm:col-span-2">Transportadora
                    <input className={`${inputCls} mt-1`} list="lista-transportadoras-guia" value={f.transportadora} onChange={(e) => setF({ ...f, transportadora: e.target.value })} />
                    <datalist id="lista-transportadoras-guia">{(listas.transportadoras || []).map((t) => <option key={t} value={t} />)}</datalist>
                  </label>
                  <label className="text-xs text-gray-600 sm:col-span-2">Notas<input className={`${inputCls} mt-1`} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Morada titulo="Local de carga" m={f.carga} onChange={(m) => setF({ ...f, carga: m })} />
                  <Morada titulo="Local de descarga" m={f.descarga} onChange={(m) => setF({ ...f, descarga: m })} />
                </div>
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.marcar_entregue} onChange={(e) => setF({ ...f, marcar_entregue: e.target.checked })} /> Marcar a encomenda como entregue quando tudo estiver enviado</label>
              </>
            ) : <p className="text-sm text-emerald-700">Tudo o que foi encomendado já tem guia.</p>}
          </div>
        )}
        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-secundario">Fechar</button>
          {falta && f && (
            <>
              <button type="button" disabled={busy} onClick={() => criar(false)} className="btn btn-secundario">Guardar rascunho</button>
              <button type="button" disabled={busy} onClick={() => criar(true)} className="btn btn-primario" data-testid="guia-emitir"><Send size={15} /> Emitir guia</button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
