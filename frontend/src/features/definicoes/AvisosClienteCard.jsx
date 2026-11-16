import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/** Definições → Emails: avisos automáticos ao cliente quando a encomenda avança. */
export default function AvisosClienteCard() {
  const { isAdmin } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/avisos-cliente/config").then(setCfg).catch(() => {}); }, []);
  if (!cfg) return null;
  const evs = cfg.eventos_disponiveis || {};
  const guardar = async (patch) => {
    const novo = { ...cfg, ...patch };
    setBusy(true);
    try {
      const r = await api.put("/avisos-cliente/config", { ativo: novo.ativo, eventos: novo.eventos, anexar_pdf: novo.anexar_pdf });
      setCfg({ ...cfg, ...r });
      if (patch.ativo === true) toast.success("Avisos ligados — a partir de agora o cliente recebe um email quando a encomenda avança");
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível guardar"); } finally { setBusy(false); }
  };
  const alternar = (k) => guardar({ eventos: cfg.eventos.includes(k) ? cfg.eventos.filter((x) => x !== k) : [...cfg.eventos, k] });
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 mb-4" data-testid="avisos-cliente-card">
      <div className="flex flex-wrap items-start gap-3">
        <BellRing size={20} className="text-gray-500 mt-0.5" />
        <div className="flex-1 min-w-[16rem]">
          <div className="font-semibold text-sm">Avisos automáticos ao cliente</div>
          <p className="text-sm text-gray-600 mt-0.5">O cliente recebe um email (com o link para acompanhar, aprovar maquetas e pagar) quando a encomenda muda de fase. As encomendas que já existem não recebem avisos do que já aconteceu.</p>
          {!cfg.smtp && <p className="text-xs text-amber-700 mt-1">O envio de email não está configurado no servidor — os avisos só saem depois de configurar o SMTP.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          {busy && <Loader2 size={14} className="animate-spin" />}
          <input type="checkbox" className="w-4 h-4 accent-black" checked={!!cfg.ativo} disabled={!isAdmin || busy} onChange={(e) => guardar({ ativo: e.target.checked })} data-testid="avisos-ativo" />
          {cfg.ativo ? "Ligados" : "Desligados"}
        </label>
      </div>
      <div className={`mt-3 flex flex-wrap gap-x-5 gap-y-2 ${cfg.ativo ? "" : "opacity-60"}`}>
        {Object.entries(evs).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.eventos.includes(k)} disabled={!isAdmin || busy} onChange={() => alternar(k)} /> {l}</label>
        ))}
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={!!cfg.anexar_pdf} disabled={!isAdmin || busy} onChange={(e) => guardar({ anexar_pdf: e.target.checked })} /> Anexar o PDF da encomenda (pronta e prazo)</label>
      </div>
    </div>
  );
}
