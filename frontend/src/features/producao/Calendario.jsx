import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import { Calendar } from "@/components/ui/calendar";
import ListPagination from "@/components/ListPagination";
import { ListPage } from "@/components/ListPage";
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
      className="flex items-center gap-2.5 px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
    >
      <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
      <Icon size={14} className="text-gray-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium text-gray-900 text-sm truncate">{item.numero}</span>
          {item.prioritaria && <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />}
          <span className="text-[10px] text-gray-400 uppercase tracking-wide shrink-0">
            {item.tipo === "encomenda" ? "Enc" : "OF"}
          </span>
        </div>
        <div className="text-xs text-gray-500 truncate">{item.cliente || "—"} · {item.estado}</div>
      </div>
      <div className="text-right shrink-0 pl-2">
        <div className={`text-xs font-medium tabular-nums ${late ? "text-red-600" : soon ? "text-amber-600" : "text-gray-700"}`}>
          {fmtDate(item.prazo_entrega)}
        </div>
        <div className={`text-[11px] ${late ? "text-red-500" : "text-gray-400"}`}>
          {dias === null || dias === undefined
            ? "—"
            : late
            ? `${Math.abs(dias)}d atraso`
            : dias === 0
            ? "Hoje"
            : `${dias}d`}
        </div>
      </div>
    </Link>
  );
};

const GROUP_PAGE_SIZES = [10, 25, 50];

const Group = ({ title, icon: Icon, accent, bar, items, testid }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => { setPage(1); }, [items]);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pages);
  const pageItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeLabel =
    total === 0
      ? "0 resultados"
      : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, total)} de ${total}`;

  return (
    <div
      data-testid={testid}
      className="bg-white border border-gray-200 rounded-sm flex flex-col min-h-[200px] lg:min-h-0 flex-1 overflow-hidden"
    >
      <div className={`shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 border-l-2 ${bar}`}>
        {Icon && <Icon size={14} className={accent} />}
        <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-[0.08em]">{title}</h2>
        <span className={`ml-auto text-xs font-semibold tabular-nums ${accent}`}>{total}</span>
      </div>
      {total === 0 ? (
        <div className="flex-1 flex items-center justify-center px-3 py-4 text-sm text-gray-400">Nada aqui.</div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-auto">
            {pageItems.map((it) => <Row key={`${it.tipo}-${it.id}`} item={it} />)}
          </div>
          <div className="shrink-0 border-t border-gray-100 px-2">
            <ListPagination
              compact
              page={safePage}
              pages={pages}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={GROUP_PAGE_SIZES}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              rangeLabel={rangeLabel}
              testid={`${testid}-pagination`}
            />
          </div>
        </>
      )}
    </div>
  );
};

function StatChip({ label, count, tone }) {
  const tones = {
    red: "bg-red-50 text-red-700 border-red-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    gray: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return (
    <div className={`inline-flex items-center gap-2 border rounded-sm px-2.5 py-1.5 text-xs ${tones[tone]}`}>
      <span className="font-semibold tabular-nums text-sm">{count}</span>
      <span className="opacity-80">{label}</span>
    </div>
  );
}

export default function Calendario() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => setItems(await api.get("/prazos")), []);
  useEffect(() => {
    load();
  }, [load]);

  const atrasadas = useMemo(() => items.filter((i) => i.estado_prazo === "atrasada"), [items]);
  const proximas = useMemo(() => items.filter((i) => i.estado_prazo === "proxima"), [items]);
  const futuras = useMemo(() => items.filter((i) => i.estado_prazo === "futura"), [items]);

  const modifiers = useMemo(() => ({
    atrasada: atrasadas.map((i) => parseDate(i.prazo_entrega)),
    proxima: proximas.map((i) => parseDate(i.prazo_entrega)),
    futura: futuras.map((i) => parseDate(i.prazo_entrega)),
  }), [atrasadas, proximas, futuras]);

  const modifiersClassNames = {
    atrasada: "bg-red-100 text-red-700 font-semibold rounded-sm",
    proxima: "bg-amber-100 text-amber-700 font-semibold rounded-sm",
    futura: "bg-gray-100 text-gray-700 rounded-sm",
  };

  const selectedKey = selected
    ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`
    : null;
  const dayItems = selectedKey ? items.filter((i) => i.prazo_entrega === selectedKey) : [];

  return (
    <ListPage
      header={
        <div>
          <PageHeader title="Calendário de Prazos" subtitle="Encomendas e ordens de fabrico por prazo de entrega" />
          <div className="flex flex-wrap gap-2 mb-3">
            <StatChip label="Atrasados" count={atrasadas.length} tone="red" />
            <StatChip label="Próximos 7 dias" count={proximas.length} tone="amber" />
            <StatChip label="Futuros" count={futuras.length} tone="gray" />
          </div>
        </div>
      }
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-y-auto lg:overflow-hidden">
        {/* Calendário + dia seleccionado */}
        <div className="lg:col-span-4 xl:col-span-3 flex flex-col min-h-0 gap-3 lg:h-full">
          <div className="bg-white border border-gray-200 rounded-sm shrink-0" data-testid="prazos-calendar">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setSelected}
              modifiers={modifiers}
              modifiersClassNames={modifiersClassNames}
              className="w-full"
            />
            <div className="flex flex-wrap gap-3 px-3 pb-3 text-xs text-gray-500 border-t border-gray-100 mt-1 pt-2">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Atrasado</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> ≤ 7 dias</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gray-400" /> Futuro</span>
            </div>
          </div>

          <div
            className="bg-white border border-gray-200 rounded-sm flex flex-col min-h-[160px] lg:min-h-0 flex-1 overflow-hidden"
            data-testid="prazos-day-detail"
          >
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
              <CalendarClock size={14} className="text-gray-500" />
              <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-[0.08em]">
                {selectedKey ? fmtDate(selectedKey) : "Dia seleccionado"}
              </h2>
              {selectedKey && (
                <span className="ml-auto text-xs font-semibold tabular-nums text-gray-500">{dayItems.length}</span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {!selectedKey ? (
                <div className="px-3 py-8 text-center text-sm text-gray-400">
                  Selecciona um dia no calendário.
                </div>
              ) : dayItems.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-gray-400">Sem prazos neste dia.</div>
              ) : (
                dayItems.map((it) => <Row key={`${it.tipo}-${it.id}`} item={it} />)
              )}
            </div>
          </div>
        </div>

        {/* Listas com altura fixa partilhada */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col min-h-0 gap-3 lg:h-full">
          <Group
            title="Atrasados"
            icon={AlertTriangle}
            accent="text-red-600"
            bar="border-l-red-500"
            items={atrasadas}
            testid="group-atrasadas"
          />
          <Group
            title="Próximos 7 dias"
            icon={CalendarClock}
            accent="text-amber-600"
            bar="border-l-amber-500"
            items={proximas}
            testid="group-proximas"
          />
          <Group
            title="Futuros"
            icon={CalendarClock}
            accent="text-gray-500"
            bar="border-l-gray-300"
            items={futuras}
            testid="group-futuras"
          />
        </div>
      </div>
    </ListPage>
  );
}
