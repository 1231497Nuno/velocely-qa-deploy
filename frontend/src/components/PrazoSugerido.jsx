import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, fmtDate } from "@/lib/api";

/**
 * «Prazo possível»: calcula a data de entrega pela carga real das máquinas (OF abertas), compras em falta e margem.
 * `linhas` [{artigo_id, quantidade, roteiro}] ou `encomendaId`; `onUsar(dataISO)` aplica a data.
 */
export default function PrazoSugerido({ linhas, encomendaId, onUsar, usarLabel = "Usar esta data", className = "" }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [margem, setMargem] = useState(2);
  const calcular = async (m = margem) => {
    setBusy(true);
    try {
      setR(await api.post("/producao/prazo-sugerido", encomendaId ? { encomenda_id: encomendaId, margem_dias: m } : {
        linhas: (linhas || []).filter((l) => l.artigo_id).map((l) => ({ artigo_id: l.artigo_id, quantidade: Number(l.quantidade) || 0, roteiro: l.roteiro || null })),
        margem_dias: m,
      }));
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível calcular"); } finally { setBusy(false); }
  };
  return (
    <Popover onOpenChange={(o) => o && calcular()}>
      <PopoverTrigger asChild>
        <button type="button" className={`btn btn-secundario btn-sm ${className}`} data-testid="prazo-sugerido"><CalendarClock size={14} /> Prazo possível</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 text-sm space-y-2">
        {busy || !r ? <div className="flex justify-center p-3"><Loader2 className="animate-spin text-gray-400" /></div> : (
          <>
            <div>
              <div className="text-xs text-gray-500">Entrega possível a partir de</div>
              <div className="text-lg font-bold">{fmtDate(r.data)} <span className="text-sm font-normal text-gray-500">({r.dias_uteis} dias úteis)</span></div>
            </div>
            <ul className="text-xs text-gray-600 space-y-0.5">
              {r.maquinas.slice(0, 4).map((m) => (
                <li key={m.maquina}>{m.maquina}: {m.horas_fila.toLocaleString("pt-PT")} h em fila + {m.horas_novas.toLocaleString("pt-PT")} h deste trabalho → {m.dias} dia(s)</li>
              ))}
              {r.dias_compra > 0 && <li>Compras em falta ({r.compras.map((c) => c.artigo).join(", ")}): +{r.dias_compra} dias</li>}
              {r.sem_roteiro && <li className="text-amber-700">Os artigos não têm operações com máquina — o prazo conta só compras e margem.</li>}
            </ul>
            <label className="flex items-center gap-2 text-xs text-gray-600">Margem
              <input type="number" min="0" max="30" value={margem} onChange={(e) => setMargem(Number(e.target.value) || 0)} onBlur={() => calcular()} className="w-14 border border-gray-300 rounded-sm px-1.5 py-0.5 text-right" /> dias úteis
            </label>
            {onUsar && <button type="button" className="btn btn-primario btn-sm w-full justify-center" onClick={() => onUsar(r.data)}>{usarLabel}</button>}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
