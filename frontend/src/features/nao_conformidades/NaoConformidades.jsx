import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import StatusBadge from "@/components/StatusBadge";
import { Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { NC_TIPOS } from "@/features/nao_conformidades/AbrirNaoConformidadeDialog";

const ESTADOS = [
  { id: "", label: "Todos os estados" },
  { id: "aberta", label: "Aberta" },
  { id: "em_analise", label: "Em análise" },
  { id: "fechada", label: "Fechada" },
];

const TIPO_PT = Object.fromEntries(NC_TIPOS.map((t) => [t.id, t.label]));

export default function NaoConformidades() {
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
    q, setQ, reload, rangeLabel,
  } = useServerPagedList("/nao-conformidades", { extraParams });

  const remove = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Eliminar esta não conformidade?")) return;
    try {
      await api.del(`/nao-conformidades/${id}`);
      toast.success("Não conformidade eliminada");
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Erro ao eliminar");
    }
  };

  return (
    <ListPage
      header={
        <PageHeader
          title="Não conformidades"
          subtitle="Abertas a partir das referências das encomendas"
        />
      }
      toolbar={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo nº, encomenda ou referência..." testid="nc-search" />
          </div>
          <select
            data-testid="nc-filtro-estado"
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
          testid="nc-pagination"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[820px]" data-testid="nc-table">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Encomenda</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Referência</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                  Sem não conformidades. Abra-as a partir do artigo da encomenda.
                </td>
              </tr>
            ) : items.map((n) => (
              <tr
                key={n.id}
                data-testid={`nc-row-${n.id}`}
                onClick={() => nav(`/nao-conformidades/${n.id}`)}
                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-2.5 font-medium mono text-gray-900">{n.numero}</td>
                <td className="px-4 py-2.5 text-gray-700">{n.encomenda_numero || "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-gray-900 truncate max-w-[220px]">{n.artigo_codigo || n.artigo_nome || "—"}</div>
                  {n.artigo_codigo && n.artigo_nome ? <div className="text-xs text-gray-400 truncate max-w-[220px]">{n.artigo_nome}</div> : null}
                </td>
                <td className="px-4 py-2.5 text-gray-600">{TIPO_PT[n.tipo] || n.tipo}</td>
                <td className="px-4 py-2.5"><StatusBadge status={n.estado} /></td>
                <td className="px-4 py-2.5 text-gray-500">{fmtDate(n.created_at)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {can("nao_conformidades", "delete") && (
                      <button data-testid={`nc-del-${n.id}`} onClick={(e) => remove(e, n.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                    )}
                    <ChevronRight size={15} className="text-gray-300" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </ListPage>
  );
}
