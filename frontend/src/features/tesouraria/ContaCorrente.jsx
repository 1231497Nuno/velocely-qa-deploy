import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileDown, Mail } from "lucide-react";
import { API, api, eur, fmtDate } from "@/lib/api";
import { openAuthenticated } from "@/lib/openAuthenticated";
import { useAuth } from "@/context/AuthContext";

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white";

/** Conta corrente do cliente (a receber) ou do fornecedor (a pagar), com extrato em PDF e envio por email. */
export default function ContaCorrente({ tipo, id }) {
  const { can } = useAuth();
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [cc, setCc] = useState(null);
  const q = `de=${de}&ate=${ate}`;
  const carregar = useCallback(() => api.get(`/conta-corrente/${tipo}/${id}?${q}`).then(setCc).catch(() => setCc(null)), [tipo, id, q]);
  useEffect(() => { if (can("contas", "view")) carregar(); }, [carregar]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can("contas", "view")) return <div className="text-sm text-gray-500">Sem acesso a contas.</div>;
  if (!cc) return null;
  const enviar = async () => {
    try { const r = await api.post(`/conta-corrente/cliente/${id}/enviar`, { de, ate }); toast.success(`Extrato enviado para ${r.to}`); }
    catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível enviar"); }
  };
  return (
    <div className="space-y-3" data-testid="conta-corrente">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">De<input type="date" className={`${inputCls} block`} value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="text-xs text-gray-600">Até<input type="date" className={`${inputCls} block`} value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-secundario" onClick={() => openAuthenticated(`${API}/conta-corrente/${tipo}/${id}?${q}&formato=pdf`).catch((e) => toast.error(e.message))}><FileDown size={15} /> Extrato PDF</button>
          {tipo === "cliente" && <button type="button" className="btn btn-secundario" onClick={enviar}><Mail size={15} /> Enviar ao cliente</button>}
        </div>
      </div>
      <div className={`rounded-sm border p-3 text-sm ${cc.saldo > 0.009 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        Saldo {tipo === "cliente" ? "a receber" : "a pagar"}: <b className="tabular-nums">{eur(cc.saldo)}</b>
      </div>
      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50"><tr><th className="text-left px-3 py-2">Data</th><th className="text-left px-3">Documento</th><th className="text-left px-3">Descrição</th><th className="text-right px-3">Débito</th><th className="text-right px-3">Crédito</th><th className="text-right px-3">Saldo</th></tr></thead>
          <tbody>
            {cc.de && <tr className="border-t border-gray-100 text-gray-500"><td /><td /><td className="px-3 py-1.5">Saldo anterior</td><td /><td /><td className="px-3 text-right tabular-nums">{eur(cc.saldo_anterior)}</td></tr>}
            {cc.linhas.map((l, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(l.data)}</td>
                <td className="px-3">{l.link ? <Link to={l.link} className="text-brand hover:underline">{l.documento}</Link> : l.documento}</td>
                <td className="px-3 text-gray-600">{l.descricao}</td>
                <td className="px-3 text-right tabular-nums">{l.debito ? eur(l.debito) : ""}</td>
                <td className="px-3 text-right tabular-nums">{l.credito ? eur(l.credito) : ""}</td>
                <td className="px-3 text-right tabular-nums font-medium">{eur(l.saldo)}</td>
              </tr>
            ))}
            {!cc.linhas.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Sem movimentos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
