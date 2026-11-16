import { useMemo, useState } from "react";
import { ExtrasResumo } from "@/components/CamposPersonalizados";
import { useCampos, estiloCor } from "@/context/CamposContext";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, MobileCards, MobileCard, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { Plus, Pencil, Trash2, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

function SortTh({ label, field, sortBy, sortDir, onSort, testid }) {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="text-left px-4 py-3">
      <button
        type="button"
        data-testid={testid}
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] transition-colors ${
          active ? "text-gray-900" : "text-gray-500 hover:text-gray-800"
        }`}
      >
        {label}
        <Icon size={13} className={active ? "text-gray-700" : "text-gray-400"} />
      </button>
    </th>
  );
}

export default function Fornecedores() {
  const { corLinha } = useCampos();
  const { can } = useAuth();
  const nav = useNavigate();
  const [sortBy, setSortBy] = useState("nome");
  const [sortDir, setSortDir] = useState("asc");
  const extraParams = useMemo(() => ({ sort: sortBy, order: sortDir }), [sortBy, sortDir]);
  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/fornecedores", { extraParams });

  const onSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  // Criar e editar seguem o mesmo padrão de artigos/clientes: página «Novo fornecedor» e ficha do fornecedor
  const openNew = () => nav("/fornecedores/novo");
  const openEdit = (e, f) => { e.stopPropagation(); nav(`/fornecedores/${f.id}`, { state: { edit: true } }); };

  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/fornecedores/${id}`);
    toast.success("Fornecedor eliminado");
    reload();
  };

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Fornecedores"
          subtitle="Base de fornecedores para compras e materiais"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="fornecedores" ids={items.map((f) => f.id)} />
              {can("fornecedores", "create") && (
                <button
                  data-testid="new-fornecedor-btn"
                  onClick={openNew}
                  className="btn btn-primario"
                >
                  <Plus size={16} /> Novo Fornecedor
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={<SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do nome..." testid="fornecedores-search" />}
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="fornecedores-pagination"
        />
      }
    >
      <ScrollableTable className="hidden md:flex md:flex-col">
        <table className="w-full text-sm min-w-[640px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <SortTh label="Código" field="codigo" sortBy={sortBy} sortDir={sortDir} onSort={onSort} testid="sort-fornecedor-codigo" />
              <SortTh label="Nome" field="nome" sortBy={sortBy} sortDir={sortDir} onSort={onSort} testid="sort-fornecedor-nome" />
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cidade</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Contacto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">NIF</th>
              <th className="px-4 py-3 w-24 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody data-testid="fornecedores-table">
            {items.map((f) => (
              <tr style={estiloCor(corLinha("fornecedores", f))}
                key={f.id}
                data-testid={`fornecedor-row-${f.id}`}
                onClick={() => nav(`/fornecedores/${f.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{f.codigo || "—"}<ExtrasResumo modulo="fornecedores" registo={f} /></td>
                <td className="px-4 py-3 font-medium text-gray-900">{f.nome}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">
                  {(f.tipo || (f.nif ? "empresa" : "particular")) === "empresa" ? "Empresa" : "Particular"}
                </td>
                <td className="px-4 py-3 text-gray-600">{f.cidade || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{f.contacto || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{f.email || "—"}</td>
                <td className="px-4 py-3 text-gray-500 mono">{f.nif || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("fornecedores", "edit") && (
                      <button data-testid={`edit-fornecedor-${f.id}`} onClick={(e) => openEdit(e, f)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600">
                        <Pencil size={15} />
                      </button>
                    )}
                    {can("fornecedores", "delete") && (
                      <button data-testid={`delete-fornecedor-${f.id}`} onClick={(e) => remove(e, f.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem fornecedores."}</td></tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <MobileCards testid="fornecedores-cards">
        {items.map((f) => (
          <MobileCard style={estiloCor(corLinha("fornecedores", f))} key={f.id} testid={`fornecedor-card-${f.id}`} onClick={() => nav(`/fornecedores/${f.id}`)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{f.nome}</div>
                <div className="text-xs text-gray-500 mono mt-0.5">
                  {f.codigo || "—"} · {(f.tipo || (f.nif ? "empresa" : "particular")) === "empresa" ? "Empresa" : "Particular"}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {can("fornecedores", "edit") && (
                  <button data-testid={`edit-fornecedor-mobile-${f.id}`} onClick={(e) => openEdit(e, f)} className="p-2 rounded-sm hover:bg-gray-100 text-gray-600"><Pencil size={16} /></button>
                )}
                {can("fornecedores", "delete") && (
                  <button data-testid={`delete-fornecedor-mobile-${f.id}`} onClick={(e) => remove(e, f.id)} className="p-2 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-600 space-y-0.5">
              {(f.cidade || f.contacto) && <div className="truncate">{[f.cidade, f.contacto].filter(Boolean).join(" · ")}</div>}
              {f.email && <div className="truncate">{f.email}</div>}
            </div>
          </MobileCard>
        ))}
        {items.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem fornecedores."}</div>
        )}
      </MobileCards>
    </ListPage>

    </>
  );
}
