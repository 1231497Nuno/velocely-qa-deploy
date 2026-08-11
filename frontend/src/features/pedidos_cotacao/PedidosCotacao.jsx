import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
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
    if (!window.confirm("Eliminar este pedido de cotação?")) return;
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
            can("pedidos_cotacao", "create") && (
              <button
                data-testid="new-pedido-cotacao-btn"
                onClick={create}
                className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"
              >
                <Plus size={16} /> Novo pedido
              </button>
            )
          }
        />
      }
      toolbar={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do código, assunto ou fornecedor..." testid="pedidos-cotacao-search" />
          </div>
          <select
            data-testid="pc-filtro-estado"
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-sm px-2 py-1.5 bg-white shrink-0"
          >
            {ESTADOS.map((e) => (
              <option key={e.id || "all"} value={e.id}>{e.label}</option>
            ))}
          </select>
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
      <ScrollableTable>
        <table className="w-full text-sm min-w-[780px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Fornecedor</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Assunto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Prazo</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor cotado</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody data-testid="pedidos-cotacao-table">
            {items.map((o) => (
              <tr
                key={o.id}
                data-testid={`pedido-cotacao-row-${o.id}`}
                onClick={() => nav(`/pedidos-cotacao/${o.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{o.codigo}</td>
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
    </ListPage>
  );
}
