import { useCallback, useEffect, useState } from "react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import { useSort, SortTh } from "@/components/table";
import { Plus, Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArtigoForm } from "@/features/artigos/ArtigoForm";
import ImagemUpload from "@/components/ImagemUpload";

const empty = { nome: "", descricao: "", unidade: "un", imagem: "", custo_artigo: 0, margem: 30, materiais: [], roteiro: [] };

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
  const { sort, toggle, apply } = useSort();

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
      imagem: a.imagem || "",
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
      imagem: form.imagem || "",
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

  const duplicar = async (id) => {
    await api.post(`/artigos/${id}/duplicar`);
    toast.success("Artigo duplicado");
    load();
  };

  const ql = q.trim().toLowerCase();
  const items_f = ql ? items.filter((a) => [a.nome, a.descricao].some((v) => (v || "").toLowerCase().includes(ql))) : items;
  const rows = apply(items_f);

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
              <SortTh label="Artigo" sortKey="nome" sort={sort} onSort={toggle} />
              <SortTh label="Materiais" sortKey="custo_materiais" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Máquinas" sortKey="custo_maquinas" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Mão de Obra" sortKey="custo_mao_obra" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Custo Total" sortKey="custo_producao_total" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Margem" sortKey="margem" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Preço Venda" sortKey="preco_venda" sort={sort} onSort={toggle} align="right" />
              <th className="px-4 py-3 w-32"></th>
            </tr>
          </thead>
          <tbody data-testid="artigos-table">
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ImagemUpload value={a.imagem} editable={false} size={40} testid={`artigo-row-imagem-${a.id}`} />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{a.nome}</div>
                      {a.descricao && <div className="text-xs text-gray-500">{a.descricao}</div>}
                      <div className="text-xs text-gray-400 mt-0.5">{(a.materiais || []).length} materiais · {(a.roteiro || []).length} operações</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_materiais)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_maquinas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_mao_obra)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(a.custo_producao_total)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{a.margem ?? 0}%</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{eur(a.preco_venda)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {can("artigos","create") && (<button data-testid={`duplicate-artigo-${a.id}`} onClick={() => duplicar(a.id)} title="Duplicar" className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500"><Copy size={15} /></button>)}
                    {can("artigos","edit") && (<button data-testid={`edit-artigo-${a.id}`} onClick={() => openEdit(a)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>)}
                    {can("artigos","delete") && (<button data-testid={`delete-artigo-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>)}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
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
