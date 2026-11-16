import { useState } from "react";
import { toast } from "sonner";
import { PackageCheck, Receipt, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import EntitySelect from "@/components/EntitySelect";
import { useLocalizacoes } from "@/features/stock/StockLocais";
import RececaoVariasOC from "./RececaoVariasOC";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";
const hoje = () => new Date().toISOString().slice(0, 10);
const erro = (e, msg) => {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : msg);
};

/** Separador «Receção e fatura» da OC: receções parciais (entram em stock) e conferência da fatura do fornecedor. */
export default function OcRececaoTab({ oc, podeEditar, onChanged }) {
  const [rec, setRec] = useState(null);
  const [ff, setFf] = useState(null);
  const [busy, setBusy] = useState(false);
  const [varias, setVarias] = useState(false);
  const [locs] = useLocalizacoes();
  const linhas = oc.linhas || [];
  const falta = (l) => Math.max(0, (Number(l.quantidade) || 0) - (Number(l.qtd_recebida) || 0));
  const tudoRecebido = linhas.length > 0 && linhas.every((l) => falta(l) <= 1e-9);
  const fat = oc.fatura_fornecedor;

  const abrirRececao = () => setRec({
    data: hoje(), guia_fornecedor: "", notas: "", aceitar_excesso: false, localizacao_id: "",
    qtd: Object.fromEntries(linhas.map((l) => [l.id, falta(l)])),
  });
  const gravarRececao = async () => {
    setBusy(true);
    try {
      await api.post(`/ordens-compra/${oc.id}/rececoes`, {
        data: rec.data, guia_fornecedor: rec.guia_fornecedor, notas: rec.notas, aceitar_excesso: rec.aceitar_excesso,
        localizacao_id: rec.localizacao_id || null,
        linhas: linhas.map((l) => ({ linha_id: l.id, quantidade: Number(rec.qtd[l.id]) || 0 })),
      });
      toast.success("Receção registada — stock atualizado");
      setRec(null);
      onChanged?.();
    } catch (e) { erro(e, "Não foi possível registar a receção"); } finally { setBusy(false); }
  };
  const gravarFatura = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/ordens-compra/${oc.id}/fatura-fornecedor`, { ...ff, total: Number(ff.total) || 0, portes: Number(ff.portes) || 0 });
      const x = r.fatura_fornecedor;
      if (x.estado === "conferida") toast.success("Fatura conferida — bate certo com o recebido");
      else toast.warning(`Fatura com diferença de ${eur(x.desvio)} face ao recebido`);
      setFf(null);
      onChanged?.();
    } catch (e) { erro(e, "Não foi possível registar a fatura"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="oc-rececao">
      <RececaoVariasOC open={varias} onOpenChange={setVarias} ocInicial={oc.id} onFeito={onChanged} />
      <div className="bg-white border border-gray-200 rounded-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div className="font-semibold text-sm">Linhas — encomendado vs recebido</div>
          {podeEditar && oc.estado !== "cancelada" && (
            <div className="flex gap-2">
              <button type="button" className="btn btn-primario" disabled={tudoRecebido} onClick={abrirRececao} data-testid="oc-btn-rececao">
                <PackageCheck size={15} /> Registar receção
              </button>
              <button type="button" className="btn btn-secundario" disabled={tudoRecebido} onClick={() => setVarias(true)} data-testid="oc-btn-rececao-varias" title="Receber esta e outras encomendas do mesmo fornecedor na mesma entrega">
                <PackageCheck size={15} /> Com outras do fornecedor
              </button>
              <button type="button" className="btn btn-secundario" onClick={() => setFf({ numero: fat?.numero || "", data: fat?.data || hoje(), total: fat?.total ?? "", portes: fat?.portes ?? 0, notas: fat?.notas || "" })} data-testid="oc-btn-fatura">
                <Receipt size={15} /> Fatura do fornecedor
              </button>
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50">
            <tr><th className="text-left px-4 py-2">Artigo</th><th className="text-right px-3">Encomendado</th><th className="text-right px-3">Recebido</th><th className="text-right px-4">Falta</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{l.artigo_nome || l.nome}</td>
                <td className="text-right px-3 tabular-nums">{Number(l.quantidade) || 0}</td>
                <td className="text-right px-3 tabular-nums">{Number(l.qtd_recebida) || 0}</td>
                <td className={`text-right px-4 tabular-nums ${falta(l) > 0 ? "text-amber-700 font-medium" : "text-emerald-700"}`}>{falta(l) > 0 ? falta(l) : "✓"}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Sem linhas</td></tr>}
          </tbody>
        </table>
      </div>

      {fat && (
        <div className={`border rounded-sm p-4 text-sm ${fat.estado === "conferida" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} data-testid="oc-fatura-estado">
          <div className="flex items-center gap-2 font-semibold">
            {fat.estado === "conferida" ? <CheckCircle2 size={16} className="text-emerald-700" /> : <AlertTriangle size={16} className="text-amber-700" />}
            Fatura {fat.numero} de {fmtDate(fat.data)} — {fat.estado === "conferida" ? "conferida" : "com diferenças"}
          </div>
          <div className="mt-1 text-gray-700">
            Total {eur(fat.total)}{fat.portes ? ` (dos quais portes ${eur(fat.portes)}, repartidos pelo custo dos artigos)` : ""} · Esperado pelo recebido {eur(fat.esperado)} · Diferença {eur(fat.desvio)}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-sm">
        <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm">Receções</div>
        {(oc.rececoes || []).length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">Ainda não houve receções</div>
        ) : (oc.rececoes || []).slice().reverse().map((r) => (
          <div key={r.id} className="px-4 py-2.5 border-t border-gray-100 text-sm">
            <div className="font-medium">{fmtDate(r.data)}{r.guia_fornecedor ? ` · Guia ${r.guia_fornecedor}` : ""} <span className="text-gray-400 font-normal">— {r.por?.nome}</span></div>
            <div className="text-gray-600">{r.linhas.map((i) => `${i.quantidade} × ${i.descricao}`).join(" · ")}</div>
            {r.notas && <div className="text-gray-500 text-xs mt-0.5">{r.notas}</div>}
          </div>
        ))}
      </div>

      <Dialog open={!!rec} onOpenChange={(o) => !o && setRec(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registar receção</DialogTitle>
            <DialogDescription>Indique o que chegou (unidade de compra). As quantidades entram em stock já convertidas.</DialogDescription>
          </DialogHeader>
          {rec && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Data</label><input type="date" className={inputCls} value={rec.data} onChange={(e) => setRec({ ...rec, data: e.target.value })} /></div>
                <div><label className="text-xs font-medium text-gray-600">Guia do fornecedor</label><input className={inputCls} value={rec.guia_fornecedor} onChange={(e) => setRec({ ...rec, guia_fornecedor: e.target.value })} /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Arrumar em</label>
                <EntitySelect items={locs} value={rec.localizacao_id} onChange={(id) => setRec({ ...rec, localizacao_id: id })} clearLabel="Localização por defeito de cada artigo" placeholder="Localização por defeito de cada artigo" testid="rec-local" /></div>
              <div className="border border-gray-200 rounded-sm divide-y divide-gray-100">
                {linhas.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0 truncate">{l.artigo_nome || l.nome}<span className="text-xs text-gray-400 ml-2">falta {falta(l)}</span></div>
                    <input type="number" min="0" step="any" className={`${inputCls} w-24 text-right`} value={rec.qtd[l.id]} data-testid={`rec-qtd-${l.id}`}
                      onChange={(e) => setRec({ ...rec, qtd: { ...rec.qtd, [l.id]: e.target.value } })} />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rec.aceitar_excesso} onChange={(e) => setRec({ ...rec, aceitar_excesso: e.target.checked })} /> Aceitar quantidades a mais do que o encomendado</label>
              <textarea className={inputCls} rows={2} placeholder="Notas (ex.: caixa danificada)" value={rec.notas} onChange={(e) => setRec({ ...rec, notas: e.target.value })} />
            </div>
          )}
          <DialogFooter>
            <button type="button" className="btn btn-secundario" onClick={() => setRec(null)}>Cancelar</button>
            <button type="button" className="btn btn-primario" disabled={busy} onClick={gravarRececao} data-testid="rec-gravar">Registar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ff} onOpenChange={(o) => !o && setFf(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fatura do fornecedor</DialogTitle>
            <DialogDescription>O total é comparado com o valor do que foi recebido. Os portes são repartidos pelo custo dos artigos.</DialogDescription>
          </DialogHeader>
          {ff && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-gray-600">Nº da fatura</label><input className={inputCls} value={ff.numero} onChange={(e) => setFf({ ...ff, numero: e.target.value })} data-testid="ff-numero" /></div>
              <div><label className="text-xs font-medium text-gray-600">Data</label><input type="date" className={inputCls} value={ff.data} onChange={(e) => setFf({ ...ff, data: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-gray-600">Total da fatura (€)</label><input type="number" step="0.01" className={inputCls} value={ff.total} onChange={(e) => setFf({ ...ff, total: e.target.value })} data-testid="ff-total" /></div>
              <div><label className="text-xs font-medium text-gray-600">Dos quais portes (€)</label><input type="number" step="0.01" className={inputCls} value={ff.portes} onChange={(e) => setFf({ ...ff, portes: e.target.value })} /></div>
              <textarea className={`${inputCls} col-span-2`} rows={2} placeholder="Notas" value={ff.notas} onChange={(e) => setFf({ ...ff, notas: e.target.value })} />
            </div>
          )}
          <DialogFooter>
            <button type="button" className="btn btn-secundario" onClick={() => setFf(null)}>Cancelar</button>
            <button type="button" className="btn btn-primario" disabled={busy} onClick={gravarFatura} data-testid="ff-gravar">Conferir e guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
