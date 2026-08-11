import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
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

const empty = {
  nome: "", descricao: "", unidade: "un", imagem: "", custo_artigo: 0, margem: 30,
  categoria_id: "", categoria_nome: "", subcategoria_id: "", subcategoria_nome: "",
  ativo: true, fabricante: "", cod_fabricante: "", fornecedor_id: "", fornecedor_nome: "",
  cod_fornecedor: "", website: "", comprimento_mm: 0, largura_mm: 0, espessura_mm: 0,
  responsavel: "", materiais: [], roteiro: [],
};

export default function Artigos() {
  const { can } = useAuth();
  const nav = useNavigate();
  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/artigos");
  const [maquinas, setMaquinas] = useState([]);
  const [consumiveis, setConsumiveis] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const { sort, toggle, apply } = useSort();

  const [formDataReady, setFormDataReady] = useState(false);

  const loadFormData = useCallback(async () => {
    if (formDataReady) return;
    try {
      const [maq, cons, mo, cats, subs] = await Promise.all([
        api.get("/maquinas"),
        api.get("/consumiveis"),
        api.get("/mao-obra"),
        api.get("/categorias"),
        api.get("/subcategorias"),
      ]);
      setMaquinas(maq);
      setConsumiveis(cons);
      setMaoObra(mo);
      setCategorias(cats);
      setSubcategorias(subs);
      setFormDataReady(true);
    } catch {
      setCategorias([]);
      setSubcategorias([]);
    }
  }, [formDataReady]);

  const openNew = async () => {
    setForm(empty);
    setEditId(null);
    setOpen(true);
    await loadFormData();
  };
  const openEdit = async (a) => {
    setForm({
      nome: a.nome,
      descricao: a.descricao || "",
      unidade: a.unidade || "un",
      imagem: a.imagem || "",
      custo_artigo: a.custo_artigo ?? 0,
      margem: a.margem ?? 30,
      categoria_id: a.categoria_id || "",
      categoria_nome: a.categoria_nome || "",
      subcategoria_id: a.subcategoria_id || "",
      subcategoria_nome: a.subcategoria_nome || "",
      ativo: a.ativo !== false,
      fabricante: a.fabricante || "",
      cod_fabricante: a.cod_fabricante || "",
      fornecedor_id: a.fornecedor_id || "",
      fornecedor_nome: a.fornecedor_nome || "",
      cod_fornecedor: a.cod_fornecedor || "",
      website: a.website || "",
      comprimento_mm: a.comprimento_mm ?? 0,
      largura_mm: a.largura_mm ?? 0,
      espessura_mm: a.espessura_mm ?? 0,
      responsavel: a.responsavel || "",
      materiais: a.materiais || [],
      roteiro: a.roteiro || [],
    });
    setEditId(a.id);
    setOpen(true);
    await loadFormData();
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
      categoria_id: form.categoria_id || null,
      categoria_nome: form.categoria_nome || "",
      subcategoria_id: form.subcategoria_id || null,
      subcategoria_nome: form.subcategoria_nome || "",
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
    reload();
  };

  const remove = async (id) => {
    await api.del(`/artigos/${id}`);
    toast.success("Artigo eliminado");
    reload();
  };

  const duplicar = async (id) => {
    await api.post(`/artigos/${id}/duplicar`);
    toast.success("Artigo duplicado");
    reload();
  };

  const rows = apply(items);

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Artigos"
          subtitle="Receita de materiais, roteiro de operações, custo e preço de venda"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ExportExcelButton entity="artigos" ids={items.map((a) => a.id)} />
              {can("artigos", "create") && (
                <button data-testid="new-artigo-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
                  <Plus size={16} /> Novo Artigo
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={<SearchBar value={q} onChange={setQ} placeholder="Pesquisar pelo início do nome ou código..." testid="artigos-search" />}
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="artigos-pagination"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[720px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <SortTh label="Código" sortKey="codigo" sort={sort} onSort={toggle} />
              <SortTh label="Artigo" sortKey="nome" sort={sort} onSort={toggle} />
              <SortTh label="Categoria" sortKey="categoria_nome" sort={sort} onSort={toggle} />
              <SortTh label="Subcategoria" sortKey="subcategoria_nome" sort={sort} onSort={toggle} />
              <SortTh label="Materiais" sortKey="custo_materiais" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Máquinas" sortKey="custo_maquinas" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Mão de Obra" sortKey="custo_mao_obra" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Custo Total" sortKey="custo_producao_total" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Margem" sortKey="margem" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Preço Venda" sortKey="preco_venda" sort={sort} onSort={toggle} align="right" />
              <th className="px-4 py-3 w-32 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody data-testid="artigos-table">
            {rows.map((a) => (
              <tr
                key={a.id}
                data-testid={`artigo-row-${a.id}`}
                onClick={() => nav(`/artigos/${a.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{a.codigo || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ImagemUpload value={a.imagem} editable={false} size={40} testid={`artigo-row-imagem-${a.id}`} />
                    <span data-testid={`artigo-nome-link-${a.id}`} className="font-medium text-gray-900 truncate">{a.nome}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 text-sm">{a.categoria_nome || "—"}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{a.subcategoria_nome || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_materiais)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_maquinas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{eur(a.custo_mao_obra)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(a.custo_producao_total)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{a.margem ?? 0}%</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{eur(a.preco_venda)}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {can("artigos","create") && (<button data-testid={`duplicate-artigo-${a.id}`} onClick={() => duplicar(a.id)} title="Duplicar" className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500"><Copy size={15} /></button>)}
                    {can("artigos","edit") && (<button data-testid={`edit-artigo-${a.id}`} onClick={() => openEdit(a)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>)}
                    {can("artigos","delete") && (<button data-testid={`delete-artigo-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>)}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem artigos."}</td></tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </ListPage>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar Artigo" : "Novo Artigo"}</DialogTitle>
            <DialogDescription>Defina a receita de materiais e o roteiro de operações. O custo e o preço de venda são calculados automaticamente.</DialogDescription>
          </DialogHeader>

          <ArtigoForm form={form} setForm={setForm} maquinas={maquinas} consumiveis={consumiveis} maoObra={maoObra} categorias={categorias} subcategorias={subcategorias} />

          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-artigo-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
