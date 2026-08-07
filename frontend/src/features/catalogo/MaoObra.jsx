import { useState } from "react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import UtilizacoesDialog from "@/components/UtilizacoesDialog";

const empty = { nome: "", custo_hora: 0, responsavel_personalizacoes: false };

export default function MaoObra() {
  const { can } = useAuth();
  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel,
  } = useServerPagedList("/mao-obra");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [uso, setUso] = useState(null);

  const openNew = () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (m) => {
    setForm({ nome: m.nome, custo_hora: m.custo_hora, responsavel_personalizacoes: !!m.responsavel_personalizacoes });
    setEditId(m.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique a função");
    const body = { nome: form.nome, custo_hora: Number(form.custo_hora) || 0, responsavel_personalizacoes: !!form.responsavel_personalizacoes };
    if (editId) await api.put(`/mao-obra/${editId}`, body);
    else await api.post("/mao-obra", body);
    toast.success("Mão de obra guardada");
    setOpen(false);
    reload();
  };

  const remove = async (id) => {
    await api.del(`/mao-obra/${id}`);
    toast.success("Eliminado");
    reload();
  };

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Mão de Obra"
          subtitle="Funções e custo/hora alocados às operações dos artigos"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="mao_obra" ids={items.map((m) => m.id)} />
              {can("mao_obra", "create") && (
                <button data-testid="new-maoobra-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
                  <Plus size={16} /> Nova Função
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={<SearchBar value={q} onChange={setQ} placeholder="Pesquisar por código ou nome..." testid="mao-obra-search" />}
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="mao-obra-pagination"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[560px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Função</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo / Hora</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Personalizações</th>
              <th className="px-4 py-3 w-24 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody data-testid="maoobra-table">
            {items.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{m.codigo || "—"}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{m.nome}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(m.custo_hora)}</td>
                <td className="px-4 py-3 text-center">
                  {m.responsavel_personalizacoes ? (
                    <span data-testid={`maoobra-resp-pers-${m.id}`} className="inline-block px-2 py-0.5 rounded-sm text-xs font-medium bg-indigo-100 text-indigo-700">Responsável</span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`uso-maoobra-${m.id}`} onClick={() => setUso({ endpoint: `/mao-obra/${m.id}/utilizacoes`, titulo: `Onde é usada: ${m.nome}`, subtitulo: "Artigos que usam esta mão de obra no roteiro." })} title="Onde é usada" className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500"><Eye size={15} /></button>
                    {can("mao_obra","edit") && (<button data-testid={`edit-maoobra-${m.id}`} onClick={() => openEdit(m)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>)}
                    {can("mao_obra","delete") && (<button data-testid={`delete-maoobra-${m.id}`} onClick={() => remove(m.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>)}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Sem funções. Crie a primeira.</td></tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </ListPage>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Função" : "Nova Função"}</DialogTitle>
            <DialogDescription>Função de mão de obra e respetivo custo/hora.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Função</label>
              <input data-testid="maoobra-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Custo / Hora (€)</label>
              <input data-testid="maoobra-custo-input" type="number" step="0.01" value={form.custo_hora} onChange={(e) => setForm({ ...form, custo_hora: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input data-testid="maoobra-resp-pers-input" type="checkbox" checked={!!form.responsavel_personalizacoes} onChange={(e) => setForm({ ...form, responsavel_personalizacoes: e.target.checked })} className="mt-0.5 h-4 w-4 rounded-sm border-gray-300 text-black focus:ring-black/20" />
              <span className="text-sm">
                <span className="font-medium text-gray-700">Responsável pelas personalizações</span>
                <span className="block text-xs text-gray-400 mt-0.5">O tempo definido em cada tipo de personalização é somado à mão de obra desta operação na Ordem de Fabrico.</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-maoobra-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UtilizacoesDialog open={!!uso} onOpenChange={(v) => !v && setUso(null)} endpoint={uso?.endpoint} titulo={uso?.titulo} subtitulo={uso?.subtitulo} />
    </>
  );
}
