import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Gestão de artigos diversos (código DIV-…): descrição livre nas linhas de orçamento.
 */
export default function ArtigosDiversosConfig({ open, onOpenChange, onChanged }) {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/artigos?diversos=true&lite=1");
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
      toast.error("Erro ao carregar artigos diversos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const openNew = () => {
    setEditId(null);
    setNome("");
    setDescricao("");
    setFormOpen(true);
  };

  const openEdit = (a) => {
    setEditId(a.id);
    setNome(a.nome || "");
    setDescricao(a.descricao || "");
    setFormOpen(true);
  };

  const save = async () => {
    if (!nome.trim()) return toast.error("Indique o nome");
    setSaving(true);
    try {
      const body = {
        nome: nome.trim(),
        descricao: descricao.trim(),
        unidade: "un",
        custo_artigo: 0,
        margem: 0,
        ativo: true,
        diversos: true,
        materiais: [],
        roteiro: [],
      };
      if (editId) {
        await api.put(`/artigos/${editId}`, body);
        toast.success("Artigo diverso atualizado");
      } else {
        await api.post("/artigos", body);
        toast.success("Artigo diverso criado");
      }
      setFormOpen(false);
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Eliminar este artigo diverso?")) return;
    try {
      await api.del(`/artigos/${id}`);
      toast.success("Eliminado");
      await load();
      if (onChanged) onChanged();
    } catch {
      toast.error("Erro ao eliminar");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Artigos diversos</DialogTitle>
            <DialogDescription>
              Códigos <span className="font-mono text-xs">DIV-…</span>. Use-os no orçamento e altere a descrição da linha; o código fica como referência.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end mb-2">
            {can("artigos", "create") && (
              <button
                type="button"
                data-testid="diversos-novo-btn"
                onClick={openNew}
                className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
              >
                <Plus size={14} /> Novo diverso
              </button>
            )}
          </div>

          <div className="border border-gray-200 rounded-sm overflow-hidden" data-testid="diversos-lista">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Código</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100" data-testid={`diversos-row-${a.id}`}>
                    <td className="px-3 py-2 tabular-nums text-xs text-gray-600 font-mono">{a.codigo}</td>
                    <td className="px-3 py-2 text-gray-900">{a.nome}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {can("artigos", "edit") && (
                          <button type="button" onClick={() => openEdit(a)} className="p-1 rounded-sm hover:bg-gray-100 text-gray-600" title="Editar">
                            <Pencil size={14} />
                          </button>
                        )}
                        {can("artigos", "delete") && (
                          <button type="button" onClick={() => remove(a.id)} className="p-1 rounded-sm hover:bg-red-50 text-red-600" title="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-gray-400 text-sm">
                      {loading ? "A carregar…" : "Ainda não há artigos diversos. Crie o primeiro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar diverso" : "Novo artigo diverso"}</DialogTitle>
            <DialogDescription>
              {editId ? "O código DIV- mantém-se." : "Será atribuído automaticamente um código DIV-…"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input
                data-testid="diversos-nome"
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Diversos Fam Art"
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Descrição (opcional)</label>
              <input
                data-testid="diversos-descricao"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setFormOpen(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              data-testid="diversos-save"
              disabled={saving}
              onClick={save}
              className="px-3 py-2 text-sm bg-black text-white rounded-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "A guardar…" : "Guardar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
