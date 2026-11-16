import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/Layout";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import EntitySelect from "@/components/EntitySelect";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";
const COR = { atrasada: "bg-red-50 text-red-800 border-red-200", proxima: "bg-amber-50 text-amber-800 border-amber-200", ok: "bg-emerald-50 text-emerald-800 border-emerald-200" };
const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);

/** Manutenção das máquinas: planos por horas de uso (das OF) ou por dias; registo do que foi feito; alertas. */
export default function Manutencao() {
  const { can } = useAuth();
  const podeEditar = can("maquinas", "edit");
  const confirm = useConfirm();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [feita, setFeita] = useState(null);
  const carregar = () => api.get("/manutencao").then(setD).catch(() => toast.error("Não foi possível carregar"));
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = async () => {
    try {
      if (edit.id) await api.put(`/manutencao/planos/${edit.id}`, edit); else await api.post("/manutencao/planos", edit);
      setEdit(null); carregar(); toast.success("Plano guardado");
    } catch (e) { erro(e, "Não foi possível guardar"); }
  };
  const registar = async () => {
    try { await api.post(`/manutencao/planos/${feita.id}/feita`, feita.reg); setFeita(null); carregar(); toast.success("Manutenção registada"); }
    catch (e) { erro(e, "Não foi possível registar"); }
  };
  const apagar = async (p) => {
    if (!(await confirm({ title: "Apagar plano?", description: p.nome, confirmLabel: "Apagar", tone: "danger" }))) return;
    await api.del(`/manutencao/planos/${p.id}`); carregar();
  };
  if (!d) return null;
  return (
    <div>
      <PageHeader title="Manutenção das máquinas" subtitle="Planos por horas de trabalho (contadas pelas OF) ou por dias. Avisos em Tarefas quando está a chegar ou atrasada."
        actions={podeEditar && <button type="button" className="btn btn-primario" onClick={() => setEdit({ maquina_id: d.maquinas[0]?.id || "", nome: "", tipo: "horas", intervalo: 100, instrucoes: "" })} data-testid="manut-novo"><Plus size={15} /> Plano</button>} />
      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        {d.maquinas.map((m) => <span key={m.id} className="border border-gray-200 bg-white rounded-sm px-2 py-1">{m.nome}: <b className="tabular-nums">{m.horas_uso} h</b> de trabalho</span>)}
      </div>
      <div className="bg-white border border-gray-200 rounded-sm divide-y divide-gray-100">
        {d.planos.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <Wrench size={16} className="text-gray-400" />
            <div className="flex-1 min-w-[14rem]">
              <div className="font-medium">{p.nome} <span className="text-gray-500 font-normal">· {p.maquina_nome}</span></div>
              <div className="text-xs text-gray-500">A cada {p.intervalo} {p.tipo === "horas" ? "horas de trabalho" : "dias"}{p.ultima?.data ? ` · última ${fmtDate(p.ultima.data)}` : ""}{p.instrucoes ? ` · ${p.instrucoes}` : ""}</div>
            </div>
            <span className={`border rounded-sm px-2 py-0.5 text-xs ${COR[p.situacao]}`}>{p.situacao === "ok" ? "Faltam" : p.situacao === "proxima" ? "A chegar —" : "Atrasada —"} {p.texto}</span>
            {podeEditar && <>
              <button type="button" className="btn btn-secundario" onClick={() => setFeita({ ...p, reg: { data: new Date().toISOString().slice(0, 10), notas: "", custo: "" } })}><CheckCircle2 size={15} /> Feita</button>
              <button type="button" className="p-1.5 text-gray-500" onClick={() => setEdit({ ...p })}><Pencil size={15} /></button>
              <button type="button" className="p-1.5 text-gray-400 hover:text-red-600" onClick={() => apagar(p)}><Trash2 size={15} /></button>
            </>}
            {(p.registos || []).length > 0 && (
              <div className="basis-full text-xs text-gray-500 pl-7">{p.registos.slice(-3).reverse().map((r) => `${fmtDate(r.data)}${r.custo ? ` (${eur(r.custo)})` : ""}${r.notas ? ` — ${r.notas}` : ""}`).join(" · ")}</div>
            )}
          </div>
        ))}
        {!d.planos.length && <div className="px-4 py-8 text-center text-sm text-gray-400">Sem planos. Ex.: limpar lentes do laser a cada 40 h, trocar tubo a cada 2000 h, limpeza das cabeças da UV a cada 7 dias.</div>}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar plano" : "Novo plano de manutenção"}</DialogTitle><DialogDescription>Por horas conta o trabalho registado nas OF dessa máquina.</DialogDescription></DialogHeader>
          {edit && <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-xs text-gray-600">Máquina<EntitySelect items={d.maquinas} value={edit.maquina_id} placeholder="Escolher máquina…" hint={() => ""} onChange={(id) => setEdit({ ...edit, maquina_id: id })} /></label>
            <label className="col-span-2 text-xs text-gray-600">O quê<input className={inputCls} value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} placeholder="Ex.: Limpar lentes e espelhos" data-testid="manut-nome" /></label>
            <label className="text-xs text-gray-600">Contar por<select className={inputCls} value={edit.tipo} onChange={(e) => setEdit({ ...edit, tipo: e.target.value })}><option value="horas">Horas de trabalho</option><option value="dias">Dias</option></select></label>
            <label className="text-xs text-gray-600">A cada<input type="number" min="1" className={inputCls} value={edit.intervalo} onChange={(e) => setEdit({ ...edit, intervalo: e.target.value })} /></label>
            <label className="col-span-2 text-xs text-gray-600">Instruções<input className={inputCls} value={edit.instrucoes || ""} onChange={(e) => setEdit({ ...edit, instrucoes: e.target.value })} /></label>
          </div>}
          <DialogFooter><button type="button" className="btn btn-secundario" onClick={() => setEdit(null)}>Cancelar</button><button type="button" className="btn btn-primario" onClick={guardar} data-testid="manut-guardar">Guardar</button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!feita} onOpenChange={(o) => !o && setFeita(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registar manutenção</DialogTitle><DialogDescription>{feita?.nome} · {feita?.maquina_nome}</DialogDescription></DialogHeader>
          {feita && <div className="space-y-2">
            <label className="text-xs text-gray-600 block">Data<input type="date" className={inputCls} value={feita.reg.data} onChange={(e) => setFeita({ ...feita, reg: { ...feita.reg, data: e.target.value } })} /></label>
            <label className="text-xs text-gray-600 block">Custo (€)<input type="number" step="0.01" className={inputCls} value={feita.reg.custo} onChange={(e) => setFeita({ ...feita, reg: { ...feita.reg, custo: e.target.value } })} /></label>
            <label className="text-xs text-gray-600 block">Notas<input className={inputCls} value={feita.reg.notas} onChange={(e) => setFeita({ ...feita, reg: { ...feita.reg, notas: e.target.value } })} /></label>
          </div>}
          <DialogFooter><button type="button" className="btn btn-secundario" onClick={() => setFeita(null)}>Cancelar</button><button type="button" className="btn btn-primario" onClick={registar}>Registar</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
