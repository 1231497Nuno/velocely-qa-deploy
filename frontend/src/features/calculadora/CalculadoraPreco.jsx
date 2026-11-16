import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, Plus, Save, Trash2 } from "lucide-react";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { calcular, CAMPOS_ENTRADA, CAMPOS_TECNICA, TIPOS_TECNICA } from "@/lib/calculadoraPreco";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";

/** Calculadora (sem estado próprio de página): escolhe a técnica, preenche e mostra o preço. */
export function Calculadora({ tecnicas, quantidadeInicial = 1, onResultado }) {
  const [tid, setTid] = useState(tecnicas[0]?.id || "");
  const [e, setE] = useState({ quantidade: quantidadeInicial });
  const t = tecnicas.find((x) => x.id === tid) || tecnicas[0];
  const res = useMemo(() => (t ? calcular(t, e) : null), [t, e]);
  useEffect(() => { onResultado?.(res && !res.erro ? { ...res, tecnica: t?.nome, quantidade: Number(e.quantidade) || 1, entrada: e } : null); }, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <div className="text-sm text-gray-500">Sem técnicas configuradas.</div>;
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">Técnica
          <select className={inputCls} value={t.id} onChange={(ev) => setTid(ev.target.value)} data-testid="calc-tecnica">
            {tecnicas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select></label>
        <label className="text-xs text-gray-600">Quantidade<input type="number" min="1" className={inputCls} value={e.quantidade} onChange={(ev) => setE({ ...e, quantidade: ev.target.value })} data-testid="calc-qtd" /></label>
        {(CAMPOS_ENTRADA[t.tipo] || []).map(([k, l]) => (
          <label key={k} className="text-xs text-gray-600">{l}<input type="number" step="any" min="0" className={inputCls} value={e[k] ?? ""} onChange={(ev) => setE({ ...e, [k]: ev.target.value })} data-testid={`calc-${k}`} /></label>
        ))}
      </div>
      {res?.erro ? <div className="text-sm text-red-700">{res.erro}</div> : res && (
        <div className="rounded-sm border border-gray-200 bg-gray-50 p-3" data-testid="calc-resultado">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div><span className="text-xs text-gray-500">Preço por unidade</span><div className="text-2xl font-bold tabular-nums">{eur(res.unit)}</div></div>
            <div><span className="text-xs text-gray-500">Total ({Number(e.quantidade) || 1} un.)</span><div className="text-lg font-semibold tabular-nums">{eur(res.total)}</div></div>
          </div>
          <div className="text-xs text-gray-500 mt-1 dado-custo">{res.detalhe}</div>
        </div>
      )}
    </div>
  );
}

/** Diálogo da calculadora usado no orçamento: aplica o preço a uma linha. */
export function CalculadoraDialog({ open, onClose, linhas = [], onAplicar }) {
  const [tecnicas, setTecnicas] = useState(null);
  const [res, setRes] = useState(null);
  const [linha, setLinha] = useState(0);
  useEffect(() => { if (open) api.get("/tecnicas-preco").then(setTecnicas).catch(() => toast.error("Não foi possível carregar as técnicas")); }, [open]);
  const sel = linhas[linha];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calculator size={18} /> Calculadora de preço</DialogTitle>
          <DialogDescription>Calcula o preço pela técnica e aplica-o a uma linha do orçamento.</DialogDescription>
        </DialogHeader>
        {tecnicas && <Calculadora key={linha} tecnicas={tecnicas} quantidadeInicial={Number(sel?.quantidade) || 1} onResultado={setRes} />}
        {linhas.length > 0 && (
          <label className="text-xs text-gray-600 block">Aplicar à linha
            <select className={inputCls} value={linha} onChange={(e) => setLinha(Number(e.target.value))}>
              {linhas.map((l, i) => <option key={l.id || i} value={i}>{i + 1}. {l.artigo_nome || l.descricao || "Linha"} ({l.quantidade} un.)</option>)}
            </select></label>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Fechar</button>
          {linhas.length > 0 && <button type="button" className="btn btn-primario" disabled={!res} onClick={() => onAplicar(linha, res)} data-testid="calc-aplicar">Aplicar à linha</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Página Calculadora de preços: calcular e (administradores) configurar as técnicas. */
export default function CalculadoraPreco() {
  const { isAdmin } = useAuth();
  const [tecnicas, setTecnicas] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/tecnicas-preco").then((r) => { setTecnicas(r); setEdit(r); }).catch(() => toast.error("Não foi possível carregar")); }, []);
  const setT = (i, patch) => setEdit((x) => x.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const guardar = async () => {
    setBusy(true);
    try {
      const r = await api.put("/tecnicas-preco", { tecnicas: edit.map((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, ["id", "nome", "tipo"].includes(k) ? v : Number(v) || 0]))) });
      setTecnicas(r); setEdit(r); toast.success("Técnicas guardadas");
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível guardar"); } finally { setBusy(false); }
  };
  if (!tecnicas) return null;
  return (
    <div>
      <PageHeader title="Calculadora de preços" subtitle="Preço por técnica: DTF ao metro linear, impressão por área, laser por tempo e artigos de fornecedor (custo + IVA + margem)." />
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <div className="bg-white border border-gray-200 rounded-sm p-4"><Calculadora tecnicas={tecnicas} /></div>
        {isAdmin && edit && (
          <div className="bg-white border border-gray-200 rounded-sm p-4 space-y-4" data-testid="calc-tecnicas">
            <div className="font-semibold text-sm">Técnicas e parâmetros</div>
            {edit.map((t, i) => (
              <div key={i} className="border border-gray-200 rounded-sm p-3 space-y-2">
                <div className="flex gap-2">
                  <input className={inputCls} value={t.nome} onChange={(e) => setT(i, { nome: e.target.value })} />
                  <select className={`${inputCls} w-auto`} value={t.tipo} onChange={(e) => setT(i, { tipo: e.target.value })}>
                    {Object.entries(TIPOS_TECNICA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button type="button" className="p-1.5 text-gray-400 hover:text-red-600" onClick={() => setEdit(edit.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(CAMPOS_TECNICA[t.tipo] || []).map(([k, l]) => (
                    <label key={k} className="text-xs text-gray-600">{l}<input type="number" step="any" min="0" className={inputCls} value={t[k] ?? ""} onChange={(e) => setT(i, { [k]: e.target.value })} /></label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex justify-between">
              <button type="button" className="btn btn-secundario" onClick={() => setEdit([...edit, { id: `t${Date.now()}`, nome: "Nova técnica", tipo: "area", margem_pct: 100 }])}><Plus size={15} /> Técnica</button>
              <button type="button" className="btn btn-primario" disabled={busy} onClick={guardar}><Save size={15} /> Guardar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
