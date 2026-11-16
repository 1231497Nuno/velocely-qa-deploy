import { useMemo, useState } from "react";
import { useSort, SortTh } from "@/components/table";
import ExportExcelButton from "@/components/ExportExcelButton";
import { ExtrasResumo } from "@/components/CamposPersonalizados";
import { useCampos, estiloCor } from "@/context/CamposContext";
import { FiltroChip, FiltroGrupo } from "@/components/Filtros";
import { useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, MobileCards, MobileCard, TABLE_HEAD_STICKY } from "@/components/ListPage";
import MobileFiltersButton from "@/components/MobileFiltersButton";
import StatusBadge from "@/components/StatusBadge";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const ESTADOS = [
  { id: "", label: "Todos os estados" },
  { id: "rascunho", label: "Rascunho" },
  { id: "enviado", label: "Enviado" },
  { id: "respondido", label: "Respondido" },
  { id: "adjudicado", label: "Adjudicado" },
  { id: "cancelado", label: "Cancelado" },
];

export default function PedidosCotacao() {
  const { corLinha } = useCampos();
  const confirmAction = useConfirm();
  const { can } = useAuth();
  const nav = useNavigate();
  const [estadoFilter, setEstadoFilter] = useState("");

  const extraParams = useMemo(() => {
    const p = {};
    if (estadoFilter) p.estado = estadoFilter;
    return p;
  }, [estadoFilter]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/pedidos-cotacao", { extraParams });
  const { sort, toggle, apply } = useSort();
  const sortedItems = apply(items);

  const create = async () => {
    try {
      const pc = await api.post("/pedidos-cotacao", {
        assunto: "",
        estado: "rascunho",
        linhas: [],
      });
      toast.success("Pedido de cotação criado");
      nav(`/pedidos-cotacao/${pc.id}`, { state: { edit: true } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao criar pedido");
    }
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    if (!await confirmAction({ title: "Eliminar pedido", description: "Este pedido de cotação é eliminado.", confirmLabel: "Eliminar", tone: "danger" })) return;
    try {
      await api.del(`/pedidos-cotacao/${id}`);
      toast.success("Pedido eliminado");
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Erro ao eliminar");
    }
  };

  return (
    <ListPage
      header={
        <PageHeader
          title="Pedidos de Cotação"
          subtitle="Pedidos de cotação a fornecedores"
          actions={
            <>
              <ExportExcelButton entity="pedidos_cotacao" ids={items.map((x) => x.id)} />
              {can("pedidos_cotacao", "create") && (
                <button
                  data-testid="new-pedido-cotacao-btn"
                  onClick={create}
                  className="btn btn-primario"
                >
                  <Plus size={16} /> Novo pedido
                </button>
              )}
            </>
          }
        />
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do código, assunto ou fornecedor..." testid="pedidos-cotacao-search" />
          <MobileFiltersButton
            testid="pedidos-cotacao-filtros"
            activeCount={estadoFilter ? 1 : 0}
            onClear={() => setEstadoFilter("")}
            title="Filtrar pedidos"
            description="Estado do pedido de cotação."
          >
            {({ mobile }) => (
              <FiltroGrupo mobile={mobile}>
                {ESTADOS.map((e) => (
                  <FiltroChip key={e.id || "all"} active={estadoFilter === e.id} onClick={() => setEstadoFilter(e.id)} count={total} testid={`pc-filtro-estado-${e.id || "todos"}`}>
                    {e.id ? e.label : "Todos"}
                  </FiltroChip>
                ))}
              </FiltroGrupo>
            )}
          </MobileFiltersButton>
        </div>
      }
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="pedidos-cotacao-pagination"
        />
      }
    >
      <ScrollableTable className="hidden md:flex md:flex-col">
        <table className="w-full text-sm min-w-[780px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <SortTh label="Código" sortKey="codigo" sort={sort} onSort={toggle} align="left" />
              <SortTh label="Data" sortKey="data" sort={sort} onSort={toggle} align="left" />
              <SortTh label="Fornecedor" sortKey="fornecedor_nome" sort={sort} onSort={toggle} align="left" />
              <SortTh label="Assunto" sortKey="assunto" sort={sort} onSort={toggle} align="left" />
              <SortTh label="Prazo" sortKey="prazo_resposta" sort={sort} onSort={toggle} align="left" />
              <SortTh label="Estado" sortKey="estado" sort={sort} onSort={toggle} align="center" />
              <SortTh label="Valor cotado" sortKey="valor_cotado" sort={sort} onSort={toggle} align="right" />
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody data-testid="pedidos-cotacao-table">
            {sortedItems.map((o) => (
              <tr style={estiloCor(corLinha("pedidos_cotacao", o))}
                key={o.id}
                data-testid={`pedido-cotacao-row-${o.id}`}
                onClick={() => nav(`/pedidos-cotacao/${o.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.codigo}<ExtrasResumo modulo="pedidos_cotacao" registo={o} /></td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                <td className="px-4 py-3 text-gray-800">{o.fornecedor_nome || "—"}</td>
                <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate">{o.assunto || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(o.prazo_resposta) || "—"}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.estado} /></td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {o.valor_cotado != null ? eur(o.valor_cotado) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("pedidos_cotacao", "delete") && o.estado !== "adjudicado" && (
                      <button
                        data-testid={`delete-pedido-cotacao-${o.id}`}
                        onClick={(e) => remove(e, o.id)}
                        className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {loading ? "A carregar…" : "Sem pedidos de cotação."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <MobileCards testid="pedidos-cotacao-cards">
        {sortedItems.map((o) => (
          <MobileCard style={estiloCor(corLinha("pedidos_cotacao", o))} key={o.id} testid={`pedido-cotacao-card-${o.id}`} onClick={() => nav(`/pedidos-cotacao/${o.id}`)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="mono font-semibold text-gray-900">{o.codigo}</div>
                <div className="text-sm text-gray-700 truncate mt-0.5">{o.fornecedor_nome || "—"}</div>
                {o.assunto && <div className="text-xs text-gray-500 truncate mt-0.5">{o.assunto}</div>}
              </div>
              <StatusBadge status={o.estado} />
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 gap-2">
              <div className="text-xs text-gray-500">{fmtDate(o.data)}{o.prazo_resposta ? ` · prazo ${fmtDate(o.prazo_resposta)}` : ""}</div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="tabular-nums font-semibold">{o.valor_cotado != null ? eur(o.valor_cotado) : "—"}</span>
                {can("pedidos_cotacao", "delete") && o.estado !== "adjudicado" && (
                  <button data-testid={`delete-pedido-cotacao-mobile-${o.id}`} onClick={(e) => remove(e, o.id)} className="p-2 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
          </MobileCard>
        ))}
        {items.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem pedidos de cotação."}</div>
        )}
      </MobileCards>
    </ListPage>
  );
}
