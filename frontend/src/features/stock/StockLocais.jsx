import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, MapPin, SlidersHorizontal } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import EntitySelect from "@/components/EntitySelect";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";
const num = (v) => (Number(v) || 0).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);

let cacheLocs = null;
export function useLocalizacoes() {
  const [l, setL] = useState(cacheLocs || []);
  const recarregar = useCallback(() => api.get("/stock/localizacoes").then((r) => { cacheLocs = r; setL(r); }).catch(() => {}), []);
  useEffect(() => { if (!cacheLocs) recarregar(); }, [recarregar]);
  return [l, recarregar];
}
export function limparCacheLocalizacoes() { cacheLocs = null; }

/** Transferir stock entre localizações. */
export function TransferirDialog({ artigo, porLocal = [], onClose, onSaved }) {
  const [locs] = useLocalizacoes();
  const [f, setF] = useState({ de: porLocal[0]?.id || porLocal[0]?.localizacao_id || "", para: "", quantidade: "", nota: "" });
  const [busy, setBusy] = useState(false);
  const origem = porLocal.map((p) => ({ id: p.id || p.localizacao_id, nome: `${p.nome} (${num(p.quantidade)})` }));
  const gravar = async () => {
    setBusy(true);
    try { await api.post("/stock/transferir", { artigo_id: artigo.id, ...f, quantidade: Number(f.quantidade) || 0 }); toast.success("Stock transferido"); onSaved(); }
    catch (e) { erro(e, "Não foi possível transferir"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Transferir stock</DialogTitle><DialogDescription>{artigo.nome}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="text-xs text-gray-600 block">De<EntitySelect items={origem} value={f.de} onChange={(id) => setF({ ...f, de: id })} placeholder="Localização de origem…" hint={() => ""} /></label>
          <label className="text-xs text-gray-600 block">Para<EntitySelect items={locs.filter((l) => l.id !== f.de && l.ativo !== false)} value={f.para} onChange={(id) => setF({ ...f, para: id })} placeholder="Localização de destino…" testid="transf-para" /></label>
          <label className="text-xs text-gray-600 block">Quantidade ({artigo.unidade || "un"})<input type="number" min="0" step="any" className={inputCls} value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} data-testid="transf-qtd" /></label>
          <label className="text-xs text-gray-600 block">Nota<input className={inputCls} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></label>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy || !f.de || !f.para || !(Number(f.quantidade) > 0)} onClick={gravar} data-testid="transf-gravar">Transferir</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Acertar a quantidade real numa localização. */
export function AjusteLocalDialog({ artigo, porLocal = [], localInicial, onClose, onSaved }) {
  const [locs] = useLocalizacoes();
  const qtdEm = (id) => porLocal.find((p) => (p.id || p.localizacao_id) === id)?.quantidade ?? 0;
  const [loc, setLoc] = useState(localInicial || porLocal[0]?.id || porLocal[0]?.localizacao_id || "");
  const [qtd, setQtd] = useState(qtdEm(localInicial || porLocal[0]?.id || porLocal[0]?.localizacao_id));
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const gravar = async () => {
    if (!motivo.trim()) { toast.error("Indique o motivo do acerto"); return; }
    setBusy(true);
    try { await api.post("/stock/ajuste", { artigo_id: artigo.id, localizacao_id: loc, nova_quantidade: Number(qtd) || 0, motivo }); toast.success("Stock acertado"); onSaved(); }
    catch (e) { erro(e, "Não foi possível acertar"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Acertar stock</DialogTitle><DialogDescription>{artigo.nome}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="text-xs text-gray-600 block">Localização<EntitySelect items={locs} value={loc} onChange={(id) => { setLoc(id); setQtd(qtdEm(id)); }} testid="ajuste-local" /></label>
          <label className="text-xs text-gray-600 block">Quantidade real nesta localização ({artigo.unidade || "un"})<input type="number" step="any" className={inputCls} value={qtd} onChange={(e) => setQtd(e.target.value)} data-testid="ajuste-qtd" /></label>
          <label className="text-xs text-gray-600 block">Motivo<input className={inputCls} placeholder="Ex.: quebra, contagem, oferta" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="ajuste-motivo" /></label>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy || !loc} onClick={gravar} data-testid="ajuste-guardar">Acertar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TIPO_MOV = { entrada: "Entrada", ajuste: "Acerto", inventario: "Inventário", nao_conformidade: "Não conformidade", consumo: "Consumo", producao: "Produção", transferencia: "Transferência" };

/** Ficha do artigo: stock por localização, reservado/disponível, transferir, acertar e últimos movimentos. */
export function ArtigoStockLocais({ artigoId, nome, podeEditar }) {
  const [d, setD] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [locs] = useLocalizacoes();
  const carregar = useCallback(() => api.get(`/stock/artigos/${artigoId}`).then(setD).catch(() => setD(null)), [artigoId]);
  useEffect(() => { carregar(); }, [carregar]);
  if (!d || !d.gere_stock) return null;
  const artigo = { id: artigoId, nome, unidade: d.unidade };
  const porLocal = d.localizacoes.map((l) => ({ id: l.localizacao_id, nome: l.nome, quantidade: l.quantidade }));
  const mudarPadrao = async (id) => {
    try { await api.put(`/stock/artigos/${artigoId}/config`, { localizacao_id: id }); toast.success("Localização por defeito alterada"); carregar(); }
    catch (e) { erro(e, "Não foi possível guardar"); }
  };
  return (
    <div className="border-t border-gray-100 px-4 py-3 space-y-3" data-testid="artigo-stock-locais">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin size={15} className="text-gray-500" />
        <span className="text-sm font-semibold">Stock por localização</span>
        <span className="text-xs text-gray-500">Total {num(d.total)} {d.unidade} · reservado {num(d.reservado)} · disponível <b className={d.disponivel < 0 ? "text-red-700" : ""}>{num(d.disponivel)}</b></span>
        {podeEditar && (
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-secundario btn-sm" onClick={() => setDlg("transferir")} disabled={!porLocal.length} data-testid="artigo-stock-transferir"><ArrowRightLeft size={14} /> Transferir</button>
            <button type="button" className="btn btn-secundario btn-sm" onClick={() => setDlg("ajuste")} data-testid="artigo-stock-acertar"><SlidersHorizontal size={14} /> Acertar</button>
          </div>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500"><tr><th className="text-left py-1">Localização</th><th className="text-right">Quantidade</th></tr></thead>
        <tbody>
          {d.localizacoes.map((l) => (
            <tr key={l.localizacao_id} className="border-t border-gray-100">
              <td className="py-1.5">{l.nome}{l.codigo ? <span className="text-xs text-gray-400"> · {l.codigo}</span> : null}{l.localizacao_id === d.localizacao_padrao_id && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-500 border border-gray-200 rounded-sm px-1">por defeito</span>}</td>
              <td className={`text-right tabular-nums font-medium ${l.quantidade < 0 ? "text-red-700" : ""}`}>{num(l.quantidade)} {d.unidade}</td>
            </tr>
          ))}
          {!d.localizacoes.length && <tr><td colSpan={2} className="py-3 text-center text-gray-400">Sem stock</td></tr>}
        </tbody>
      </table>
      {podeEditar && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="shrink-0">Entradas vão para</span>
          <div className="w-64"><EntitySelect items={locs} value={d.localizacao_padrao_id} size="sm" onChange={(id) => mudarPadrao(id)} testid="artigo-local-padrao" /></div>
        </div>
      )}
      {d.movimentos.length > 0 && (
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer">Últimos movimentos</summary>
          <div className="text-xs divide-y divide-gray-100 mt-1">
            {d.movimentos.map((m) => (
              <div key={m.id} className="flex gap-2 py-1">
                <span className="w-20 shrink-0">{fmtDate(m.data)}</span>
                <span className="w-28 shrink-0 text-gray-600">{TIPO_MOV[m.tipo] || m.tipo}</span>
                <span className="flex-1 truncate text-gray-500">{locs.find((l) => l.id === m.localizacao_id)?.nome || ""}{m.origem?.numero ? ` · ${m.origem.numero}` : ""}{m.nota ? ` · ${m.nota}` : ""}</span>
                <span className={`tabular-nums font-medium ${m.quantidade < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.quantidade > 0 ? "+" : ""}{num(m.quantidade)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {dlg === "transferir" && <TransferirDialog artigo={artigo} porLocal={porLocal} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); carregar(); }} />}
      {dlg === "ajuste" && <AjusteLocalDialog artigo={artigo} porLocal={porLocal} localInicial={d.localizacao_padrao_id} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); carregar(); }} />}
    </div>
  );
}
