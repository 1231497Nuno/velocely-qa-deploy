import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import HeaderIconBadge, { HEADER_ICON_BTN } from "@/components/HeaderIconBadge";
import useMediaQuery from "@/hooks/useMediaQuery";
import { Bell, AlertTriangle, Wallet, CalendarClock, ShieldCheck, Factory, CheckCircle2 } from "lucide-react";

const ICON = { pagamento: Wallet, prazo: CalendarClock, autorizar: ShieldCheck, of: Factory };
const SEV = {
  critico: "text-red-600 bg-red-50",
  aviso: "text-amber-600 bg-amber-50",
  info: "text-blue-600 bg-blue-50",
};

/** Só carrega /notificacoes ao abrir o painel — evita saturar a API free no boot. */
export default function NotificationsBell({ badgeHint = 0, badgeCritical = false }) {
  const nav = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const load = async () => {
    try {
      const d = await api.get("/notificacoes");
      setItems(d.notificacoes || []);
    } catch (e) {
      console.error("Falha ao carregar notificações", e);
      setItems([]);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        const panel = document.getElementById("notifications-panel-portal");
        if (panel && panel.contains(e.target)) return;
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = items || [];
  const count = items ? list.length : badgeHint;
  const criticos = items
    ? list.filter((i) => i.severidade === "critico").length
    : (badgeCritical ? 1 : 0);
  const go = (url) => { setOpen(false); nav(url); };

  const panelBody = (
    <>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
        <span className="text-sm font-semibold text-gray-800">Notificações</span>
        <span className="text-xs text-gray-400">{items ? list.length : "…"}</span>
      </div>
      {items === null ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">A carregar…</div>
      ) : list.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400 flex flex-col items-center gap-2" data-testid="notifications-empty">
          <CheckCircle2 size={22} className="text-emerald-500" /> Tudo em dia!
        </div>
      ) : (
        list.map((n) => {
          const Icon = ICON[n.tipo] || AlertTriangle;
          return (
            <button
              key={n.id}
              data-testid={`notification-${n.id}`}
              onClick={() => go(n.url)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0"
            >
              <span className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${SEV[n.severidade] || "text-gray-500 bg-gray-100"}`}>
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900">{n.titulo}</div>
                {n.descricao && <div className="text-xs text-gray-400 truncate">{n.descricao}</div>}
              </div>
            </button>
          );
        })
      )}
    </>
  );

  const mobilePanel = open && !isDesktop && createPortal(
    <div id="notifications-panel-portal" className="lg:hidden">
      <button
        type="button"
        aria-label="Fechar notificações"
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div
        className="fixed z-[61] left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top,0px)+0.5rem)] max-h-[min(78dvh,34rem)] overflow-y-auto bg-white border border-gray-200 rounded-sm shadow-xl"
        data-testid="notifications-panel"
      >
        {panelBody}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="relative" ref={boxRef} data-testid="notifications">
      <button
        data-testid="notifications-bell"
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) load();
            return next;
          });
        }}
        className={HEADER_ICON_BTN}
        aria-label="Notificações"
        aria-expanded={open}
      >
        <Bell size={19} strokeWidth={1.8} />
        <HeaderIconBadge count={count} critical={criticos > 0} testid="notifications-count" />
      </button>

      {open && isDesktop && (
        <div
          className="absolute right-0 z-50 mt-1 w-80 bg-white border border-gray-200 rounded-sm shadow-lg max-h-[28rem] overflow-y-auto"
          data-testid="notifications-panel"
        >
          {panelBody}
        </div>
      )}
      {mobilePanel}
    </div>
  );
}
