import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, CreditCard, Save } from "lucide-react";
import { api } from "@/lib/api";

const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50";

/** Definições → Integrações: referências Multibanco e MB WAY (ifthenpay ou Eupago). */
export default function PagamentosOnlineIntegracao({ isAdmin }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isAdmin) api.get("/pagamentos-online/config").then(setF).catch(() => {}); }, [isAdmin]);
  if (!isAdmin || !f) return null;
  const setP = (p, patch) => setF((x) => ({ ...x, [p]: { ...x[p], ...patch } }));
  const toggleMetodo = (m) => setF((x) => ({ ...x, metodos: x.metodos.includes(m) ? x.metodos.filter((y) => y !== m) : [...x.metodos, m] }));
  const guardar = async () => {
    setBusy(true);
    try { const r = await api.put("/pagamentos-online/config", f); setF((x) => ({ ...x, ...r })); toast.success("Pagamentos online guardados"); }
    catch { toast.error("Não foi possível guardar"); } finally { setBusy(false); }
  };
  const cb = f.fornecedor === "ifthenpay" ? f.callback_ifthenpay : f.callback_eupago;
  return (
    <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4" data-testid="integracao-pagamentos-online">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><CreditCard size={18} /> Pagamentos online (Multibanco / MB WAY)</h3>
          <p className="text-sm text-gray-500 mt-0.5">O cliente paga pelo link da encomenda (ou gera a referência na encomenda). Quando paga, o pagamento entra sozinho e a encomenda fica autorizada para produção.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">Serviço
          <select className={inputCls} value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })}>
            <option value="ifthenpay">ifthenpay</option><option value="eupago">Eupago</option>
          </select></label>
        <div className="text-sm">Métodos
          <div className="flex gap-3 mt-2">
            {[["multibanco", "Multibanco"], ["mbway", "MB WAY"]].map(([k, l]) => <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={f.metodos.includes(k)} onChange={() => toggleMetodo(k)} /> {l}</label>)}
          </div></div>
        <label className="text-sm">Validade da referência (dias)<input type="number" min="1" className={inputCls} value={f.validade_dias} onChange={(e) => setF({ ...f, validade_dias: e.target.value })} /></label>
      </div>
      {f.fornecedor === "ifthenpay" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">Chave Multibanco (MB Key)<input className={inputCls} value={f.ifthenpay.mb_key} onChange={(e) => setP("ifthenpay", { mb_key: e.target.value })} /></label>
          <label className="text-sm">Chave MB WAY<input className={inputCls} value={f.ifthenpay.mbway_key} onChange={(e) => setP("ifthenpay", { mbway_key: e.target.value })} /></label>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">API key<input className={inputCls} value={f.eupago.api_key} onChange={(e) => setP("eupago", { api_key: e.target.value })} /></label>
          <label className="inline-flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={!!f.eupago.sandbox} onChange={(e) => setP("eupago", { sandbox: e.target.checked })} /> Modo de testes (sandbox)</label>
        </div>
      )}
      <div className="text-sm">
        <div className="text-gray-600">URL de callback (indicar ao {f.fornecedor === "ifthenpay" ? "ifthenpay" : "Eupago"}):</div>
        <div className="flex gap-2 mt-1">
          <input readOnly className={`${inputCls} bg-gray-50 font-mono text-xs`} value={cb} />
          <button type="button" className="btn btn-secundario" onClick={() => navigator.clipboard.writeText(cb).then(() => toast.success("Copiado"))}><Copy size={15} /></button>
        </div>
        {!cb.startsWith("http") && <p className="text-xs text-amber-700 mt-1">Defina BACKEND_PUBLIC_URL (endereço público do servidor) para o callback ficar completo.</p>}
      </div>
      <div className="flex justify-end"><button type="button" className="btn btn-primario" disabled={busy} onClick={guardar}><Save size={15} /> Guardar</button></div>
    </section>
  );
}
