import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Clock, ShieldCheck, XCircle } from "lucide-react";
import { api, fmtDate } from "@/lib/api";

/**
 * Estado da aprovação de um documento (orçamento, ordem de compra) com Aprovar/Rejeitar para os aprovadores.
 * Só aparece quando há (ou houve) um pedido de aprovação.
 */
export default function AprovacaoBanner({ entidade, entidadeId, recarregarEm = 0 }) {
  const [t, setT] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [rejeitar, setRejeitar] = useState(false);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(() => {
    if (!entidadeId) return;
    api.get(`/aprovacoes/estado?entidade=${entidade}&entidade_id=${entidadeId}`).then(setT).catch(() => setT(null));
  }, [entidade, entidadeId]);
  useEffect(() => { carregar(); }, [carregar, recarregarEm]);
  useEffect(() => {
    const h = () => carregar();
    window.addEventListener("velocely:aprovacao", h);
    return () => window.removeEventListener("velocely:aprovacao", h);
  }, [carregar]);

  if (!t?.estado || t.estado === "substituido") return null;

  const decidir = async (aprovar) => {
    setBusy(true);
    try {
      await api.post(`/tarefas/${t.id}/decidir`, { aprovar, motivo });
      toast.success(aprovar ? "Aprovado" : "Rejeitado");
      setRejeitar(false);
      setMotivo("");
      window.dispatchEvent(new Event("velocely:tarefas"));
      carregar();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível decidir");
    } finally {
      setBusy(false);
    }
  };

  const est = {
    pendente: { cls: "border-amber-200 bg-amber-50 text-amber-950", Icon: Clock, txt: "Aguarda aprovação" },
    aprovado: { cls: "border-emerald-200 bg-emerald-50 text-emerald-950", Icon: CheckCircle2, txt: "Aprovado" },
    rejeitado: { cls: "border-red-200 bg-red-50 text-red-950", Icon: XCircle, txt: "Rejeitado" },
  }[t.estado] || { cls: "border-gray-200 bg-gray-50", Icon: ShieldCheck, txt: t.estado };

  return (
    <div className={`rounded-sm border px-4 py-2.5 mb-4 text-sm ${est.cls}`} data-testid="aprovacao-banner">
      <div className="flex flex-wrap items-start gap-2">
        <est.Icon size={16} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{est.txt}</div>
          <div className="text-xs opacity-90">{t.texto}</div>
          <div className="text-xs opacity-75 mt-0.5">
            Pedido por {t.pedido_por?.nome || "—"} em {fmtDate(t.created_at)}
            {t.decidido_por && ` · ${t.estado === "aprovado" ? "aprovado" : "rejeitado"} por ${t.decidido_por.nome} em ${fmtDate(t.decidido_at)}`}
            {t.motivo && ` · ${t.motivo}`}
          </div>
        </div>
        {t.posso_decidir && !rejeitar && (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => decidir(true)} className="btn btn-sucesso btn-sm" data-testid="aprovacao-aprovar"><CheckCircle2 size={14} /> Aprovar</button>
            <button type="button" disabled={busy} onClick={() => setRejeitar(true)} className="btn btn-perigo-contorno btn-sm" data-testid="aprovacao-rejeitar"><XCircle size={14} /> Rejeitar</button>
          </div>
        )}
        {t.estado === "pendente" && !t.posso_decidir && <Link to="/tarefas" className="text-xs underline">Ver tarefas</Link>}
      </div>
      {rejeitar && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da rejeição" className="flex-1 min-w-[14rem] border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white" />
          <button type="button" disabled={busy || !motivo.trim()} onClick={() => decidir(false)} className="btn btn-perigo btn-sm">Rejeitar</button>
          <button type="button" onClick={() => setRejeitar(false)} className="btn btn-secundario btn-sm">Cancelar</button>
        </div>
      )}
    </div>
  );
}
