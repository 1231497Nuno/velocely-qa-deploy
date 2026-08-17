import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { Plus, Pencil, Trash2, ArrowDown, ArrowUp, ArrowUpDown, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import ClienteDefaultConfig from "@/components/ClienteDefaultConfig";

const empty = { nome: "", tipo: "empresa", morada: "", codigo_postal: "", cidade: "", pais: "Portugal", contacto: "", email: "", nif: "", notas: "", responsavel: "" };

function apiDetail(e) {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return typeof d === "string" ? d : null;
}

function validarFormCliente(form) {
  if (!form.nome.trim()) return "Nome obrigatório";
  if (form.tipo !== "empresa") return null;
  const faltam = [];
  if (!form.nif.trim()) faltam.push("NIF");
  if (!form.morada.trim()) faltam.push("morada");
  if (!form.codigo_postal.trim()) faltam.push("código postal");
  if (!form.cidade.trim()) faltam.push("cidade");
  if (!form.contacto.trim()) faltam.push("contacto");
  if (!form.email.trim()) faltam.push("email");
  if (faltam.length) return "Para empresas são obrigatórios: " + faltam.join(", ");
  return null;
}

function FieldLabel({ children, required }) {
  return (
    <label className="text-sm font-medium text-gray-700 mb-1.5 block">
      {children}
      {required ? <span className="text-red-600"> *</span> : null}
    </label>
  );
}

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

export default function Clientes() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [sortBy, setSortBy] = useState("nome");
  const [sortDir, setSortDir] = useState("asc");
  const extraParams = useMemo(() => ({ sort: sortBy, order: sortDir }), [sortBy, sortDir]);
  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/clientes", { extraParams });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [configOpen, setConfigOpen] = useState(false);

  const onSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  const openNew = () => { setForm(empty); setEditId(null); setOpen(true); };
  const openEdit = (c) => {
    setForm({
      nome: c.nome,
      tipo: c.tipo === "cliente_final" ? "particular" : (c.tipo || (c.nif ? "empresa" : "particular")),
      morada: c.morada || "",
      codigo_postal: c.codigo_postal || "",
      cidade: c.cidade || "",
      pais: c.pais || "Portugal",
      contacto: c.contacto || "",
      email: c.email || "",
      nif: c.nif || "",
      notas: c.notas || "",
      responsavel: c.responsavel || "",
    });
    setEditId(c.id);
    setOpen(true);
  };
  const save = async () => {
    const err = validarFormCliente(form);
    if (err) return toast.error(err);
    try {
      if (editId) await api.put(`/clientes/${editId}`, form);
      else await api.post("/clientes", form);
      toast.success("Cliente guardado");
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(apiDetail(e) || "Erro ao guardar cliente");
    }
  };
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
                <button data-testid="new-cliente-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Novo Cliente</button>
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
      <ScrollableTable>
        <table className="w-full text-sm min-w-[640px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <SortTh label="Código" field="codigo" sortBy={sortBy} sortDir={sortDir} onSort={onSort} testid="sort-codigo" />
              <SortTh label="Nome" field="nome" sortBy={sortBy} sortDir={sortDir} onSort={onSort} testid="sort-nome" />
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cidade</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Contacto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">NIF</th>
              <th className="px-4 py-3 w-24 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody data-testid="clientes-table">
            {items.map((c) => (
              <tr
                key={c.id}
                data-testid={`cliente-row-${c.id}`}
                onClick={() => nav(`/clientes/${c.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{c.codigo || "—"}</td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  <span data-testid={`cliente-link-${c.id}`} className="inline-flex items-center gap-1.5">
                    {c.nome}
                    {c.is_default && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 px-1 py-0.5 rounded-sm">Default</span>
                    )}
                    {c.sistema && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 px-1 py-0.5 rounded-sm">Sistema</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">
                  {(c.tipo === "empresa" || (!c.tipo && c.nif)) ? "Empresa" : "Particular"}
                </td>
                <td className="px-4 py-3 text-gray-600">{c.cidade || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{c.contacto || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{c.email || "—"}</td>
                <td className="px-4 py-3 text-gray-500 mono">{c.nif || "—"}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {can("clientes", "edit") && <button data-testid={`edit-cliente-${c.id}`} onClick={() => openEdit(c)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
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
    </ListPage>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Cliente" : "Novo Cliente"}</DialogTitle>
            <DialogDescription>Dados do cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Tipo</label>
              <div className="grid grid-cols-2 gap-2" data-testid="cliente-tipo-group">
                {[
                  { value: "empresa", label: "Empresa" },
                  { value: "particular", label: "Particular" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`cliente-tipo-${opt.value}`}
                    onClick={() => setForm({ ...form, tipo: opt.value })}
                    className={`rounded-sm px-3 py-2 text-sm font-medium border transition-colors ${
                      form.tipo === opt.value
                        ? "bg-black text-white border-black"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                {form.tipo === "empresa"
                  ? "Empresa: nome, NIF, morada, código postal, cidade, contacto e email obrigatórios."
                  : "Particular: nome obrigatório; restantes campos opcionais (NIF pode ficar vazio)."}
              </p>
            </div>
            <div>
              <FieldLabel required>Nome</FieldLabel>
              <input data-testid="cliente-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel required={form.tipo === "empresa"}>Contacto</FieldLabel>
                <input data-testid="cliente-contacto-input" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <FieldLabel required={form.tipo === "empresa"}>Email</FieldLabel>
                <input data-testid="cliente-email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel required={form.tipo === "empresa"}>Morada</FieldLabel>
                <input data-testid="cliente-morada-input" value={form.morada} onChange={(e) => setForm({ ...form, morada: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <FieldLabel required={form.tipo === "empresa"}>
                  NIF {form.tipo === "particular" ? <span className="text-gray-400 font-normal">(opcional)</span> : null}
                </FieldLabel>
                <input data-testid="cliente-nif-input" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} placeholder={form.tipo === "particular" ? "Deixar vazio = sem NIF" : ""} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <FieldLabel required={form.tipo === "empresa"}>Código Postal</FieldLabel>
                <input data-testid="cliente-cp-input" value={form.codigo_postal} onChange={(e) => setForm({ ...form, codigo_postal: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <FieldLabel required={form.tipo === "empresa"}>Cidade</FieldLabel>
                <input data-testid="cliente-cidade-input" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <FieldLabel>País</FieldLabel>
                <input data-testid="cliente-pais-input" value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Responsável</label>
              <input data-testid="cliente-responsavel-input" value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Notas</label>
              <textarea data-testid="cliente-notas-input" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-cliente-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClienteDefaultConfig open={configOpen} onOpenChange={setConfigOpen} onChanged={reload} />
    </>
  );
}
