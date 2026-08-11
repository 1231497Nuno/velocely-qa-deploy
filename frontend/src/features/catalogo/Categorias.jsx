import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { Plus, Pencil, Trash2, Layers, FolderTree } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

function TabBtn({ id, active, onClick, icon: Icon, label, count }) {
  return (
    <button
      data-testid={`cat-tab-${id}`}
      onClick={() => onClick(id)}
      className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${
        active ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
      }`}
    >
      <Icon size={15} />
      {label}
      {count != null && (
        <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${active ? "bg-white/20" : "bg-gray-100 text-gray-500"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function Categorias() {
  const { can } = useAuth();
  const [tab, setTab] = useState("categorias");
  const [filtroCat, setFiltroCat] = useState("");
  const [catsSelect, setCatsSelect] = useState([]);
  const [openCat, setOpenCat] = useState(false);
  const [openSub, setOpenSub] = useState(false);
  const [catNome, setCatNome] = useState("");
  const [catEditId, setCatEditId] = useState(null);
  const [subForm, setSubForm] = useState({ nome: "", categoria_id: "" });
  const [subEditId, setSubEditId] = useState(null);

  const cats = useServerPagedList("/categorias", { enabled: tab === "categorias" });
  const subExtra = useMemo(() => (filtroCat ? { categoria_id: filtroCat } : {}), [filtroCat]);
  const subs = useServerPagedList("/subcategorias", {
    enabled: tab === "subcategorias",
    extraParams: subExtra,
  });

  const loadCatsSelect = useCallback(async () => {
    try {
      setCatsSelect(await api.get("/categorias"));
    } catch {
      setCatsSelect([]);
    }
  }, []);
  useEffect(() => { loadCatsSelect(); }, [loadCatsSelect]);

  const openNewCat = () => { setCatNome(""); setCatEditId(null); setOpenCat(true); };
  const openEditCat = (c) => { setCatNome(c.nome || ""); setCatEditId(c.id); setOpenCat(true); };
  const saveCat = async () => {
    if (!catNome.trim()) return toast.error("Indique o nome da categoria");
    try {
      if (catEditId) await api.put(`/categorias/${catEditId}`, { nome: catNome.trim() });
      else await api.post("/categorias", { nome: catNome.trim() });
      toast.success("Categoria guardada");
      setOpenCat(false);
      cats.reload();
      loadCatsSelect();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };
  const removeCat = async (id) => {
    try {
      await api.del(`/categorias/${id}`);
      toast.success("Categoria eliminada");
      cats.reload();
      loadCatsSelect();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível eliminar");
    }
  };

  const openNewSub = () => {
    setSubForm({ nome: "", categoria_id: filtroCat || catsSelect[0]?.id || "" });
    setSubEditId(null);
    setOpenSub(true);
  };
  const openEditSub = (s) => {
    setSubForm({ nome: s.nome || "", categoria_id: s.categoria_id || "" });
    setSubEditId(s.id);
    setOpenSub(true);
  };
  const saveSub = async () => {
    if (!subForm.nome.trim()) return toast.error("Indique o nome da subcategoria");
    if (!subForm.categoria_id) return toast.error("Selecione a categoria");
    try {
      const body = { nome: subForm.nome.trim(), categoria_id: subForm.categoria_id };
      if (subEditId) await api.put(`/subcategorias/${subEditId}`, body);
      else await api.post("/subcategorias", body);
      toast.success("Subcategoria guardada");
      setOpenSub(false);
      subs.reload();
      if (tab === "categorias") cats.reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };
  const removeSub = async (id) => {
    try {
      await api.del(`/subcategorias/${id}`);
      toast.success("Subcategoria eliminada");
      subs.reload();
      if (tab === "categorias") cats.reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível eliminar");
    }
  };

  const active = tab === "categorias" ? cats : subs;

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Categorias e subcategorias"
          subtitle="Organização dos artigos — ex.: Têxtil → T-shirt"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              {tab === "categorias" ? (
                <ExportExcelButton entity="categorias" ids={cats.items.map((c) => c.id)} />
              ) : (
                <ExportExcelButton entity="subcategorias" ids={subs.items.map((s) => s.id)} />
              )}
              {tab === "categorias"
                ? (can("artigos", "create") && (
                  <button data-testid="new-categoria-btn" onClick={openNewCat} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
                    <Plus size={16} /> Nova categoria
                  </button>
                ))
                : (can("artigos", "create") && (
                  <button data-testid="new-subcategoria-btn" onClick={openNewSub} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
                    <Plus size={16} /> Nova subcategoria
                  </button>
                ))}
            </div>
          }
        />
      }
      toolbar={
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <TabBtn id="categorias" active={tab === "categorias"} onClick={setTab} icon={Layers} label="Categorias" count={tab === "categorias" ? cats.total : undefined} />
            <TabBtn id="subcategorias" active={tab === "subcategorias"} onClick={setTab} icon={FolderTree} label="Subcategorias" count={tab === "subcategorias" ? subs.total : undefined} />
          </div>
          {tab === "categorias" && (
            <SearchBar value={cats.q} onChange={cats.setQ} placeholder="Pesquisar pelo início do código ou nome..." testid="categorias-search" />
          )}
          {tab === "subcategorias" && (
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                data-testid="sub-filtro-categoria"
                value={filtroCat}
                onChange={(e) => setFiltroCat(e.target.value)}
                className="border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              >
                <option value="">Todas as categorias</option>
                {catsSelect.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <div className="flex-1">
                <SearchBar value={subs.q} onChange={subs.setQ} placeholder="Pesquisar pelo início do nome..." testid="subcategorias-search" />
              </div>
            </div>
          )}
        </>
      }
      footer={
        <ListPagination
          page={active.page}
          pages={active.pages}
          total={active.total}
          pageSize={active.pageSize}
          onPageChange={active.setPage}
          onPageSizeChange={active.setPageSize}
          rangeLabel={active.rangeLabel}
          testid={tab === "categorias" ? "categorias-pagination" : "subcategorias-pagination"}
        />
      }
    >
      {tab === "categorias" && (
        <ScrollableTable>
          <table className="w-full text-sm min-w-[420px]">
            <thead className={TABLE_HEAD_STICKY}>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subcats.</th>
                <th className="px-4 py-3 w-24 bg-gray-50"></th>
              </tr>
            </thead>
            <tbody data-testid="categorias-table">
              {cats.items.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{c.codigo || "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{c.num_subcategorias ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {can("artigos", "edit") && <button data-testid={`edit-categoria-${c.id}`} onClick={() => openEditCat(c)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
                      {can("artigos", "delete") && <button data-testid={`delete-categoria-${c.id}`} onClick={() => removeCat(c.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {cats.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {cats.loading ? "A carregar categorias…" : "Sem categorias. Cria a primeira (ex.: Têxtil)."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      {tab === "subcategorias" && (
        <ScrollableTable>
          <table className="w-full text-sm min-w-[520px]">
            <thead className={TABLE_HEAD_STICKY}>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Categoria</th>
                <th className="px-4 py-3 w-24 bg-gray-50"></th>
              </tr>
            </thead>
            <tbody data-testid="subcategorias-table">
              {subs.items.map((s) => (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{s.codigo || "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.nome}</td>
                  <td className="px-4 py-3 text-gray-600">{s.categoria_nome || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {can("artigos", "edit") && <button data-testid={`edit-subcategoria-${s.id}`} onClick={() => openEditSub(s)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
                      {can("artigos", "delete") && <button data-testid={`delete-subcategoria-${s.id}`} onClick={() => removeSub(s.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {subs.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {subs.loading ? "A carregar subcategorias…" : "Sem subcategorias. Cria a primeira (ex.: T-shirt)."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </ListPage>

      <Dialog open={openCat} onOpenChange={setOpenCat}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{catEditId ? "Editar categoria" : "Nova categoria"}</DialogTitle>
            <DialogDescription>Exemplo: Têxtil, Rígido, Brindes…</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
            <input data-testid="categoria-nome-input" value={catNome} onChange={(e) => setCatNome(e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
          </div>
          <DialogFooter>
            <button onClick={() => setOpenCat(false)} className="bg-white border border-gray-300 rounded-sm px-4 py-2 text-sm">Cancelar</button>
            <button data-testid="save-categoria-btn" onClick={saveCat} className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openSub} onOpenChange={setOpenSub}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{subEditId ? "Editar subcategoria" : "Nova subcategoria"}</DialogTitle>
            <DialogDescription>Exemplo: T-shirt, Hoodie, Etiqueta…</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Categoria</label>
              <select
                data-testid="subcategoria-cat-select"
                value={subForm.categoria_id}
                onChange={(e) => setSubForm({ ...subForm, categoria_id: e.target.value })}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              >
                <option value="">— Selecionar —</option>
                {catsSelect.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="subcategoria-nome-input" value={subForm.nome} onChange={(e) => setSubForm({ ...subForm, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpenSub(false)} className="bg-white border border-gray-300 rounded-sm px-4 py-2 text-sm">Cancelar</button>
            <button data-testid="save-subcategoria-btn" onClick={saveSub} className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium">Guardar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
