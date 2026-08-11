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

const empty = { nome: "", unidade: "un", custo_unitario: 0 };
const UNIDADES = ["un", "kg", "g", "m", "cm", "m²", "L", "ml", "folha", "par", "h"];

export default function Materiais() {
  const { can } = useAuth();
  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel,
  } = useServerPagedList("/consumiveis");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [uso, setUso] = useState(null);

  const openNew = () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (c) => {
    setForm({ nome: c.nome, unidade: c.unidade, custo_unitario: c.custo_unitario });
    setEditId(c.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome do material");
    const body = { nome: form.nome, unidade: form.unidade || "un", custo_unitario: Number(form.custo_unitario) || 0 };
    if (editId) await api.put(`/consumiveis/${editId}`, body);
    else await api.post("/consumiveis", body);
    toast.success("Material guardado");
    setOpen(false);
    reload();
  };

  const remove = async (id) => {
    await api.del(`/consumiveis/${id}`);
    toast.success("Material eliminado");
    reload();
  };

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Materiais"
          subtitle="Consumíveis e respetivo custo unitário usados nas receitas dos artigos"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="materiais" ids={items.map((c) => c.id)} />
              {can("materiais", "create") && (
                <button data-testid="new-material-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
                  <Plus size={16} /> Novo Material
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={<SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do código ou nome..." testid="materiais-search" />}
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="materiais-pagination"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[560px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Unidade</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Unitário</th>
              <th className="px-4 py-3 w-24 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody data-testid="materiais-table">
            {items.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{c.codigo || "—"}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                <td className="px-4 py-3 text-gray-600">{c.unidade}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(c.custo_unitario)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`uso-material-${c.id}`} onClick={() => setUso({ endpoint: `/consumiveis/${c.id}/utilizacoes`, titulo: `Onde é usado: ${c.nome}`, subtitulo: "Artigos que usam este material na receita." })} title="Onde é usado" className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500"><Eye size={15} /></button>
                    {can("materiais","edit") && (<button data-testid={`edit-material-${c.id}`} onClick={() => openEdit(c)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>)}
                    {can("materiais","delete") && (<button data-testid={`delete-material-${c.id}`} onClick={() => remove(c.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>)}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Sem materiais. Crie o primeiro.</td></tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </ListPage>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Material" : "Novo Material"}</DialogTitle>
            <DialogDescription>Consumível usado nas receitas de materiais dos artigos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="material-nome-input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Unidade de medida</label>
                <select data-testid="material-unidade-input" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Custo Unitário (€)</label>
                <input data-testid="material-custo-input" type="number" step="0.01" value={form.custo_unitario} onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-material-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UtilizacoesDialog open={!!uso} onOpenChange={(v) => !v && setUso(null)} endpoint={uso?.endpoint} titulo={uso?.titulo} subtitulo={uso?.subtitulo} />
    </>
  );
}
