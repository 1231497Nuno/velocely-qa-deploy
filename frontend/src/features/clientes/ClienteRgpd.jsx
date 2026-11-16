import { useState } from "react";
import { toast } from "sonner";
import { Download, ShieldCheck, UserX } from "lucide-react";
import { API, api, fmtDate, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";

/** RGPD do cliente: consentimento de marketing, exportar os dados e anonimizar. */
export default function ClienteRgpd({ cliente, onChanged }) {
  const { isAdmin, can } = useAuth();
  const confirm = useConfirm();
  const r = cliente?.rgpd || {};
  const [origem, setOrigem] = useState("");
  const consent = async (marketing) => {
    try { await api.put(`/clientes/${cliente.id}/rgpd/consentimento`, { marketing, origem }); toast.success("Registado"); onChanged?.(); }
    catch { toast.error("Não foi possível registar"); }
  };
  const exportar = async () => {
    const res = await fetch(`${API}/clientes/${cliente.id}/rgpd/exportar`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { toast.error("Não foi possível exportar"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `dados-${cliente.codigo || cliente.id}.json`; a.click();
  };
  const anonimizar = async () => {
    if (!(await confirm({ title: "Anonimizar este cliente?", description: "Apaga nome, contactos e morada (direito ao esquecimento). As encomendas e os documentos fiscais mantêm-se pelos 10 anos obrigatórios, sem os dados pessoais. Não pode ser desfeito.", confirmLabel: "Anonimizar", tone: "danger" }))) return;
    try { await api.post(`/clientes/${cliente.id}/rgpd/anonimizar`, {}); toast.success("Cliente anonimizado"); onChanged?.(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível"); }
  };
  return (
    <div className="space-y-4 max-w-2xl" data-testid="cliente-rgpd">
      <div className="bg-white border border-gray-200 rounded-sm p-4 space-y-2">
        <div className="font-semibold text-sm flex items-center gap-2"><ShieldCheck size={16} /> Consentimento para marketing (newsletter, campanhas)</div>
        <div className="text-sm text-gray-600">
          {r.at ? <>Estado: <b>{r.marketing ? "autorizou" : "não autorizou"}</b> em {fmtDate(r.at)}{r.origem ? ` (${r.origem})` : ""}{r.por ? ` — registado por ${r.por}` : ""}</> : "Sem registo."}
        </div>
        {can("clientes", "edit") && !cliente.anonimizado_at && (
          <div className="flex flex-wrap gap-2 items-center">
            <input className="border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm" placeholder="Como? (ex.: formulário da loja, email)" value={origem} onChange={(e) => setOrigem(e.target.value)} />
            <button type="button" className="btn btn-secundario" onClick={() => consent(true)}>Autorizou</button>
            <button type="button" className="btn btn-secundario" onClick={() => consent(false)}>Retirou / não autorizou</button>
          </div>
        )}
        {(r.historico || []).length > 1 && <div className="text-xs text-gray-500">Histórico: {r.historico.map((h) => `${fmtDate(h.at)} ${h.marketing ? "sim" : "não"}`).join(" · ")}</div>}
      </div>
      <div className="bg-white border border-gray-200 rounded-sm p-4 space-y-2">
        <div className="font-semibold text-sm">Direitos do titular</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secundario" onClick={exportar}><Download size={15} /> Exportar os dados (acesso/portabilidade)</button>
          {isAdmin && !cliente.anonimizado_at && <button type="button" className="btn btn-secundario text-red-700" onClick={anonimizar}><UserX size={15} /> Anonimizar (esquecimento)</button>}
        </div>
        {cliente.anonimizado_at && <div className="text-sm text-gray-600">Anonimizado em {fmtDate(cliente.anonimizado_at)}.</div>}
      </div>
    </div>
  );
}
