import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { Calendar as CalendarUi } from "@/components/ui/calendar";
import HeaderIconBadge, { HEADER_ICON_BTN } from "@/components/HeaderIconBadge";
import useMediaQuery from "@/hooks/useMediaQuery";
import { CalendarDays, ExternalLink, Factory, Package } from "lucide-react";

const parseDate = (s) => {
  const [y, m, d] = (s || "").slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export default function MiniCalendarButton() {
  const nav = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const boxRef = useRef(null);

  const load = async () => {
    try {
      setItems(await api.get("/prazos"));
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        const panel = document.getElementById("mini-calendar-panel-portal");
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

  const atrasadas = items.filter((i) => i.estado_prazo === "atrasada");
  const proximas = items.filter((i) => i.estado_prazo === "proxima");
  const futuras = items.filter((i) => i.estado_prazo === "futura");

  const modifiers = useMemo(
    () => ({
      atrasada: atrasadas.map((i) => parseDate(i.prazo_entrega)),
      proxima: proximas.map((i) => parseDate(i.prazo_entrega)),
      futura: futuras.map((i) => parseDate(i.prazo_entrega)),
    }),
    [items] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const modifiersClassNames = {
    atrasada: "bg-red-100 text-red-700 font-semibold rounded-sm",
    proxima: "bg-amber-100 text-amber-700 font-semibold rounded-sm",
    futura: "bg-gray-100 text-gray-700 rounded-sm",
  };

  const selectedKey = selected
    ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`
    : null;
  const dayItems = selectedKey ? items.filter((i) => i.prazo_entrega === selectedKey) : [];
  const badgeN = atrasadas.length;

  const panelBody = (
    <>
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-800">Prazos</span>
        <Link
          to="/calendario"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 shrink-0"
          data-testid="mini-calendar-full"
        >
          Ver completo <ExternalLink size={11} />
        </Link>
      </div>
      <div className="p-1 flex justify-center">
        <CalendarUi
          mode="single"
          selected={selected}
          onSelect={setSelected}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
          className="w-full max-w-[20rem]"
        />
      </div>
      <div className="flex flex-wrap gap-3 px-3 pb-2 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Atrasado</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> ≤ 7 dias</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" /> Futuro</span>
      </div>
      {selected && (
        <div className="border-t border-gray-100 max-h-44 overflow-y-auto" data-testid="mini-calendar-day">
          {dayItems.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-gray-400">Sem prazos neste dia</div>
          ) : (
            dayItems.map((it) => {
              const to = it.tipo === "encomenda" ? `/encomendas/${it.id}` : `/ordens-fabrico/${it.id}`;
              const Icon = it.tipo === "encomenda" ? Package : Factory;
              return (
                <button
                  key={`${it.tipo}-${it.id}`}
                  type="button"
                  onClick={() => { setOpen(false); nav(to); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0"
                >
                  <Icon size={13} className="text-gray-400 shrink-0" />
                  <span className="text-xs font-medium text-gray-900 truncate flex-1">{it.numero}</span>
                  <span className="text-[11px] tabular-nums text-gray-500">{fmtDate(it.prazo_entrega)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </>
  );

  const mobilePanel = open && !isDesktop && createPortal(
    <div id="mini-calendar-panel-portal" className="lg:hidden">
      <button
        type="button"
        aria-label="Fechar calendário"
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div
        className="fixed z-[61] left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top,0px)+0.5rem)] max-h-[min(78dvh,34rem)] overflow-y-auto bg-white border border-gray-200 rounded-sm shadow-xl safe-x"
        data-testid="mini-calendar-panel"
      >
        {panelBody}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="relative" ref={boxRef} data-testid="mini-calendar">
      <button
        type="button"
        data-testid="mini-calendar-btn"
        onClick={() => setOpen((o) => !o)}
        className={HEADER_ICON_BTN}
        aria-label="Calendário"
        aria-expanded={open}
      >
        <CalendarDays size={19} strokeWidth={1.8} />
        <HeaderIconBadge count={badgeN} critical testid="mini-calendar-badge" />
      </button>

      {open && isDesktop && (
        <div
          className="absolute right-0 z-50 mt-1 w-[20.5rem] bg-white border border-gray-200 rounded-sm shadow-lg overflow-hidden"
          data-testid="mini-calendar-panel"
        >
          {panelBody}
        </div>
      )}
      {mobilePanel}
    </div>
  );
}
