import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { CORES_FALLBACK, TIPOS_ESTADO, apiError, btnPrimary, btnSecondary, inputCls } from "./crmShared";

function Cores({ cores, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-1">
      {cores.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${value === c ? "border-gray-900" : "border-white ring-1 ring-gray-200"}`}
          style={{ background: c }}
          title={c}
        >
          {value === c && <Check size={11} className="text-white" />}
        </button>
      ))}
    </div>
  );
}

/** Gestão das colunas do funil: criar, renomear, cor, tipo, ordem e eliminar. */
export default function EstadosDialog({ open, onOpenChange, estados, cores, onChanged }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [linhas, setLinhas] = useState([]);
  const [novo, setNovo] = useState({ nome: "", cor: "#64748b", tipo: "aberto" });
  const [apagar, setApagar] = useState(null); // { id, destino }
  const [busy, setBusy] = useState(false);
  const paleta = cores?.length ? cores : CORES_FALLBACK;
  const canEdit = can("crm", "edit");
  const canDelete = can("crm", "delete");

  useEffect(() => {
    if (open) {
      setLinhas(estados.map((e) => ({ ...e })));
      setApagar(null);
      setNovo({ nome: "", cor: paleta[1] || paleta[0], tipo: "aberto" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, estados]);

  const alterado = (l) => {
    const orig = estados.find((e) => e.id === l.id);
    return orig && (orig.nome !== l.nome.trim() || orig.cor !== l.cor || orig.tipo !== l.tipo);
  };

  function editar(id, patch) {
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function guardar(l) {
    if (!l.nome.trim()) {
      toast.error("O nome não pode ficar vazio");
      return;
    }
    setBusy(true);
    try {
      await api.put(`/crm/estados/${l.id}`, { nome: l.nome, cor: l.cor, tipo: l.tipo });
      toast.success("Estado guardado");
      await onChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function mover(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= linhas.length) return;
    const nova = [...linhas];
    [nova[idx], nova[j]] = [nova[j], nova[idx]];
    setLinhas(nova);
    try {
      await api.put("/crm/estados-ordem", { ids: nova.map((l) => l.id) });
      await onChanged();
    } catch (e) {
      toast.error(apiError(e));
      setLinhas(estados.map((x) => ({ ...x })));
    }
  }

  async function criar() {
    if (!novo.nome.trim()) return;
    setBusy(true);
    try {
      await api.post("/crm/estados", novo);
      toast.success(`Estado «${novo.nome.trim()}» criado`);
      setNovo({ nome: "", cor: novo.cor, tipo: "aberto" });
      await onChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function eliminar(l) {
    if (l.total_leads > 0) {
      if (!apagar || apagar.id !== l.id) {
        setApagar({ id: l.id, destino: linhas.find((x) => x.id !== l.id)?.id || "" });
        return;
      }
    } else {
      const ok = await confirm({ title: "Eliminar estado?", description: `«${l.nome}» deixa de aparecer no quadro.`, confirmLabel: "Eliminar", tone: "danger" });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const qs = l.total_leads > 0 ? `?mover_para=${encodeURIComponent(apagar.destino)}` : "";
      const r = await api.del(`/crm/estados/${l.id}${qs}`);
      toast.success(r.leads_movidos ? `Estado eliminado — ${r.leads_movidos} lead(s) movido(s)` : "Estado eliminado");
      setApagar(null);
      await onChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="crm-estados-dialog">
        <DialogHeader>
          <DialogTitle>Estados do funil</DialogTitle>
          <DialogDescription>
            As colunas do quadro. Pode mudar nomes e cores, reordenar e criar estados novos. O tipo indica se um lead nesse estado
            está em aberto, ganho ou perdido (usado nos totais e alertas).
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {linhas.map((l, idx) => (
            <li key={l.id} className="rounded-sm border border-gray-200 p-2.5" data-testid={`crm-estado-row-${l.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col">
                  <button type="button" disabled={!canEdit || idx === 0 || busy} onClick={() => mover(idx, -1)} className="p-0.5 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Subir">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" disabled={!canEdit || idx === linhas.length - 1 || busy} onClick={() => mover(idx, 1)} className="p-0.5 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Descer">
                    <ArrowDown size={14} />
                  </button>
                </div>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: l.cor }} />
                <input
                  className={inputCls + " flex-1 min-w-[10rem] !py-1.5"}
                  value={l.nome}
                  disabled={!canEdit}
                  onChange={(e) => editar(l.id, { nome: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && alterado(l)) guardar(l); }}
                  data-testid={`crm-estado-nome-${l.id}`}
                />
                <select className={inputCls + " !w-auto !py-1.5"} value={l.tipo} disabled={!canEdit} onChange={(e) => editar(l.id, { tipo: e.target.value })}>
                  {TIPOS_ESTADO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <span className="text-xs text-gray-500 tabular-nums w-14 text-right">{l.total_leads ?? 0} lead{l.total_leads === 1 ? "" : "s"}</span>
                {alterado(l) && (
                  <button type="button" className={btnPrimary + " btn-sm"} onClick={() => guardar(l)} disabled={busy} data-testid={`crm-estado-save-${l.id}`}>
                    Guardar
                  </button>
                )}
                {canDelete && (
                  <button type="button" onClick={() => eliminar(l)} disabled={busy || linhas.length <= 1} className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30" title="Eliminar estado" data-testid={`crm-estado-del-${l.id}`}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div className="mt-2 pl-7">
                <Cores cores={paleta} value={l.cor} disabled={!canEdit} onChange={(c) => editar(l.id, { cor: c })} />
              </div>
              {apagar?.id === l.id && (
                <div className="mt-2 ml-7 flex flex-wrap items-center gap-2 rounded-sm bg-amber-50 border border-amber-200 px-2.5 py-2 text-sm">
                  <span>Os {l.total_leads} lead(s) passam para</span>
                  <select className={inputCls + " !w-auto !py-1"} value={apagar.destino} onChange={(e) => setApagar({ ...apagar, destino: e.target.value })}>
                    {linhas.filter((x) => x.id !== l.id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                  <button type="button" className="bg-red-600 hover:bg-red-700 text-white rounded-sm px-3 py-1 text-sm" onClick={() => eliminar(l)} disabled={busy} data-testid={`crm-estado-del-confirm-${l.id}`}>
                    Eliminar estado
                  </button>
                  <button type="button" className="text-gray-600 hover:text-gray-900 text-sm" onClick={() => setApagar(null)}>Cancelar</button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {canEdit && (
          <div className="rounded-sm border border-dashed border-gray-300 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={inputCls + " flex-1 min-w-[10rem] !py-1.5"}
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") criar(); }}
                placeholder="Novo estado (ex.: Amostra enviada)"
                data-testid="crm-estado-novo-nome"
              />
              <select className={inputCls + " !w-auto !py-1.5"} value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>
                {TIPOS_ESTADO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <button type="button" className={btnPrimary + " !py-1.5"} onClick={criar} disabled={busy || !novo.nome.trim()} data-testid="crm-estado-novo-add">
                <Plus size={14} /> Adicionar
              </button>
            </div>
            <Cores cores={paleta} value={novo.cor} onChange={(c) => setNovo({ ...novo, cor: c })} />
          </div>
        )}

        <DialogFooter>
          <button type="button" className={btnSecondary} onClick={() => onOpenChange(false)}>Fechar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
