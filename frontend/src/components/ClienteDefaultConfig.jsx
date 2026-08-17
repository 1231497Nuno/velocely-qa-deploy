import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Plus, Pencil, Trash2, Shield } from "lucide-react";
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
 * Gestão de clientes default (código + nome), no mesmo formato dos artigos diversos.
 * Consumidor Final é de sistema e não pode ser eliminado.
 */
export default function ClienteDefaultConfig({ open, onOpenChange, onChanged }) {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await api.post("/clientes/ensure-sistema");
      const data = await api.get("/clientes/defaults");
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
      toast.error("Erro ao carregar clientes default");
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
    setFormOpen(true);
  };

  const openEdit = (c) => {
    if (c.sistema) return toast.error("O Consumidor Final não pode ser alterado");
    setEditId(c.id);
    setNome(c.nome || "");
    setFormOpen(true);
  };

  const save = async () => {
    if (!nome.trim()) return toast.error("Indique o nome");
    setSaving(true);
    try {
      const body = {
        nome: nome.trim(),
        tipo: "particular",
        is_default: true,
      };
      if (editId) {
        await api.put(`/clientes/${editId}`, body);
        toast.success("Cliente default atualizado");
      } else {
        await api.post("/clientes", body);
        toast.success("Cliente default criado");
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

  const remove = async (c) => {
    if (c.sistema) return toast.error("Não é possível eliminar o Consumidor Final");
    if (!window.confirm("Eliminar este cliente default?")) return;
    try {
      await api.del(`/clientes/${c.id}`);
      toast.success("Eliminado");
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Erro ao eliminar");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Clientes default</DialogTitle>
            <DialogDescription>
              Orçamentos sem cliente usam o <strong>Consumidor Final</strong>. Pode adicionar outros defaults; esse não pode ser eliminado.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end mb-2">
            {can("clientes", "create") && (
              <button
                type="button"
                data-testid="cliente-default-novo-btn"
                onClick={openNew}
                className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
              >
                <Plus size={14} /> Novo default
              </button>
            )}
          </div>

          <div className="border border-gray-200 rounded-sm overflow-hidden" data-testid="cliente-default-lista">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Código</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100" data-testid={`cliente-default-row-${c.id}`}>
                    <td className="px-3 py-2 tabular-nums text-xs text-gray-600 font-mono">{c.codigo || "—"}</td>
                    <td className="px-3 py-2 text-gray-900">
                      <span className="inline-flex items-center gap-1.5">
                        {c.nome}
                        {c.sistema && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm">
                            <Shield size={10} /> Sistema
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {can("clientes", "edit") && !c.sistema && (
                          <button type="button" onClick={() => openEdit(c)} className="p-1 rounded-sm hover:bg-gray-100 text-gray-600" title="Editar">
                            <Pencil size={14} />
                          </button>
                        )}
                        {can("clientes", "delete") && !c.sistema && (
                          <button type="button" onClick={() => remove(c)} className="p-1 rounded-sm hover:bg-red-50 text-red-600" title="Eliminar">
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
                      {loading ? "A carregar…" : "Sem clientes default."}
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
            <DialogTitle className="font-display">{editId ? "Editar default" : "Novo cliente default"}</DialogTitle>
            <DialogDescription>
              {editId ? "O código mantém-se." : "Será atribuído automaticamente um código CLI-…"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-1">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
            <input
              data-testid="cliente-default-nome"
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Ex.: Consumidor Final Loja"
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
            />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setFormOpen(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              data-testid="cliente-default-save"
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
