import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import BlocosShell, { FieldGrid, FieldRow } from "@/components/BlocosShell";
import { Plus, Pencil, Trash2, ArrowDown, ArrowUp, ArrowUpDown, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import ClienteDefaultConfig from "@/components/ClienteDefaultConfig";

const empty = {
  nome: "", tipo: "empresa", morada: "", codigo_postal: "", cidade: "", pais: "Portugal",
  contacto: "", email: "", nif: "", notas: "", responsavel: "",
  condicoes_pagamento: "", desconto_comercial_pct: "", limite_credito: "",
  contactos: [],
};

const FORM_BLOCOS = [
  { id: "tipo", label: "Tipo" },
  { id: "identificacao", label: "Identificação" },
  { id: "morada", label: "Morada" },
  { id: "contacto", label: "Contacto geral" },
  { id: "financeiro", label: "Dados financeiros" },
];

const CONDICOES = ["", "Pronto pagamento", "15 dias", "30 dias", "45 dias", "60 dias", "90 dias"];

const inputCls = "w-full max-w-[16rem] border border-gray-300 rounded-sm px-2 py-1 text-sm text-right bg-white focus:outline-none focus:ring-1 focus:ring-black/20";

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

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

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
      condicoes_pagamento: c.condicoes_pagamento || "",
      desconto_comercial_pct: c.desconto_comercial_pct ?? "",
      limite_credito: c.limite_credito ?? "",
      contactos: c.contactos || [],
    });
    setEditId(c.id);
    setOpen(true);
  };
  const save = async () => {
    const err = validarFormCliente(form);
    if (err) return toast.error(err);
    const payload = {
      ...form,
      desconto_comercial_pct: form.desconto_comercial_pct === "" ? null : Number(form.desconto_comercial_pct),
      limite_credito: form.limite_credito === "" ? null : Number(form.limite_credito),
      contactos: form.contactos || [],
    };
    try {
      if (editId) await api.put(`/clientes/${editId}`, payload);
      else await api.post("/clientes", payload);
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

  const emp = form.tipo === "empresa";

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
              <tr
                key={c.id}
                data-testid={`cliente-row-${c.id}`}
                onClick={() => nav(`/clientes/${c.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-2.5 mono tabular-nums text-gray-600 text-xs whitespace-nowrap">{c.codigo || "—"}</td>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Cliente" : "Novo Cliente"}</DialogTitle>
            <DialogDescription>
              {emp
                ? "Empresa: nome, NIF, morada, código postal, cidade, contacto e email obrigatórios."
                : "Particular: nome obrigatório; restantes campos opcionais."}
            </DialogDescription>
          </DialogHeader>

          <BlocosShell
            testid="cliente-form-blocos"
            storageKey="cliente-form-blocos-v1"
            blocks={FORM_BLOCOS}
            visibleIds={emp ? ["tipo", "identificacao", "morada", "contacto", "financeiro"] : ["tipo", "identificacao", "morada", "contacto"]}
            renderBlock={(id) => {
              if (id === "tipo") {
                return (
                  <div className="px-4 py-3" data-testid="cliente-tipo-group">
                    <div className="grid grid-cols-2 gap-2 max-w-sm ml-auto">
                      {[
                        { value: "empresa", label: "Empresa" },
                        { value: "particular", label: "Particular" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          data-testid={`cliente-tipo-${opt.value}`}
                          onClick={() => set({ tipo: opt.value })}
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
                  </div>
                );
              }
              if (id === "identificacao") {
                return (
                  <FieldGrid>
                    <FieldRow label={emp ? "Nome *" : "Nome *"} testid="cliente-campo-nome" full>
                      <input data-testid="cliente-nome-input" value={form.nome} onChange={(e) => set({ nome: e.target.value })} className={inputCls + " max-w-sm"} />
                    </FieldRow>
                    <FieldRow label={emp ? "NIF *" : "NIF"} testid="cliente-campo-nif">
                      <input data-testid="cliente-nif-input" value={form.nif} onChange={(e) => set({ nif: e.target.value })} placeholder={emp ? "" : "Opcional"} className={inputCls + " tabular-nums"} />
                    </FieldRow>
                    <FieldRow label="Responsável" testid="cliente-campo-responsavel">
                      <input data-testid="cliente-responsavel-input" value={form.responsavel} onChange={(e) => set({ responsavel: e.target.value })} className={inputCls} />
                    </FieldRow>
                    <FieldRow label="Notas" testid="cliente-campo-notas" full>
                      <textarea data-testid="cliente-notas-input" value={form.notas} onChange={(e) => set({ notas: e.target.value })} rows={2} className="w-full max-w-sm border border-gray-300 rounded-sm px-2 py-1 text-sm text-left bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                    </FieldRow>
                  </FieldGrid>
                );
              }
              if (id === "morada") {
                return (
                  <FieldGrid>
                    <FieldRow label={emp ? "Morada *" : "Morada"} testid="cliente-campo-morada" full>
                      <input data-testid="cliente-morada-input" value={form.morada} onChange={(e) => set({ morada: e.target.value })} className={inputCls + " max-w-sm"} />
                    </FieldRow>
                    <FieldRow label={emp ? "Código postal *" : "Código postal"} testid="cliente-campo-cp">
                      <input data-testid="cliente-cp-input" value={form.codigo_postal} onChange={(e) => set({ codigo_postal: e.target.value })} className={inputCls} />
                    </FieldRow>
                    <FieldRow label={emp ? "Cidade *" : "Cidade"} testid="cliente-campo-cidade">
                      <input data-testid="cliente-cidade-input" value={form.cidade} onChange={(e) => set({ cidade: e.target.value })} className={inputCls} />
                    </FieldRow>
                    <FieldRow label="País" testid="cliente-campo-pais" full>
                      <input data-testid="cliente-pais-input" value={form.pais} onChange={(e) => set({ pais: e.target.value })} className={inputCls} />
                    </FieldRow>
                  </FieldGrid>
                );
              }
              if (id === "contacto") {
                return (
                  <FieldGrid>
                    <FieldRow label={emp ? "Telefone / contacto *" : "Telefone / contacto"} testid="cliente-campo-contacto">
                      <input data-testid="cliente-contacto-input" value={form.contacto} onChange={(e) => set({ contacto: e.target.value })} className={inputCls} />
                    </FieldRow>
                    <FieldRow label={emp ? "Email *" : "Email"} testid="cliente-campo-email">
                      <input data-testid="cliente-email-input" value={form.email} onChange={(e) => set({ email: e.target.value })} className={inputCls} />
                    </FieldRow>
                  </FieldGrid>
                );
              }
              if (id === "financeiro") {
                return (
                  <FieldGrid>
                    <FieldRow label="Condições pagamento" testid="cliente-campo-condicoes">
                      <select data-testid="cliente-condicoes-input" value={form.condicoes_pagamento} onChange={(e) => set({ condicoes_pagamento: e.target.value })} className={inputCls}>
                        {CONDICOES.map((opt) => (
                          <option key={opt || "vazio"} value={opt}>{opt || "—"}</option>
                        ))}
                      </select>
                    </FieldRow>
                    <FieldRow label="Desconto comercial %" testid="cliente-campo-desconto">
                      <input data-testid="cliente-desconto-input" type="number" min="0" step="0.01" value={form.desconto_comercial_pct} onChange={(e) => set({ desconto_comercial_pct: e.target.value })} className={inputCls + " tabular-nums"} />
                    </FieldRow>
                    <FieldRow label="Limite crédito €" testid="cliente-campo-credito" full>
                      <input data-testid="cliente-credito-input" type="number" min="0" step="0.01" value={form.limite_credito} onChange={(e) => set({ limite_credito: e.target.value })} placeholder="Sem limite" className={inputCls + " tabular-nums"} />
                    </FieldRow>
                  </FieldGrid>
                );
              }
              return null;
            }}
          />

          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button type="button" data-testid="save-cliente-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClienteDefaultConfig open={configOpen} onOpenChange={setConfigOpen} onChanged={reload} />
    </>
  );
}
