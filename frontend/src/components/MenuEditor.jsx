import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

/**
 * Aplica a personalização do utilizador aos grupos predefinidos (já filtrados por permissões).
 * Itens novos (que ainda não estão na personalização) entram no seu grupo predefinido.
 */
export function aplicarMenu(base, menu) {
  if (!menu || !Array.isArray(menu.grupos) || !menu.grupos.length) return base;
  const porTid = new Map();
  const grupoDe = new Map();
  base.forEach((g) => g.items.forEach((it) => { porTid.set(it.tid, it); grupoDe.set(it.tid, g); }));
  const ocultos = new Set(menu.ocultos || []);
  const colocados = new Set();
  const out = menu.grupos.map((g) => {
    const items = (g.itens || []).map((t) => porTid.get(t)).filter(Boolean);
    items.forEach((i) => colocados.add(i.tid));
    return { id: g.id, label: g.label, items };
  });
  porTid.forEach((it, tid) => {
    if (colocados.has(tid)) return;
    const gb = grupoDe.get(tid);
    let alvo = out.find((g) => g.id === gb.id);
    if (!alvo) { alvo = { id: gb.id, label: gb.label, items: [] }; out.push(alvo); }
    alvo.items.push(it);
  });
  return out.map((g) => ({ ...g, items: g.items.filter((i) => !ocultos.has(i.tid)) })).filter((g) => g.items.length > 0);
}

const mover = (arr, i, d) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const n = [...arr];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
};

/** Editor do menu lateral: renomear e ordenar grupos, ordenar/mover/ocultar opções (arrastar ou setas). */
export default function MenuEditor({ open, onOpenChange, base, menu, onGuardado }) {
  const [grupos, setGrupos] = useState([]);
  const [ocultos, setOcultos] = useState([]);
  const [arrasto, setArrasto] = useState(null); // { g, i }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const todos = aplicarMenu(base, menu ? { ...menu, ocultos: [] } : null);
    setGrupos(todos.map((g) => ({ id: g.id, label: g.label, items: g.items })));
    setOcultos(menu?.ocultos || []);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItens = (gi, items) => setGrupos((gs) => gs.map((g, k) => (k === gi ? { ...g, items } : g)));
  const largar = (gi, ii) => {
    if (!arrasto) return;
    setGrupos((gs) => {
      const n = gs.map((g) => ({ ...g, items: [...g.items] }));
      const [it] = n[arrasto.g].items.splice(arrasto.i, 1);
      const pos = ii == null ? n[gi].items.length : ii;
      n[gi].items.splice(pos, 0, it);
      return n;
    });
    setArrasto(null);
  };
  const moverPara = (gi, ii, alvo) => {
    setGrupos((gs) => {
      const n = gs.map((g) => ({ ...g, items: [...g.items] }));
      const [it] = n[gi].items.splice(ii, 1);
      n[alvo].items.push(it);
      return n;
    });
  };
  const guardar = async (valor) => {
    setBusy(true);
    try {
      const r = await api.put("/me/preferencias", { menu: valor });
      onGuardado(r.menu || null);
      toast.success(valor ? "Menu guardado" : "Menu reposto");
      onOpenChange(false);
    } catch { toast.error("Não foi possível guardar o menu"); } finally { setBusy(false); }
  };
  const payload = () => ({ grupos: grupos.filter((g) => g.items.length || g.novo).map((g) => ({ id: g.id, label: g.label, itens: g.items.map((i) => i.tid) })), ocultos });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Personalizar o menu</DialogTitle>
          <DialogDescription>Arraste as opções (ou use as setas) para as ordenar ou mudar de grupo. Pode renomear grupos, criar novos e ocultar o que não usa.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1" data-testid="menu-editor">
          {grupos.map((g, gi) => (
            <div key={g.id} className="border border-gray-200 rounded-sm" onDragOver={(e) => e.preventDefault()} onDrop={() => largar(gi, null)}>
              <div className="flex items-center gap-1.5 bg-gray-50 px-2 py-1.5 border-b border-gray-200">
                <input value={g.label} onChange={(e) => setGrupos((gs) => gs.map((x, k) => (k === gi ? { ...x, label: e.target.value } : x)))}
                  className="flex-1 bg-transparent text-xs font-semibold uppercase tracking-[0.1em] text-gray-700 px-1 py-1 rounded-sm focus:bg-white focus:outline-none focus:ring-1 focus:ring-black/20" aria-label="Nome do grupo" />
                <button type="button" title="Subir grupo" className="p-1 text-gray-500 hover:text-black" onClick={() => setGrupos((gs) => mover(gs, gi, -1))}><ArrowUp size={14} /></button>
                <button type="button" title="Descer grupo" className="p-1 text-gray-500 hover:text-black" onClick={() => setGrupos((gs) => mover(gs, gi, 1))}><ArrowDown size={14} /></button>
                {!g.items.length && <button type="button" title="Remover grupo vazio" className="p-1 text-red-600" onClick={() => setGrupos((gs) => gs.filter((_, k) => k !== gi))}><Trash2 size={14} /></button>}
              </div>
              <ul className="divide-y divide-gray-100 min-h-[2rem]">
                {g.items.map((it, ii) => {
                  const oculto = ocultos.includes(it.tid);
                  const Icon = it.icon;
                  return (
                    <li key={it.tid} draggable onDragStart={() => setArrasto({ g: gi, i: ii })} onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.stopPropagation(); largar(gi, ii); }}
                      className={`flex items-center gap-2 px-2 py-1.5 text-sm bg-white ${oculto ? "opacity-50" : ""}`}>
                      <GripVertical size={14} className="text-gray-300 cursor-grab shrink-0" />
                      {Icon && <Icon size={15} className="text-gray-500 shrink-0" />}
                      <span className="flex-1 min-w-0 truncate">{it.label}</span>
                      <select value={gi} onChange={(e) => moverPara(gi, ii, Number(e.target.value))} className="text-xs border border-gray-200 rounded-sm px-1 py-0.5 bg-white max-w-[9rem]" title="Mover para o grupo">
                        {grupos.map((x, k) => <option key={x.id} value={k}>{x.label || "Grupo"}</option>)}
                      </select>
                      <button type="button" title="Subir" className="p-1 text-gray-500 hover:text-black" onClick={() => setItens(gi, mover(g.items, ii, -1))}><ArrowUp size={13} /></button>
                      <button type="button" title="Descer" className="p-1 text-gray-500 hover:text-black" onClick={() => setItens(gi, mover(g.items, ii, 1))}><ArrowDown size={13} /></button>
                      <button type="button" title={oculto ? "Mostrar" : "Ocultar"} className="p-1 text-gray-500 hover:text-black"
                        onClick={() => setOcultos((o) => (oculto ? o.filter((x) => x !== it.tid) : [...o, it.tid]))}>{oculto ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                    </li>
                  );
                })}
                {!g.items.length && <li className="px-3 py-2 text-xs text-gray-400">Arraste opções para aqui.</li>}
              </ul>
            </div>
          ))}
          <button type="button" className="btn btn-secundario btn-sm" onClick={() => setGrupos((gs) => [...gs, { id: `g${Date.now()}`, label: "Novo grupo", items: [], novo: true }])}><Plus size={14} /> Novo grupo</button>
        </div>
        <DialogFooter className="gap-2">
          <button type="button" className="btn btn-secundario mr-auto" disabled={busy} onClick={() => guardar(null)}><RotateCcw size={14} /> Repor predefinido</button>
          <button type="button" className="btn btn-secundario" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy} onClick={() => guardar(payload())} data-testid="menu-editor-guardar">Guardar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
