import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, fmtDate } from "@/lib/api";
import EntitySelect from "@/components/EntitySelect";
import { useLocalizacoes } from "@/features/stock/StockLocais";

const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);
const hoje = () => new Date().toISOString().slice(0, 10);
const num = (v) => Number(v || 0).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
const chaveForn = (o) => o.fornecedor_id || `nome:${o.fornecedor || ""}`;
const inputCls = "border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white";

/**
 * Receção de várias ordens de compra do mesmo fornecedor de uma só vez (uma entrega, uma guia).
 * `fornecedorInicial` / `ocInicial` vêm da ficha da OC («Receber com outras do fornecedor»).
 */
export default function RececaoVariasOC({ open, onOpenChange, fornecedorInicial = "", ocInicial = "", onFeito }) {
  const [locs] = useLocalizacoes();
  const [ocs, setOcs] = useState(null);
  const [forn, setForn] = useState("");
  const [sel, setSel] = useState({}); // oc_id → bool
  const [qtd, setQtd] = useState({}); // `${oc}|${linha}` → valor
  const [f, setF] = useState({ data: hoje(), guia_fornecedor: "", notas: "", localizacao_id: "", aceitar_excesso: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOcs(null);
    setF({ data: hoje(), guia_fornecedor: "", notas: "", localizacao_id: "", aceitar_excesso: false });
    api.get("/movel/ocs-abertas").then((r) => {
      setOcs(r);
      const ini = fornecedorInicial || (ocInicial && r.find((o) => o.id === ocInicial) ? chaveForn(r.find((o) => o.id === ocInicial)) : "");
      escolherFornecedor(ini, r);
    }).catch((e) => { erro(e, "Erro a carregar"); setOcs([]); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fornecedores = useMemo(() => {
    const m = new Map();
    (ocs || []).forEach((o) => {
      const k = chaveForn(o);
      const x = m.get(k) || { id: k, nome: o.fornecedor || "Sem fornecedor", n: 0 };
      x.n += 1; m.set(k, x);
    });
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [ocs]);
  const doForn = (ocs || []).filter((o) => chaveForn(o) === forn);

  function escolherFornecedor(k, lista = ocs) {
    setForn(k);
    const os = (lista || []).filter((o) => chaveForn(o) === k);
    setSel(Object.fromEntries(os.map((o) => [o.id, !ocInicial || o.id === ocInicial || os.length <= 3])));
    setQtd(Object.fromEntries(os.flatMap((o) => o.linhas.filter((l) => l.falta > 0).map((l) => [`${o.id}|${l.id}`, String(l.falta)]))));
  }

  const pedidos = doForn.filter((o) => sel[o.id]).map((o) => ({
    oc_id: o.id, linhas: o.linhas.filter((l) => l.falta > 0).map((l) => ({ linha_id: l.id, quantidade: Number(qtd[`${o.id}|${l.id}`]) || 0 })).filter((l) => l.quantidade > 0),
  })).filter((p) => p.linhas.length);
  const nLinhas = pedidos.reduce((s, p) => s + p.linhas.length, 0);

  const gravar = async () => {
    setBusy(true);
    try {
      const r = await api.post("/ordens-compra/rececoes-lote", { ...f, localizacao_id: f.localizacao_id || null, ocs: pedidos });
      toast.success(`Receção registada em ${r.rececoes.map((x) => x.codigo + (x.estado === "recebida" ? " (completa)" : "")).join(", ")}`);
      onOpenChange(false);
      onFeito?.();
    } catch (e) { erro(e, "Não foi possível registar a receção"); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><PackageCheck size={18} /> Receção de várias encomendas</DialogTitle>
          <DialogDescription>Escolha o fornecedor e marque as ordens de compra que chegaram nesta entrega. Só se recebem em conjunto encomendas do mesmo fornecedor.</DialogDescription>
        </DialogHeader>
        {ocs === null ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : (
          <div className="space-y-4 max-h-[65vh] overflow-y-auto" data-testid="rececao-varias">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600 block">Fornecedor
                <EntitySelect items={fornecedores} value={forn} onChange={(id) => escolherFornecedor(id || "")} placeholder="Escolher fornecedor…"
                  hint={(x) => `${x.n} OC por receber`} testid="rececao-varias-fornecedor" />
              </label>
              {!fornecedores.length && <p className="text-sm text-gray-500 self-end">Não há ordens de compra por receber.</p>}
            </div>
            {forn && (
              <>
                {doForn.map((o) => (
                  <div key={o.id} className={`border rounded-sm ${sel[o.id] ? "border-gray-300" : "border-gray-200 opacity-60"}`}>
                    <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b cursor-pointer">
                      <input type="checkbox" checked={!!sel[o.id]} onChange={(e) => setSel({ ...sel, [o.id]: e.target.checked })} />
                      <span className="font-medium mono">{o.codigo}</span>
                      <span className="text-xs text-gray-500">{fmtDate(o.data)}{o.assunto ? ` · ${o.assunto}` : ""}</span>
                    </label>
                    {sel[o.id] && (
                      <table className="w-full text-sm">
                        <tbody>
                          {o.linhas.filter((l) => l.falta > 0).map((l) => {
                            const k = `${o.id}|${l.id}`;
                            return (
                              <tr key={l.id} className="border-b last:border-0">
                                <td className="px-3 py-1.5">{l.nome}</td>
                                <td className="px-3 py-1.5 text-right text-xs text-gray-500 whitespace-nowrap">falta {num(l.falta)}{l.recebida > 0 ? ` de ${num(l.quantidade)}` : ""}</td>
                                <td className="px-3 py-1.5 w-32 text-right">
                                  <input type="number" min="0" step="any" value={qtd[k] ?? ""} onChange={(e) => setQtd({ ...qtd, [k]: e.target.value })}
                                    className={`${inputCls} w-24 text-right tabular-nums`} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
                <div className="grid sm:grid-cols-4 gap-3">
                  <label className="text-xs font-medium text-gray-600 block">Data<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} className={`${inputCls} mt-1 w-full`} /></label>
                  <label className="text-xs font-medium text-gray-600 block">Guia do fornecedor<input value={f.guia_fornecedor} onChange={(e) => setF({ ...f, guia_fornecedor: e.target.value })} className={`${inputCls} mt-1 w-full`} placeholder="N.º da guia" /></label>
                  <label className="text-xs font-medium text-gray-600 block sm:col-span-2">Arrumar em
                    <EntitySelect items={locs} value={f.localizacao_id} onChange={(id) => setF({ ...f, localizacao_id: id || "" })} clearLabel="— Localização de cada artigo —" placeholder="Localização de cada artigo" />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={f.aceitar_excesso} onChange={(e) => setF({ ...f, aceitar_excesso: e.target.checked })} /> Aceitar quantidades a mais do que o encomendado</label>
                <input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Notas da receção (opcional)" className={`${inputCls} w-full`} />
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy || !nLinhas} onClick={gravar} data-testid="rececao-varias-gravar">
            {busy && <Loader2 size={15} className="animate-spin" />} Registar receção{pedidos.length > 1 ? ` (${pedidos.length} OC)` : ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
