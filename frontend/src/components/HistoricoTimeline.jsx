import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import {
  Plus, Pencil, Trash2, ArrowRightLeft, Wallet, ShieldCheck, Star,
  CheckCircle2, GitFork, Copy, History, StickyNote, Clock, User,
} from "lucide-react";

const ICONS = {
  criado: Plus,
  editado: Pencil,
  eliminado: Trash2,
  estado_alterado: ArrowRightLeft,
  pagamento: Wallet,
  producao_autorizada: ShieldCheck,
  prioridade: Star,
  concluido: CheckCircle2,
  convertido: GitFork,
  duplicado: Copy,
  nota: StickyNote,
  operacao: CheckCircle2,
};

const COLORS = {
  criado: "bg-emerald-100 text-emerald-700",
  editado: "bg-blue-100 text-blue-700",
  eliminado: "bg-red-100 text-red-700",
  estado_alterado: "bg-violet-100 text-violet-700",
  pagamento: "bg-amber-100 text-amber-700",
  producao_autorizada: "bg-teal-100 text-teal-700",
  prioridade: "bg-orange-100 text-orange-700",
  concluido: "bg-emerald-100 text-emerald-700",
  convertido: "bg-indigo-100 text-indigo-700",
  duplicado: "bg-gray-100 text-gray-700",
  nota: "bg-yellow-100 text-yellow-700",
};

const fmtDT = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return d;
  }
};

export default function HistoricoTimeline({ tipo, id, refreshKey = 0 }) {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEventos(await api.get(`/historico/${tipo}/${id}`));
    } catch {
      setEventos([]);
    } finally {
      setLoading(false);
    }
  }, [tipo, id]);

  useEffect(() => { if (tipo && id) load(); }, [load, refreshKey]);

  return (
    <section className="mt-6" data-testid="historico-timeline">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <History size={15} /> Histórico de alterações
      </h2>
      <div className="bg-white border border-gray-200 rounded-sm p-5">
        {loading ? (
          <div className="text-sm text-gray-400">A carregar histórico...</div>
        ) : eventos.length === 0 ? (
          <div className="text-sm text-gray-400" data-testid="historico-empty">Sem registos de histórico.</div>
        ) : (
          <ol className="relative">
            {eventos.map((ev, idx) => {
              const Icon = ICONS[ev.acao] || History;
              const color = COLORS[ev.acao] || "bg-gray-100 text-gray-700";
              const last = idx === eventos.length - 1;
              return (
                <li key={ev.id} data-testid={`historico-item-${ev.id}`} className="flex gap-3 pb-4 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${color}`}>
                      <Icon size={15} />
                    </span>
                    {!last && <span className="flex-1 w-px bg-gray-200 mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="text-sm text-gray-900">{ev.descricao || ev.acao_label}</div>
                    {ev.alteracoes && ev.alteracoes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {ev.alteracoes.map((a, i) => (
                          <li key={`${ev.id}-${a.label ?? i}`} className="text-xs text-gray-500">
                            <span className="font-medium text-gray-600">{a.label}:</span>{" "}
                            <span className="line-through text-gray-400">{a.de}</span>{" → "}
                            <span className="text-gray-700">{a.para}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><User size={11} /> {ev.utilizador_nome}</span>
                      <span className="flex items-center gap-1"><Clock size={11} /> {fmtDT(ev.timestamp)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
