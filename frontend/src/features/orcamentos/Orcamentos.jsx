import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import StatusBadge, { STATUS_META } from "@/components/StatusBadge";
import { useSort, SortTh } from "@/components/table";
import { Plus, Trash2, Copy, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLS = [
  { key: "rascunho", label: "Rascunho", dot: "bg-gray-400" },
  { key: "enviado", label: "Enviado", dot: "bg-indigo-500" },
  { key: "aceite", label: "Aceite", dot: "bg-emerald-500" },
  { key: "rejeitado", label: "Rejeitado", dot: "bg-red-500" },
];

export default function Orcamentos() {
  const { can } = useAuth();
  const [tab, setTab] = useState("abertos");
  const [view, setView] = useState("lista");
  const nav = useNavigate();
  const { sort, toggle, apply } = useSort();

  const statusParam = useMemo(() => {
    if (view === "kanban" || tab === "todos") return {};
    if (tab === "abertos") return { status: "rascunho,enviado" };
    return { status: tab };
  }, [tab, view]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel,
  } = useServerPagedList("/orcamentos", {
    extraParams: statusParam,
    paginate: view === "lista",
    pageSize: view === "kanban" ? 100 : 25,
  });

  const create = async () => {
    const o = await api.post("/orcamentos", {
      cliente: "Novo Cliente",
      status: "rascunho",
      linhas: [],
    });
    nav(`/orcamentos/${o.id}`);
  };

  const duplicar = async (e, id) => {
    e.stopPropagation();
    const o = await api.post(`/orcamentos/${id}/duplicar`);
    toast.success("Orçamento duplicado");
    nav(`/orcamentos/${o.id}`);
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/orcamentos/${id}`);
    toast.success("Orçamento eliminado");
    reload();
  };

  const rows = apply(items);

  const Tab = ({ id, label }) => {
    const active = tab === id;
    return (
      <button
        data-testid={`orc-tab-${id}`}
        onClick={() => setTab(id)}
        className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${active ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
      >
        {label}
        {active && (
          <span className="text-xs tabular-nums rounded-full px-1.5 py-0.5 bg-white/20">{total}</span>
        )}
      </button>
    );
  };

  const emptyMsg =
    tab === "abertos" ? "Sem orçamentos abertos." :
    tab === "aceite" ? "Sem orçamentos aceites." :
    tab === "rejeitado" ? "Sem orçamentos rejeitados." :
    "Sem orçamentos. Crie o primeiro.";

  return (
    <ListPage
      header={
        <PageHeader
          title="Orçamentos"
          subtitle="Propostas de preço com numeração sequencial automática"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="orcamentos" ids={items.map((o) => o.id)} />
              {can("orcamentos", "create") && (
                <button data-testid="new-orcamento-btn" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
                  <Plus size={16} /> Novo Orçamento
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={
        <>
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do nº, cliente ou referência..." testid="orcamentos-search" />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {view === "lista" && (
                <>
                  <Tab id="abertos" label="Abertos" />
                  <Tab id="aceite" label="Aceites" />
                  <Tab id="rejeitado" label="Rejeitados" />
                  <Tab id="todos" label="Todos" />
                </>
              )}
            </div>
            <div className="inline-flex rounded-sm border border-gray-300 overflow-hidden">
              <button data-testid="orc-view-lista" onClick={() => setView("lista")} title="Lista" className={`px-3 py-2 flex items-center gap-1.5 text-sm ${view === "lista" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                <List size={15} />
              </button>
              <button data-testid="orc-view-kanban" onClick={() => setView("kanban")} title="Kanban" className={`px-3 py-2 flex items-center gap-1.5 text-sm ${view === "kanban" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                <LayoutGrid size={15} />
              </button>
            </div>
          </div>
        </>
      }
      footer={
        view === "lista" ? (
          <>
            <ListPagination
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              rangeLabel={rangeLabel}
              testid="orcamentos-pagination"
            />
            {tab === "abertos" && (
              <div className="flex items-center gap-5 mt-3 text-xs text-gray-500 flex-wrap">
                {["rascunho", "enviado"].map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLS.find((c) => c.key === s)?.dot}`} />
                    {STATUS_META[s]?.label}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : null
      }
    >
      {view === "kanban" && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="orc-kanban">
          {STATUS_COLS.map((col) => {
            const cards = apply(items.filter((o) => o.status === col.key));
            return (
              <div key={col.key} data-testid={`orc-kanban-col-${col.key}`} className="bg-gray-50 border border-gray-200 rounded-sm p-3">
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} /> {col.label}
                  </span>
                  <span className="text-xs tabular-nums bg-white border border-gray-200 text-gray-500 rounded-full px-2 py-0.5">{cards.length}</span>
                </div>
                <div className="space-y-2.5">
                  {cards.map((o) => (
                    <div
                      key={o.id}
                      data-testid={`orc-kanban-card-${o.id}`}
                      onClick={() => nav(`/orcamentos/${o.id}`)}
                      className="bg-white border border-gray-200 rounded-sm p-3 cursor-pointer hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono tabular-nums font-semibold text-gray-900 text-sm">{o.numero}</span>
                        <span className="tabular-nums text-sm font-semibold text-gray-800">{eur(o.total)}</span>
                      </div>
                      <div className="text-sm text-gray-700 truncate mt-0.5">{o.cliente}</div>
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                        <span className="tabular-nums">{fmtDate(o.data)}</span>
                        {o.validade && <span className="tabular-nums">val. {fmtDate(o.validade)}</span>}
                      </div>
                      {o.numero_encomenda && (
                        <div className="mt-1.5 text-xs text-gray-500 mono truncate">Ref. {o.numero_encomenda}</div>
                      )}
                    </div>
                  ))}
                  {cards.length === 0 && <div className="text-xs text-gray-400 text-center py-6">Vazio</div>}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {view === "lista" && (
        <>
          <ScrollableTable className="hidden md:block">
            <table className="w-full text-sm min-w-[680px]">
              <thead className={TABLE_HEAD_STICKY}>
                <tr>
                  <SortTh label="Número" sortKey="numero" sort={sort} onSort={toggle} />
                  <SortTh label="Cliente" sortKey="cliente" sort={sort} onSort={toggle} />
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Ref. cliente</th>
                  <SortTh label="Data" sortKey="data" sort={sort} onSort={toggle} />
                  <SortTh label="Validade" sortKey="validade" sort={sort} onSort={toggle} />
                  <SortTh label="Total" sortKey="total" sort={sort} onSort={toggle} align="right" />
                  <SortTh label="Estado" sortKey="status" sort={sort} onSort={toggle} align="center" />
                  <th className="px-4 py-3 w-20 bg-gray-50"></th>
                </tr>
              </thead>
              <tbody data-testid="orcamentos-table">
                {rows.map((o) => (
                  <tr key={o.id} data-testid={`orcamento-row-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.numero}</td>
                    <td className="px-4 py-3 text-gray-700">{o.cliente}</td>
                    <td className="px-4 py-3 text-gray-500 mono text-xs">{o.numero_encomenda || "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(o.data)}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(o.validade)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(o.total)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {can("orcamentos", "create") && (
                          <button data-testid={`duplicate-orcamento-${o.id}`} onClick={(e) => duplicar(e, o.id)} title="Duplicar" className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500">
                            <Copy size={15} />
                          </button>
                        )}
                        {can("orcamentos", "delete") && (
                          <button data-testid={`delete-orcamento-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">{emptyMsg}</td></tr>
                )}
              </tbody>
            </table>
          </ScrollableTable>

          <div className="md:hidden flex-1 min-h-0 overflow-auto space-y-3" data-testid="orcamentos-cards">
            {rows.map((o) => (
              <div key={o.id} data-testid={`orcamento-card-${o.id}`} onClick={() => nav(`/orcamentos/${o.id}`)} className="bg-white border border-gray-200 rounded-sm p-4 cursor-pointer active:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mono tabular-nums font-semibold text-gray-900">{o.numero}</div>
                    <div className="text-gray-700 truncate">{o.cliente}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-500">
                    <div>{fmtDate(o.data)}{o.validade ? ` · val. ${fmtDate(o.validade)}` : ""}</div>
                    {o.numero_encomenda && <div className="mono mt-0.5">Ref. {o.numero_encomenda}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-semibold text-gray-900">{eur(o.total)}</span>
                    {can("orcamentos", "create") && (
                      <button data-testid={`duplicate-orcamento-mobile-${o.id}`} onClick={(e) => duplicar(e, o.id)} className="p-2 rounded-sm hover:bg-gray-100 text-gray-500">
                        <Copy size={16} />
                      </button>
                    )}
                    {can("orcamentos", "delete") && (
                      <button data-testid={`delete-orcamento-mobile-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-2 rounded-sm hover:bg-red-100 text-red-600">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">{emptyMsg}</div>
            )}
          </div>
        </>
      )}
    </ListPage>
  );
}
