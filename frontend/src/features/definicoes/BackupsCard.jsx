import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DatabaseBackup, Download, Loader2, Upload } from "lucide-react";
import { API, api, fmtDate, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

async function baixar(id) {
  const res = await fetch(`${API}/backups/${id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("Não foi possível descarregar");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a"); a.href = url; a.download = `velocely-copia-${new Date().toISOString().slice(0, 10)}.json.gz`; a.click();
}

/** Cópias de segurança: automáticas (1 por dia, últimas 14), descarregar e restaurar. Só administradores. */
export default function BackupsCard() {
  const { isAdmin } = useAuth();
  const [lista, setLista] = useState(null);
  const [busy, setBusy] = useState("");
  const carregar = () => api.get("/backups").then(setLista).catch(() => {});
  useEffect(() => { if (isAdmin) carregar(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isAdmin || !lista) return null;
  const agora = async () => {
    setBusy("agora");
    try { await api.post("/backups"); toast.success("Cópia criada"); carregar(); } catch { toast.error("Não foi possível criar a cópia"); } finally { setBusy(""); }
  };
  const restaurar = async (file) => {
    if (!file) return;
    const conf = window.prompt("Isto substitui TODOS os dados atuais pelos da cópia (antes é feita uma cópia do estado atual). Escreva RESTAURAR para continuar.");
    if ((conf || "").trim().toUpperCase() !== "RESTAURAR") return;
    setBusy("restaurar");
    try {
      const fd = new FormData(); fd.append("ficheiro", file); fd.append("confirmar", "RESTAURAR");
      const res = await fetch(`${API}/backups/restaurar`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${getToken()}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Falhou");
      toast.success(`Dados restaurados (${j.colecoes} coleções). A recarregar…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 mb-4" data-testid="backups-card">
      <div className="flex flex-wrap items-start gap-3">
        <DatabaseBackup size={20} className="text-gray-500 mt-0.5" />
        <div className="flex-1 min-w-[16rem]">
          <div className="font-semibold text-sm">Cópias de segurança</div>
          <p className="text-sm text-gray-600 mt-0.5">É feita uma cópia automática por dia (ficam as últimas 14). Pode descarregar uma cópia para guardar fora do servidor, ou restaurar a partir de um ficheiro.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secundario" disabled={!!busy} onClick={agora}>{busy === "agora" ? <Loader2 size={15} className="animate-spin" /> : <DatabaseBackup size={15} />} Fazer cópia agora</button>
          <button type="button" className="btn btn-secundario" onClick={() => baixar("agora").catch((e) => toast.error(e.message))}><Download size={15} /> Descarregar cópia atual</button>
          <label className="btn btn-secundario cursor-pointer text-red-700">{busy === "restaurar" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Restaurar…
            <input type="file" accept=".gz,.json" className="hidden" onChange={(e) => restaurar(e.target.files?.[0])} /></label>
        </div>
      </div>
      {lista.length > 0 && (
        <div className="mt-3 text-sm divide-y divide-gray-100 border-t border-gray-100">
          {lista.slice(0, 7).map((b) => (
            <div key={b.id} className="flex items-center gap-3 py-1.5">
              <span className="flex-1">{fmtDate(b.data)} · {(b.bytes / 1024 / 1024).toFixed(1)} MB</span>
              <button type="button" className="text-brand text-xs hover:underline" onClick={() => baixar(b.id).catch((e) => toast.error(e.message))}>Descarregar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
