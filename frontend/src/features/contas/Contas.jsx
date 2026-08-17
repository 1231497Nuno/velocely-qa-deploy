import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { ymdHoje } from "@/lib/orcamento";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import StatusBadge from "@/components/StatusBadge";
import ClienteSelector from "@/components/ClienteSelector";
import Combobox from "@/components/Combobox";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export const CONTA_TIPO_PT = { receber: "A receber", pagar: "A pagar" };

const FILTROS = [
  { id: "receber", label: "A receber" },
  { id: "pagar", label: "A pagar" },
  { id: "todas", label: "Todas" },
];

const ESTADOS = [
  { id: "", label: "Todos os estados" },
  { id: "pendente", label: "Pendente" },
  { id: "parcial", label: "Parcial" },
  { id: "liquidada", label: "Liquidada" },
  { id: "anulada", label: "Anulada" },
];

const emptyForm = () => ({
  tipo: "receber",
  entidade: "",
  entidade_tipo: "",
  entidade_id: "",
  descricao: "",
  referencia: "",
  data: ymdHoje(),
  vencimento: "",
  valor: "",
  notas: "",
});

export default function Contas() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filtro = searchParams.get("tipo") || "receber";
  const [estadoFilter, setEstadoFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [fornecedores, setFornecedores] = useState([]);

  const extraParams = useMemo(() => {
    const p = {};
    if (filtro !== "todas") p.tipo = filtro;
    if (estadoFilter) p.estado = estadoFilter;
    return p;
  }, [filtro, estadoFilter]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel,
  } = useServerPagedList("/contas", { extraParams });

  useEffect(() => {
    if (!FILTROS.some((t) => t.id === filtro)) {
      const next = new URLSearchParams(searchParams);
      next.set("tipo", "receber");
      setSearchParams(next, { replace: true });
    }
  }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!can("fornecedores", "view")) return;
    api.get("/fornecedores").then((all) => {
      const list = Array.isArray(all) ? all : (all.items || []);
      setFornecedores(list);
    }).catch(() => setFornecedores([]));
  }, [can]);

  const setFiltro = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("tipo", id);
    setSearchParams(next, { replace: true });
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Eliminar esta conta?")) return;
    try {
      await api.del(`/contas/${id}`);
      toast.success("Conta eliminada");
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Erro ao eliminar");
    }
  };

  const create = async () => {
    const valor = Number(form.valor);
    if (!form.entidade.trim()) {
      toast.error("Indique a entidade");
      return;
    }
    if (!(valor > 0)) {
      toast.error("Indique um valor maior do que zero");
      return;
    }
    try {
      const created = await api.post("/contas", {
        tipo: form.tipo,
        entidade: form.entidade.trim(),
        entidade_tipo: form.entidade_tipo || "",
        entidade_id: form.entidade_id || null,
        descricao: form.descricao.trim(),
        referencia: form.referencia.trim(),
        data: form.data || null,
        vencimento: form.vencimento || null,
        valor,
        notas: form.notas.trim(),
      });
      toast.success("Conta criada");
      setOpen(false);
      setForm(emptyForm());
      nav(`/contas/${created.id}`);
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível criar");
    }
  };

  const title = filtro === "pagar" ? "Contas a pagar" : filtro === "receber" ? "Contas a receber" : "Contas a pagar e a receber";

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title={title}
          subtitle="Controlo de valores a receber e a pagar, com documentos associados. Independente do módulo de faturas."
          actions={
            can("contas", "create") && (
              <button
                data-testid="new-conta-btn"
                onClick={() => {
                  setForm({ ...emptyForm(), tipo: filtro === "pagar" ? "pagar" : "receber" });
                  setOpen(true);
                }}
                className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2"
              >
                <Plus size={16} /> Nova conta
              </button>
            )
          }
        />
      }
      toolbar={
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 min-w-0">
              <SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo nº, entidade, descrição ou referência..." testid="contas-search" />
            </div>
            <select
              data-testid="contas-filtro-estado"
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-sm px-2 py-1.5 bg-white shrink-0"
            >
              {ESTADOS.map((e) => (
                <option key={e.id || "all"} value={e.id}>{e.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-testid="contas-tabs">
            {FILTROS.map((t) => {
              const active = filtro === t.id;
              return (
                <button
                  key={t.id}
                  data-testid={`contas-tab-${t.id}`}
                  onClick={() => setFiltro(t.id)}
                  className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${active ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
                >
                  {t.label}
                  {active && (
                    <span className="text-xs tabular-nums rounded-full px-1.5 py-0.5 bg-white/20">{total}</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
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
          testid="contas-pagination"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[920px]" data-testid="contas-table">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Entidade</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Descrição</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Vencimento</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pendente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">
                  Sem contas neste filtro.
                </td>
              </tr>
            ) : items.map((c) => (
              <tr
                key={c.id}
                data-testid={`conta-row-${c.id}`}
                onClick={() => nav(`/contas/${c.id}`)}
                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-2.5 font-medium mono text-gray-900">{c.numero}</td>
                <td className="px-4 py-2.5 text-gray-600">{CONTA_TIPO_PT[c.tipo] || c.tipo}</td>
                <td className="px-4 py-2.5 font-medium text-gray-900 truncate max-w-[200px]">{c.entidade || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 truncate max-w-[220px]">{c.descricao || "—"}</td>
                <td className="px-4 py-2.5 text-gray-500">{fmtDate(c.vencimento)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{eur(c.valor)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{eur(c.valor_pendente)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={c.estado} /></td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {can("contas", "delete") && (
                      <button data-testid={`conta-del-${c.id}`} onClick={(e) => remove(e, c.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
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

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Nova conta</DialogTitle>
          <DialogDescription>Registe um valor a receber ou a pagar e, depois, associe documentos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Tipo</label>
            <select
              data-testid="conta-tipo-input"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value, entidade: "", entidade_id: "", entidade_tipo: "" })}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white"
            >
              <option value="receber">A receber</option>
              <option value="pagar">A pagar</option>
            </select>
          </div>
          {form.tipo === "receber" ? (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Cliente</label>
              <ClienteSelector
                value={form.entidade_id}
                onChange={(id, nome) => setForm({ ...form, entidade_id: id, entidade: nome, entidade_tipo: "cliente" })}
                testid="conta-cliente-select"
              />
            </div>
          ) : can("fornecedores", "view") ? (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Fornecedor</label>
              <Combobox
                testid="conta-fornecedor-select"
                value={form.entidade_id}
                onChange={(id) => {
                  const f = fornecedores.find((x) => x.id === id);
                  setForm({ ...form, entidade_id: id, entidade: f?.nome || form.entidade, entidade_tipo: "fornecedor" });
                }}
                options={fornecedores.map((f) => ({ value: f.id, label: f.nome }))}
                placeholder="Selecionar fornecedor..."
              />
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Entidade</label>
              <input
                data-testid="conta-entidade-input"
                value={form.entidade}
                onChange={(e) => setForm({ ...form, entidade: e.target.value, entidade_tipo: "outro", entidade_id: "" })}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm"
              />
            </div>
          )}
          {(form.tipo === "receber" || can("fornecedores", "view")) && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Ou outro nome</label>
              <input
                data-testid="conta-entidade-input"
                value={form.entidade}
                onChange={(e) => setForm({ ...form, entidade: e.target.value, entidade_tipo: form.entidade_id ? form.entidade_tipo : "outro" })}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm"
                placeholder="Nome livre se não estiver no catálogo"
              />
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Descrição</label>
            <input data-testid="conta-descricao-input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Valor</label>
              <input data-testid="conta-valor-input" type="number" min="0" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Vencimento</label>
              <input data-testid="conta-vencimento-input" type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
          <button data-testid="save-conta-btn" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Criar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
