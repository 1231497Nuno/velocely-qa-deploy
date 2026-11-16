import { useEffect, useMemo, useState } from "react";
import { ExtrasResumo } from "@/components/CamposPersonalizados";
import { useCampos, estiloCor } from "@/context/CamposContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, MobileCards, MobileCard, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { Plus, Pencil, Trash2, ArrowDown, ArrowUp, ArrowUpDown, Settings } from "lucide-react";
import { toast } from "sonner";
import ClienteDefaultConfig from "@/components/ClienteDefaultConfig";

function apiDetail(e) {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return typeof d === "string" ? d : null;
}

function SortTh({ label, field, sortBy, sortDir, onSort, testid, className = "" }) {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`text-left px-4 py-2.5 bg-gray-50 ${className}`}>
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

export default function Clientes() {
  const { corLinha } = useCampos();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [sortBy, setSortBy] = useState("nome");
  const [sortDir, setSortDir] = useState("asc");
  const extraParams = useMemo(() => ({ sort: sortBy, order: sortDir }), [sortBy, sortDir]);
  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/clientes", { extraParams });
  const [configOpen, setConfigOpen] = useState(false);

  const onSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  // Criar e editar seguem o mesmo padrão de artigos/fornecedores: página «Novo cliente» e ficha do cliente
  const openNew = () => nav("/clientes/novo");
  const openEdit = (c) => nav(`/clientes/${c.id}`, { state: { edit: true } });

  useEffect(() => {
    if (params.get("novo") !== "1") return;
    nav("/clientes/novo", { replace: true });
  }, [params, nav]);

  const remove = async (c) => {
    if (c.sistema) return toast.error("Não é possível eliminar o cliente de sistema");
    try {
      await api.del(`/clientes/${c.id}`);
      toast.success("Cliente eliminado");
      reload();
    } catch (e) {
      toast.error(apiDetail(e) || "Erro ao eliminar");
    }
  };

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Clientes"
          subtitle="Base de clientes para orçamentos, encomendas e ordens de fabrico"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="clientes" ids={items.map((c) => c.id)} />
              {can("clientes", "view") && (
                <button
                  type="button"
                  data-testid="clientes-config-btn"
                  onClick={() => setConfigOpen(true)}
                  className="border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Settings size={16} /> Configurações
                </button>
              )}
              {can("clientes", "create") && (
                <button data-testid="new-cliente-btn" onClick={openNew} className="btn btn-primario"><Plus size={16} /> Novo Cliente</button>
              )}
            </div>
          }
        />
      }
      toolbar={<SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do nome..." testid="clientes-search" />}
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="clientes-pagination"
        />
      }
    >
      <ScrollableTable className="hidden md:flex md:flex-col">
        <table className="w-full text-sm min-w-[780px] table-fixed">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <SortTh label="Código" field="codigo" sortBy={sortBy} sortDir={sortDir} onSort={onSort} testid="sort-codigo" className="w-[10%]" />
              <SortTh label="Nome" field="nome" sortBy={sortBy} sortDir={sortDir} onSort={onSort} testid="sort-nome" className="w-[24%]" />
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50 w-[10%]">Tipo</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50 w-[12%]">Cidade</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50 w-[12%]">Contacto</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50 w-[16%]">Email</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50 w-[10%]">NIF</th>
              <th className="px-4 py-2.5 w-[6%] bg-gray-50" />
            </tr>
          </thead>
          <tbody data-testid="clientes-table">
            {items.map((c) => (
              <tr style={estiloCor(corLinha("clientes", c))}
                key={c.id}
                data-testid={`cliente-row-${c.id}`}
                onClick={() => nav(`/clientes/${c.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-2.5 mono tabular-nums text-gray-600 text-xs whitespace-nowrap">{c.codigo || "—"}<ExtrasResumo modulo="clientes" registo={c} /></td>
                <td className="px-4 py-2.5 font-medium text-gray-900">
                  <span data-testid={`cliente-link-${c.id}`} className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                    <span className="truncate" title={c.nome}>{c.nome}</span>
                    {c.is_default && (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 px-1 py-0.5 rounded-sm">Default</span>
                    )}
                    {c.sistema && (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 px-1 py-0.5 rounded-sm">Sistema</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                  {(c.tipo === "empresa" || (!c.tipo && c.nif)) ? "Empresa" : "Particular"}
                </td>
                <td className="px-4 py-2.5 text-gray-600 truncate" title={c.cidade || ""}>{c.cidade || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 truncate" title={c.contacto || ""}>{c.contacto || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 truncate" title={c.email || ""}>{c.email || "—"}</td>
                <td className="px-4 py-2.5 text-gray-500 mono tabular-nums whitespace-nowrap">{c.nif || "—"}</td>
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {can("clientes", "edit") && <button data-testid={`edit-cliente-${c.id}`} onClick={(e) => { e.stopPropagation(); openEdit(c); }} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
                    {can("clientes", "delete") && !c.sistema && (
                      <button data-testid={`delete-cliente-${c.id}`} onClick={() => remove(c)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem clientes."}</td></tr>}
          </tbody>
        </table>
      </ScrollableTable>

      <MobileCards testid="clientes-cards">
        {items.map((c) => (
          <MobileCard style={estiloCor(corLinha("clientes", c))} key={c.id} testid={`cliente-card-${c.id}`} onClick={() => nav(`/clientes/${c.id}`)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate" title={c.nome}>{c.nome}</div>
                <div className="text-xs text-gray-500 mono mt-0.5">{c.codigo || "—"} · {(c.tipo === "empresa" || (!c.tipo && c.nif)) ? "Empresa" : "Particular"}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {can("clientes", "edit") && <button data-testid={`edit-cliente-mobile-${c.id}`} onClick={(e) => { e.stopPropagation(); openEdit(c); }} className="p-2 rounded-sm hover:bg-gray-100 text-gray-600"><Pencil size={16} /></button>}
                {can("clientes", "delete") && !c.sistema && (
                  <button data-testid={`delete-cliente-mobile-${c.id}`} onClick={() => remove(c)} className="p-2 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
            <div className="mt-2.5 text-xs text-gray-600 space-y-0.5">
              {(c.cidade || c.contacto) && <div className="truncate">{[c.cidade, c.contacto].filter(Boolean).join(" · ")}</div>}
              {c.email && <div className="truncate">{c.email}</div>}
              {c.nif && <div className="mono text-gray-500">NIF {c.nif}</div>}
            </div>
          </MobileCard>
        ))}
        {items.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem clientes."}</div>
        )}
      </MobileCards>
    </ListPage>


      <ClienteDefaultConfig open={configOpen} onOpenChange={setConfigOpen} onChanged={reload} />
    </>
  );
}
