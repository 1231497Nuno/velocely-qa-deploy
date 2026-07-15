import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Bell, AlertTriangle, Wallet, CalendarClock, ShieldCheck, Factory, CheckCircle2 } from "lucide-react";

const ICON = { pagamento: Wallet, prazo: CalendarClock, autorizar: ShieldCheck, of: Factory };
const SEV = {
  critico: "text-red-600 bg-red-50",
  aviso: "text-amber-600 bg-amber-50",
  info: "text-blue-600 bg-blue-50",
};

export default function NotificationsBell() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const load = async () => {
    try {
      const d = await api.get("/notificacoes");
      setItems(d.notificacoes || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const criticos = items.filter((i) => i.severidade === "critico").length;
  const go = (url) => { setOpen(false); nav(url); };

  return (
    <div className="relative" ref={boxRef} data-testid="notifications">
      <button
        data-testid="notifications-bell"
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative p-2 rounded-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        aria-label="Notificações"
      >
        <Bell size={19} strokeWidth={1.8} />
        {items.length > 0 && (
          <span data-testid="notifications-count" className={`absolute -top-0.5 -right-0.5 text-[10px] font-bold tabular-nums rounded-full min-w-[17px] text-center px-1 py-0.5 ${criticos > 0 ? "bg-red-500 text-white" : "bg-amber-400 text-gray-900"}`}>
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 bg-white border border-gray-200 rounded-sm shadow-lg max-h-[28rem] overflow-y-auto" data-testid="notifications-panel">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
            <span className="text-sm font-semibold text-gray-800">Notificações</span>
            <span className="text-xs text-gray-400">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400 flex flex-col items-center gap-2" data-testid="notifications-empty">
              <CheckCircle2 size={22} className="text-emerald-500" /> Tudo em dia!
            </div>
          ) : (
            items.map((n) => {
              const Icon = ICON[n.tipo] || AlertTriangle;
              return (
                <button key={n.id} data-testid={`notification-${n.id}`} onClick={() => go(n.url)} className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0">
                  <span className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${SEV[n.severidade] || "text-gray-500 bg-gray-100"}`}><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900">{n.titulo}</div>
                    {n.descricao && <div className="text-xs text-gray-400 truncate">{n.descricao}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
