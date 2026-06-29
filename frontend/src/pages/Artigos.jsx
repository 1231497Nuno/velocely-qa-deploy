import { useCallback, useEffect, useState } from "react";
import { api, eur } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/Layout";
import SearchBar from "../components/SearchBar";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { ArtigoForm } from "../components/artigos/ArtigoForm";

const empty = { nome: "", descricao: "", unidade: "un", custo_artigo: 0, margem: 30, materiais: [], roteiro: [] };

export default function Artigos() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [maquinas, setMaquinas] = useState([]);
  const [consumiveis, setConsumiveis] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    setItems(await api.get("/artigos"));
    setMaquinas(await api.get("/maquinas"));
    setConsumiveis(await api.get("/consumiveis"));
    setMaoObra(await api.get("/mao-obra"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
  };
  const openEdit = (a) => {
    setForm({
      nome: a.nome,
      descricao: a.descricao || "",
      unidade: a.unidade || "un",
      custo_artigo: a.custo_artigo ?? 0,
      margem: a.margem ?? 30,
      materiais: a.materiais || [],
      roteiro: a.roteiro || [],
    });
    setEditId(a.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome do artigo");
    const body = {
      nome: form.nome,
      descricao: form.descricao,
      unidade: form.unidade || "un",
      custo_artigo: Number(form.custo_artigo) || 0,
      margem: Number(form.margem) || 0,
      materiais: form.materiais.filter((m) => m.material_id).map((m) => ({
        ...m,
        quantidade: Number(m.quantidade) || 0,
        custo_unitario: Number(m.custo_unitario) || 0,
      })),
      roteiro: form.roteiro.map((op) => ({
        ...op,
        tempo_maquina: Number(op.tempo_maquina) || 0,
        tempo_mao_obra: Number(op.tempo_mao_obra) || 0,
      })),
    };
    if (editId) await api.put(`/artigos/${editId}`, body);
    else await api.post("/artigos", body);
    toast.success("Artigo guardado");
    setOpen(false);
    load();
  };

  const remove = async (id) => {
    await api.del(`/artigos/${id}`);
    toast.success("Artigo eliminado");
    load();
  };

  const ql = q.trim().toLowerCase();
  const items_f = ql ? items.filter((a) => [a.nome, a.descricao].some((v) => (v || "").toLowerCase().includes(ql))) : items;

  return (
    <div>
      <PageHeader
        title="Artigos"
        subtitle="Receita de materiais, roteiro de operações, custo e preço de venda"
        actions={
          can("artigos","create") && (<button data-testid="new-artigo-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus size={16} /> Novo Artigo
          </button>)
        }
      />

      <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por nome do artigo..." testid="artigos-search" />

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Artigo</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Materiais</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Máquinas</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Mão de Obra</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Custo Total</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Margem</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Preço Venda</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody data-testid="artigos-table">
            {items_f.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{a.nome}</div>
                  {a.descricao && <div className="text-xs text-gray-500">{a.descricao}</div>}
                  <div className="text-xs text-gray-400 mt-0.5">{(a.materiais || []).length} materiais · {(a.roteiro || []).length} operações</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_materiais)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_maquinas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_mao_obra)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(a.custo_producao_total)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{a.margem ?? 0}%</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{eur(a.preco_venda)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("artigos","edit") && (<button data-testid={`edit-artigo-${a.id}`} onClick={() => openEdit(a)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>)}
                    {can("artigos","delete") && (<button data-testid={`delete-artigo-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>)}
                  </div>
                </td>
              </tr>
            ))}
            {items_f.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Sem artigos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Artigo" : "Novo Artigo"}</DialogTitle>
            <DialogDescription>Defina a receita de materiais e o roteiro de operações. O custo e o preço de venda são calculados automaticamente.</DialogDescription>
          </DialogHeader>

          <ArtigoForm form={form} setForm={setForm} maquinas={maquinas} consumiveis={consumiveis} maoObra={maoObra} />

          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-artigo-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
