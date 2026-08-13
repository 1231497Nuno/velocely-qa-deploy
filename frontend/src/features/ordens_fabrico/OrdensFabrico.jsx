import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import StatusBadge from "@/components/StatusBadge";
import { Plus, Trash2, Star, LayoutGrid, List, UserCheck } from "lucide-react";
import { toast } from "sonner";

const TIMER_INFO = {
  por_iniciar: { color: "bg-gray-400", label: "Por iniciar" },
  em_curso: { color: "bg-emerald-500", label: "Em curso", pulse: true },
  em_pausa: { color: "bg-amber-400", label: "Em pausa" },
  concluido: { color: "bg-gray-300", label: "Concluída" },
};

const fmtDur = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
};

const elapsedSec = (o, nowMs) => {
  let total = 0;
  for (const it of o.itens || []) {
    for (const op of it.operacoes || []) {
      total += Number(op.tempo_real_seg) || 0;
      if (op.timer_inicio) {
        const start = new Date(op.timer_inicio).getTime();
        if (!isNaN(start)) total += Math.max(0, (nowMs - start) / 1000);
      }
    }
  }
  return total;
};

const TimerDot = ({ estado, liveSec }) => {
  const info = TIMER_INFO[estado] || TIMER_INFO.por_iniciar;
  return (
    <span data-testid={`timer-dot-${estado}`} className="inline-flex items-center gap-1.5" title={info.label}>
      <span className="relative flex h-2 w-2">
        {info.pulse && <span className={`absolute inline-flex h-full w-full rounded-full ${info.color} opacity-60 animate-ping`} />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${info.color}`} />
      </span>
      <span className="text-xs text-gray-600">{info.label}</span>
      {estado === "em_curso" && liveSec != null && (
        <span data-testid="timer-live" className="text-xs font-medium tabular-nums text-emerald-700">· {fmtDur(liveSec)}</span>
      )}
    </span>
  );
};

const KANBAN_COLS = [
  { key: "pendente", label: "Pendente", dot: "bg-gray-400" },
  { key: "em_producao", label: "Em Produção", dot: "bg-blue-500" },
  { key: "concluido", label: "Concluída", dot: "bg-emerald-500" },
];

export default function OrdensFabrico() {
  const { can, user } = useAuth();
  const [tab, setTab] = useState("ativas");
  const [view, setView] = useState("lista");
  const [mine, setMine] = useState(false);
  const [now, setNow] = useState(Date.now());
  const nav = useNavigate();

  const extra = useMemo(() => {
    const p = {};
    if (view === "lista") {
      if (tab === "ativas") p.status = "ne:concluido";
      else p.status = "concluido";
    }
    if (mine && user?.id) p.responsavel_id = user.id;
    return p;
  }, [tab, view, mine, user?.id]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel,
  } = useServerPagedList("/ordens-fabrico", {
    extraParams: extra,
    paginate: view === "lista",
  });

  const hasRunning = items.some((o) => o.timer_estado === "em_curso");
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasRunning]);

  const create = async () => {
    const of = await api.post("/ordens-fabrico", { cliente: "Novo Cliente", status: "pendente", itens: [] });
    nav(`/ordens-fabrico/${of.id}`);
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/ordens-fabrico/${id}`);
    toast.success("OF eliminada");
    reload();
  };

  const togglePrioridade = async (e, o) => {
    e.stopPropagation();
    await api.post(`/ordens-fabrico/${o.id}/prioridade`, { prioritaria: !o.prioritaria });
    reload();
  };

  const rows = items;
  const hoje = new Date().toISOString().slice(0, 10);

  const Tab = ({ id, label }) => {
    const active = tab === id;
    return (
      <button
        data-testid={`of-tab-${id}`}
        onClick={() => setTab(id)}
        className={`px-3 py-1.5 text-sm font-medium rounded-sm flex items-center gap-1.5 transition-colors ${active ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
      >
        {label}
        {active && (
          <span className="text-[11px] tabular-nums rounded-full px-1.5 py-0.5 bg-white/20">{total}</span>
        )}
      </button>
    );
  };

  return (
    <ListPage
      header={
        <PageHeader
          title="Ordens de Fabrico"
          subtitle="Produção com roteiro de operações para o operador"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="ordens_fabrico" ids={rows.map((o) => o.id)} />
              {can("ordens_fabrico", "create") && (
                <button data-testid="new-of-btn" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
                  <Plus size={16} /> Nova OF
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={
        <div className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do nº, cliente ou encomenda..." testid="ofs-search" />
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                data-testid="of-filter-minhas"
                onClick={() => setMine((m) => !m)}
                className={`px-3 py-1.5 text-sm font-medium rounded-sm flex items-center gap-1.5 border transition-colors ${mine ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
              >
                <UserCheck size={14} /> As minhas
              </button>
              <div className="inline-flex rounded-sm border border-gray-300 overflow-hidden">
                <button data-testid="of-view-lista" onClick={() => setView("lista")} title="Lista" className={`px-2.5 py-1.5 flex items-center ${view === "lista" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}><List size={15} /></button>
                <button data-testid="of-view-kanban" onClick={() => setView("kanban")} title="Kanban" className={`px-2.5 py-1.5 flex items-center ${view === "kanban" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}><LayoutGrid size={15} /></button>
              </div>
            </div>
          </div>
          {view === "lista" && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Tab id="ativas" label="Ativas" />
                <Tab id="concluidas" label="Concluídas" />
              </div>
              {tab === "ativas" && (
                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" /> Por iniciar</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Em curso</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Em pausa</span>
                </div>
              )}
            </div>
          )}
        </div>
      }
      footer={
        view === "lista" ? (
          <ListPagination
            page={page}
            pages={pages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rangeLabel={rangeLabel}
            testid="ofs-pagination"
          />
        ) : null
      }
    >
      {view === "kanban" ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-y-auto md:overflow-hidden" data-testid="of-kanban">
          {KANBAN_COLS.map((col) => {
            const cards = items.filter((o) => o.status === col.key);
            return (
              <div
                key={col.key}
                data-testid={`kanban-col-${col.key}`}
                className="bg-white border border-gray-200 rounded-sm flex flex-col min-h-[220px] md:min-h-0 md:h-full overflow-hidden"
              >
                <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-700 flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} /> {col.label}
                  </span>
                  <span className="text-xs tabular-nums font-semibold text-gray-500">{cards.length}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
                  {cards.map((o) => (
                    <div
                      key={o.id}
                      data-testid={`kanban-card-${o.id}`}
                      onClick={() => nav(`/ordens-fabrico/${o.id}`)}
                      className={`bg-white border rounded-sm p-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${o.prioritaria ? "border-amber-300 bg-amber-50/40" : "border-gray-200"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono tabular-nums font-semibold text-gray-900 text-sm">{o.numero}</span>
                        {o.prioritaria && <Star size={13} className="fill-amber-400 text-amber-500 shrink-0" />}
                      </div>
                      <div className="text-sm text-gray-700 truncate mt-0.5">{o.cliente}</div>
                      <div className="flex items-center justify-between mt-1.5 text-xs text-gray-500">
                        <span className="tabular-nums">{Math.round(o.progresso || 0)}%</span>
                        {o.prazo_entrega && (
                          <span className={`tabular-nums ${o.prazo_entrega < hoje && o.status !== "concluido" ? "text-red-600 font-medium" : ""}`}>
                            {fmtDate(o.prazo_entrega)}
                          </span>
                        )}
                      </div>
                      {o.responsavel_nome && (
                        <div className="mt-1.5 text-[11px] text-gray-500 flex items-center gap-1 truncate">
                          <UserCheck size={11} /> {o.responsavel_nome}
                        </div>
                      )}
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-8">Vazio</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <ScrollableTable className="hidden md:flex md:flex-col">
            <table className="w-full text-sm min-w-[760px]">
              <thead className={TABLE_HEAD_STICKY}>
                <tr>
                  <th className="px-2 py-2.5 w-10 bg-gray-50"></th>
                  {tab === "ativas" && <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cronómetro</th>}
                  <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº Enc.</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Prazo</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Origem</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Progresso</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
                  <th className="px-3 py-2.5 w-12 bg-gray-50"></th>
                </tr>
              </thead>
              <tbody data-testid="ofs-table">
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    data-testid={`of-row-${o.id}`}
                    onClick={() => nav(`/ordens-fabrico/${o.id}`)}
                    className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${o.prioritaria ? "bg-amber-50/60" : ""}`}
                  >
                    <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <button data-testid={`of-prioridade-${o.id}`} onClick={(e) => togglePrioridade(e, o)} title={o.prioritaria ? "Prioritária" : "Marcar como prioritária"} className="p-1 rounded-sm hover:bg-amber-100">
                        <Star size={15} className={o.prioritaria ? "text-amber-500 fill-amber-400" : "text-gray-300"} />
                      </button>
                    </td>
                    {tab === "ativas" && (
                      <td className="px-3 py-2">
                        <TimerDot estado={o.timer_estado} liveSec={o.timer_estado === "em_curso" ? elapsedSec(o, now) : null} />
                      </td>
                    )}
                    <td className="px-3 py-2 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                    <td className="px-3 py-2 text-gray-700">{o.cliente}</td>
                    <td className="px-3 py-2 text-gray-500 mono text-xs">{o.numero_encomenda || "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-600">{fmtDate(o.data)}</td>
                    <td className="px-3 py-2 tabular-nums" data-testid={`of-prazo-${o.id}`}>
                      {o.prazo_entrega ? (
                        <span className={o.prazo_entrega < hoje && o.status !== "concluido" ? "text-red-600 font-medium" : "text-gray-600"}>{fmtDate(o.prazo_entrega)}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 mono text-gray-500 text-xs">{o.orcamento_numero || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{Math.round(o.progresso || 0)}%</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={o.status} /></td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {can("ordens_fabrico", "delete") && (
                        <button data-testid={`delete-of-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={tab === "ativas" ? 11 : 10} className="px-4 py-10 text-center text-gray-400 text-sm">
                      {tab === "ativas" ? "Sem ordens de fabrico ativas." : "Sem ordens de fabrico concluídas."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollableTable>

          <div className="md:hidden flex-1 min-h-0 overflow-auto space-y-2" data-testid="ofs-cards">
            {rows.map((o) => (
              <div
                key={o.id}
                data-testid={`of-card-${o.id}`}
                onClick={() => nav(`/ordens-fabrico/${o.id}`)}
                className={`bg-white border border-gray-200 rounded-sm p-3 cursor-pointer active:bg-gray-50 ${o.prioritaria ? "border-amber-300 bg-amber-50/40" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-1.5">
                    <button data-testid={`of-prioridade-mobile-${o.id}`} onClick={(e) => togglePrioridade(e, o)} className="p-1 -ml-1">
                      <Star size={15} className={o.prioritaria ? "text-amber-500 fill-amber-400" : "text-gray-300"} />
                    </button>
                    <div className="min-w-0">
                      <div className="mono tabular-nums font-semibold text-gray-900 text-sm">{o.numero}</div>
                      <div className="text-sm text-gray-700 truncate">{o.cliente}</div>
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                {tab === "ativas" && (
                  <div className="mt-2">
                    <TimerDot estado={o.timer_estado} liveSec={o.timer_estado === "em_curso" ? elapsedSec(o, now) : null} />
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                  <div className="text-xs text-gray-500">
                    <div>{fmtDate(o.data)} · {Math.round(o.progresso || 0)}%</div>
                    {o.prazo_entrega && (
                      <div className={`mt-0.5 ${o.prazo_entrega < hoje && o.status !== "concluido" ? "text-red-600 font-medium" : ""}`}>
                        Entrega: {fmtDate(o.prazo_entrega)}
                      </div>
                    )}
                  </div>
                  {can("ordens_fabrico", "delete") && (
                    <button data-testid={`delete-of-mobile-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">
                {tab === "ativas" ? "Sem ordens de fabrico ativas." : "Sem ordens de fabrico concluídas."}
              </div>
            )}
          </div>
        </div>
      )}
    </ListPage>
  );
}
