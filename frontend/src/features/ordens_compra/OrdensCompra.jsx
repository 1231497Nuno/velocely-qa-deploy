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

const TIPO_DESPESA_LABEL = {
  compra: "Compra",
  despesa_normal: "Despesa",
  despesa_diversa: "Despesa diversa",
};

export default function OrdensCompra() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [tipoFilter, setTipoFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");

  const extraParams = useMemo(() => {
    const p = {};
    if (tipoFilter) p.tipo_despesa = tipoFilter;
    if (estadoFilter) p.estado = estadoFilter;
    return p;
  }, [tipoFilter, estadoFilter]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/ordens-compra", { extraParams });

  const create = async () => {
    try {
      const oc = await api.post("/ordens-compra", {
        assunto: "",
        tipo_despesa: "despesa_diversa",
        estado: "criada",
        linhas: [],
      });
      toast.success("Ordem de compra criada");
      nav(`/ordens-compra/${oc.id}`, { state: { edit: true } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao criar ordem");
    }
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/ordens-compra/${id}`);
    toast.success("Ordem eliminada");
    reload();
  };

  const Chip = ({ id, label }) => {
    const active = tipoFilter === id;
    return (
      <button
        type="button"
        data-testid={`oc-filtro-tipo-${id || "todas"}`}
        onClick={() => setTipoFilter(id)}
        className={`px-3 py-1.5 text-sm font-medium rounded-sm transition-colors ${
          active ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <ListPage
      header={
        <PageHeader
          title="Ordens de Compra"
          subtitle="Compras (stock/matéria-prima), despesas operacionais e despesas diversas"
          actions={
            can("ordens_compra", "create") && (
              <button
                data-testid="new-ordem-compra-btn"
                onClick={create}
                className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"
              >
                <Plus size={16} /> Nova Ordem
              </button>
            )
          }
        />
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip id="" label="Todas" />
            <Chip id="compra" label="Compra" />
            <Chip id="despesa_normal" label="Despesa" />
            <Chip id="despesa_diversa" label="Despesa diversa" />
            <select
              data-testid="oc-filtro-estado"
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="ml-auto text-sm border border-gray-300 rounded-sm px-2 py-1.5 bg-white"
            >
              <option value="">Todos os estados</option>
              <option value="criada">Criada</option>
              <option value="recebida">Recebida</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar código, assunto, fornecedor..." testid="ordens-compra-search" />
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
          testid="ordens-compra-pagination"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[800px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Fornecedor</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Assunto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Total</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody data-testid="ordens-compra-table">
            {items.map((o) => (
              <tr
                key={o.id}
                data-testid={`ordem-compra-row-${o.id}`}
                onClick={() => nav(`/ordens-compra/${o.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">
                  {o.codigo}
                  {o.codigo_origem && <div className="text-[11px] text-gray-400">{o.codigo_origem}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(o.data)}</td>
                <td className="px-4 py-3 text-gray-800">{o.fornecedor_nome || "—"}</td>
                <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate">{o.assunto || "—"}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">
                  <div>{TIPO_DESPESA_LABEL[o.tipo_despesa] || o.tipo_despesa}</div>
                  {o.tipo_compra && <div className="text-gray-400">{o.tipo_compra}</div>}
                </td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.estado} /></td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(o.total)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("ordens_compra", "delete") && (
                      <button
                        data-testid={`delete-ordem-compra-${o.id}`}
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
                  {loading ? "A carregar…" : "Sem ordens de compra."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </ListPage>
  );
}
