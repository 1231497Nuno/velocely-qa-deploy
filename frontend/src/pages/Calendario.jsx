import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Calendar } from "../components/ui/calendar";
import { CalendarClock, AlertTriangle, Star, Package, Factory } from "lucide-react";

const parseDate = (s) => {
  const [y, m, d] = (s || "").slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const Row = ({ item }) => {
  const late = item.estado_prazo === "atrasada";
  const soon = item.estado_prazo === "proxima";
  const dias = item.dias_restantes;
  const dot = late ? "bg-red-500" : soon ? "bg-amber-500" : "bg-gray-300";
  const to = item.tipo === "encomenda" ? `/encomendas/${item.id}` : `/ordens-fabrico/${item.id}`;
  const Icon = item.tipo === "encomenda" ? Package : Factory;
  return (
    <Link
      to={to}
      data-testid={`prazo-row-${item.tipo}-${item.id}`}
      className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
    >
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
      <Icon size={15} className="text-gray-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 text-sm truncate">{item.numero}</span>
          {item.prioritaria && <Star size={13} className="text-amber-500 fill-amber-500 shrink-0" />}
          <span className="text-xs text-gray-400 uppercase tracking-wide">{item.tipo === "encomenda" ? "Encomenda" : "OF"}</span>
        </div>
        <div className="text-xs text-gray-500 truncate">{item.cliente || "—"} · {item.estado}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-sm font-medium tabular-nums ${late ? "text-red-600" : soon ? "text-amber-600" : "text-gray-700"}`}>
          {fmtDate(item.prazo_entrega)}
        </div>
        <div className={`text-xs ${late ? "text-red-500" : "text-gray-400"}`}>
          {dias === null || dias === undefined
            ? "—"
            : late
            ? `${Math.abs(dias)}d em atraso`
            : dias === 0
            ? "Hoje"
            : `Faltam ${dias}d`}
        </div>
      </div>
    </Link>
  );
};

const Group = ({ title, icon: Icon, accent, items, testid }) => (
  <div data-testid={testid} className="bg-white border border-gray-200 rounded-sm mb-4">
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
      {Icon && <Icon size={15} className={accent} />}
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-[0.08em]">{title}</h2>
      <span className="ml-auto text-xs font-medium text-gray-500 tabular-nums">{items.length}</span>
    </div>
    {items.length === 0 ? (
      <div className="px-4 py-6 text-center text-sm text-gray-400">Nada aqui.</div>
    ) : (
      items.map((it) => <Row key={`${it.tipo}-${it.id}`} item={it} />)
    )}
  </div>
);

export default function Calendario() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/prazos").then(setItems);
  }, []);

  const atrasadas = items.filter((i) => i.estado_prazo === "atrasada");
  const proximas = items.filter((i) => i.estado_prazo === "proxima");
  const futuras = items.filter((i) => i.estado_prazo === "futura");

  const modifiers = useMemo(() => ({
    atrasada: atrasadas.map((i) => parseDate(i.prazo_entrega)),
    proxima: proximas.map((i) => parseDate(i.prazo_entrega)),
    futura: futuras.map((i) => parseDate(i.prazo_entrega)),
  }), [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const modifiersClassNames = {
    atrasada: "bg-red-100 text-red-700 font-semibold rounded-sm",
    proxima: "bg-amber-100 text-amber-700 font-semibold rounded-sm",
    futura: "bg-gray-100 text-gray-700 rounded-sm",
  };

  const selectedKey = selected ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}` : null;
  const dayItems = selectedKey ? items.filter((i) => i.prazo_entrega === selectedKey) : [];

  return (
    <div>
      <PageHeader title="Calendário de Prazos" subtitle="Encomendas e ordens de fabrico por prazo de entrega" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <div className="bg-white border border-gray-200 rounded-sm p-2" data-testid="prazos-calendar">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setSelected}
              modifiers={modifiers}
              modifiersClassNames={modifiersClassNames}
              className="w-full"
            />
            <div className="flex flex-wrap gap-3 px-3 pb-3 pt-1 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Atrasado</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> ≤ 7 dias</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gray-400" /> Futuro</span>
            </div>
          </div>

          {selected && (
            <div className="bg-white border border-gray-200 rounded-sm mt-4" data-testid="prazos-day-detail">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
                <CalendarClock size={15} className="text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-700">{fmtDate(selectedKey)}</h2>
                <span className="ml-auto text-xs font-medium text-gray-500 tabular-nums">{dayItems.length}</span>
              </div>
              {dayItems.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">Sem prazos neste dia.</div>
              ) : (
                dayItems.map((it) => <Row key={`${it.tipo}-${it.id}`} item={it} />)
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <Group title="Atrasados" icon={AlertTriangle} accent="text-red-500" items={atrasadas} testid="group-atrasadas" />
          <Group title="Próximos 7 dias" icon={CalendarClock} accent="text-amber-500" items={proximas} testid="group-proximas" />
          <Group title="Futuros" icon={CalendarClock} accent="text-gray-400" items={futuras} testid="group-futuras" />
        </div>
      </div>
    </div>
  );
}
