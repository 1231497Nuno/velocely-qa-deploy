import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
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
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [q, setQ] = useState("");
  const [filtroCat, setFiltroCat] = useState("");
  const [openCat, setOpenCat] = useState(false);
  const [openSub, setOpenSub] = useState(false);
  const [catNome, setCatNome] = useState("");
  const [catEditId, setCatEditId] = useState(null);
  const [subForm, setSubForm] = useState({ nome: "", categoria_id: "" });
  const [subEditId, setSubEditId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cats, subs] = await Promise.all([api.get("/categorias"), api.get("/subcategorias")]);
      setCategorias(cats || []);
      setSubcategorias(subs || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao carregar categorias");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNewCat = () => { setCatNome(""); setCatEditId(null); setOpenCat(true); };
  const openEditCat = (c) => { setCatNome(c.nome || ""); setCatEditId(c.id); setOpenCat(true); };
  const saveCat = async () => {
    if (!catNome.trim()) return toast.error("Indique o nome da categoria");
    try {
      if (catEditId) await api.put(`/categorias/${catEditId}`, { nome: catNome.trim() });
      else await api.post("/categorias", { nome: catNome.trim() });
      toast.success("Categoria guardada");
      setOpenCat(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };
  const removeCat = async (id) => {
    try {
      await api.del(`/categorias/${id}`);
      toast.success("Categoria eliminada");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível eliminar");
    }
  };

  const openNewSub = () => {
    setSubForm({ nome: "", categoria_id: filtroCat || categorias[0]?.id || "" });
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
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };
  const removeSub = async (id) => {
    try {
      await api.del(`/subcategorias/${id}`);
      toast.success("Subcategoria eliminada");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível eliminar");
    }
  };

  const ql = q.trim().toLowerCase();
  const cats_f = ql
    ? categorias.filter((c) => [c.codigo, c.nome].some((v) => (v || "").toLowerCase().includes(ql)))
    : categorias;
  const subsBase = filtroCat ? subcategorias.filter((s) => s.categoria_id === filtroCat) : subcategorias;
  const subs_f = ql
    ? subsBase.filter((s) => [s.codigo, s.nome, s.categoria_nome].some((v) => (v || "").toLowerCase().includes(ql)))
    : subsBase;

  return (
    <div>
      <PageHeader
        title="Categorias e subcategorias"
        subtitle="Organização dos artigos — ex.: Têxtil → T-shirt"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {tab === "categorias" ? (
              <ExportExcelButton entity="categorias" ids={cats_f.map((c) => c.id)} />
            ) : (
              <ExportExcelButton entity="subcategorias" ids={subs_f.map((s) => s.id)} />
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

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <TabBtn id="categorias" active={tab === "categorias"} onClick={setTab} icon={Layers} label="Categorias" count={categorias.length} />
        <TabBtn id="subcategorias" active={tab === "subcategorias"} onClick={setTab} icon={FolderTree} label="Subcategorias" count={subcategorias.length} />
      </div>

      {tab === "categorias" && (
        <>
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar categorias por código ou nome..." testid="categorias-search" />
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Subcats.</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody data-testid="categorias-table">
                {cats_f.map((c) => {
                  const nSubs = subcategorias.filter((s) => s.categoria_id === c.id).length;
                  return (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 mono tabular-nums text-gray-600 text-xs">{c.codigo || "—"}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{nSubs}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {can("artigos", "edit") && <button data-testid={`edit-categoria-${c.id}`} onClick={() => openEditCat(c)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600"><Pencil size={15} /></button>}
                          {can("artigos", "delete") && <button data-testid={`delete-categoria-${c.id}`} onClick={() => removeCat(c.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {cats_f.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">Sem categorias. Cria a primeira (ex.: Têxtil).</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "subcategorias" && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <select
              data-testid="sub-filtro-categoria"
              value={filtroCat}
              onChange={(e) => setFiltroCat(e.target.value)}
              className="border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
            >
              <option value="">Todas as categorias</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <div className="flex-1">
              <SearchBar value={q} onChange={setQ} placeholder="Pesquisar subcategorias..." testid="subcategorias-search" />
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Código</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Categoria</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody data-testid="subcategorias-table">
                {subs_f.map((s) => (
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
                {subs_f.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">Sem subcategorias. Cria a primeira (ex.: T-shirt).</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

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
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
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
    </div>
  );
}
