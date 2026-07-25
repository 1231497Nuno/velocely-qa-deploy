import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { Calendar as CalendarUi } from "@/components/ui/calendar";
import { CalendarDays, ExternalLink, Factory, Package } from "lucide-react";

const parseDate = (s) => {
  const [y, m, d] = (s || "").slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export default function MiniCalendarButton() {
  const nav = useNavigate();
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
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

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

  return (
    <div className="relative" ref={boxRef} data-testid="mini-calendar">
      <button
        type="button"
        data-testid="mini-calendar-btn"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        aria-label="Calendário"
      >
        <CalendarDays size={19} strokeWidth={1.8} />
        {badgeN > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-[10px] font-bold tabular-nums rounded-full min-w-[17px] text-center px-1 py-0.5 bg-red-500 text-white">
            {badgeN}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-[20.5rem] bg-white border border-gray-200 rounded-sm shadow-lg overflow-hidden"
          data-testid="mini-calendar-panel"
        >
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">Prazos</span>
            <Link
              to="/calendario"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"
              data-testid="mini-calendar-full"
            >
              Ver completo <ExternalLink size={11} />
            </Link>
          </div>
          <div className="p-1">
            <CalendarUi
              mode="single"
              selected={selected}
              onSelect={setSelected}
              modifiers={modifiers}
              modifiersClassNames={modifiersClassNames}
              className="w-full"
            />
          </div>
          <div className="flex flex-wrap gap-3 px-3 pb-2 text-[11px] text-gray-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Atrasado</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> ≤ 7 dias</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" /> Futuro</span>
          </div>
          {selected && (
            <div className="border-t border-gray-100 max-h-40 overflow-y-auto" data-testid="mini-calendar-day">
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
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0"
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
        </div>
      )}
    </div>
  );
}
