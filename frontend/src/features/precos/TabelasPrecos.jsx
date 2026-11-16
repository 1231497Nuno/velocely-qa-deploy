import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Pencil, Plus, Save, Tags, Trash2, X } from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/Layout";
import ArtigoCombobox from "@/components/ArtigoCombobox";
import ClienteSelector from "@/components/ClienteSelector";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import EntitySelect from "@/components/EntitySelect";

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";

const vazia = () => ({ nome: "", ativo: true, prioridade: 10, de: "", ate: "", cliente_ids: [], clientes_nomes: [], notas: "", regras: [] });
const novaRegra = () => ({ alvo: "artigo", tipo: "preco", artigo_id: "", artigo_nome: "", categoria_id: "", categoria_nome: "", escaloes: [{ qtd_min: 0, valor: "" }] });

function resumoRegra(r) {
  const alvo = r.alvo === "artigo" ? r.artigo_nome || "Artigo" : r.alvo === "categoria" ? `Categoria ${r.categoria_nome || ""}` : "Todos os artigos";
  const esc = (r.escaloes || []).map((e) => `${e.qtd_min > 0 ? `≥${e.qtd_min}: ` : ""}${r.tipo === "preco" ? eur(e.valor) : `−${e.valor}%`}`).join(" · ");
  return `${alvo} — ${esc}`;
}

function Editor({ tabela, artigos, categorias, onClose, onSaved }) {
  const [f, setF] = useState(tabela);
  const [busy, setBusy] = useState(false);
  const setR = (i, patch) => setF((x) => ({ ...x, regras: x.regras.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setE = (i, k, patch) => setR(i, { escaloes: f.regras[i].escaloes.map((e, j) => (j === k ? { ...e, ...patch } : e)) });
  const guardar = async () => {
    setBusy(true);
    try {
      const body = { ...f, regras: f.regras.map((r) => ({ ...r, escaloes: r.escaloes.map((e) => ({ qtd_min: Number(e.qtd_min) || 0, valor: Number(e.valor) || 0 })) })) };
      const out = f.id ? await api.put(`/tabelas-precos/${f.id}`, body) : await api.post("/tabelas-precos", body);
      toast.success("Tabela de preços guardada");
      onSaved(out);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="tabela-editor">
        <DialogHeader>
          <DialogTitle className="font-display">{f.id ? "Editar tabela de preços" : "Nova tabela de preços"}</DialogTitle>
          <DialogDescription>Preço fixo ou desconto por artigo, categoria ou para tudo, com escalões de quantidade.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="sm:col-span-2 text-xs text-gray-600">Nome
            <input className={`${inputCls} w-full mt-1`} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Revendedores, Natal 2026" data-testid="tabela-nome" />
          </label>
          <label className="text-xs text-gray-600">De
            <input type="date" className={`${inputCls} w-full mt-1`} value={f.de || ""} onChange={(e) => setF({ ...f, de: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">Até
            <input type="date" className={`${inputCls} w-full mt-1`} value={f.ate || ""} onChange={(e) => setF({ ...f, ate: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">Prioridade
            <input type="number" min="1" className={`${inputCls} w-full mt-1`} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })} title="Número menor ganha quando várias tabelas se aplicam" />
          </label>
          <label className="flex items-end gap-2 text-sm pb-1.5"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativa</label>
          <div className="sm:col-span-2 text-xs text-gray-600">Só para estes clientes (vazio = todos)
            <div className="mt-1"><ClienteSelector value="" canCreate={false} onChange={(id, nome) => id && !f.cliente_ids.includes(id) && setF({ ...f, cliente_ids: [...f.cliente_ids, id], clientes_nomes: [...(f.clientes_nomes || []), nome] })} testid="tabela-cliente" /></div>
            <div className="flex flex-wrap gap-1 mt-1">
              {f.cliente_ids.map((id, i) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs">
                  {(f.clientes_nomes || [])[i] || id}
                  <button type="button" onClick={() => setF({ ...f, cliente_ids: f.cliente_ids.filter((x) => x !== id), clientes_nomes: (f.clientes_nomes || []).filter((_, j) => j !== i) })}><X size={11} /></button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2 mt-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-800">Regras</div>
            <button type="button" onClick={() => setF({ ...f, regras: [...f.regras, novaRegra()] })} className="btn btn-secundario btn-sm" data-testid="tabela-add-regra"><Plus size={13} /> Regra</button>
          </div>
          {f.regras.map((r, i) => (
            <div key={i} className="border border-gray-200 rounded-sm p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select className={inputCls} value={r.alvo} onChange={(e) => setR(i, { alvo: e.target.value })}>
                  <option value="artigo">Artigo</option><option value="categoria">Categoria</option><option value="todos">Todos os artigos</option>
                </select>
                {r.alvo === "artigo" && (
                  <div className="flex-1 min-w-[14rem]">
                    <ArtigoCombobox artigos={artigos} value={r.artigo_id} permitirCriar={false} onChange={(a) => setR(i, { artigo_id: a?.id || "", artigo_nome: a?.nome || "" })} testid={`regra-artigo-${i}`} />
                  </div>
                )}
                {r.alvo === "categoria" && (
                  <div className="flex-1"><EntitySelect items={categorias} value={r.categoria_id} placeholder="Escolher categoria…" onChange={(id, c) => setR(i, { categoria_id: id, categoria_nome: c?.nome || "" })} /></div>
                )}
                <select className={inputCls} value={r.tipo} onChange={(e) => setR(i, { tipo: e.target.value })}>
                  <option value="preco">Preço por unidade (€)</option><option value="desconto">Desconto (%)</option>
                </select>
                <button type="button" onClick={() => setF({ ...f, regras: f.regras.filter((_, j) => j !== i) })} className="ml-auto text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                Escalões:
                {r.escaloes.map((e, k) => (
                  <span key={k} className="inline-flex items-center gap-1 border border-gray-200 rounded-sm px-1.5 py-1 bg-gray-50">
                    a partir de <input type="number" min="0" className={`${inputCls} w-16 !py-0.5`} value={e.qtd_min} onChange={(ev) => setE(i, k, { qtd_min: ev.target.value })} /> un
                    → <input type="number" min="0" step="0.01" className={`${inputCls} w-20 !py-0.5`} value={e.valor} onChange={(ev) => setE(i, k, { valor: ev.target.value })} /> {r.tipo === "preco" ? "€" : "%"}
                    {r.escaloes.length > 1 && <button type="button" onClick={() => setR(i, { escaloes: r.escaloes.filter((_, j) => j !== k) })}><X size={11} /></button>}
                  </span>
                ))}
                <button type="button" onClick={() => setR(i, { escaloes: [...r.escaloes, { qtd_min: (Number(r.escaloes.at(-1)?.qtd_min) || 0) + 50, valor: "" }] })} className="text-brand hover:underline">+ escalão</button>
              </div>
            </div>
          ))}
          {f.regras.length === 0 && <p className="text-sm text-gray-400">Sem regras ainda.</p>}
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-secundario">Cancelar</button>
          <button type="button" disabled={busy} onClick={guardar} className="btn btn-primario" data-testid="tabela-guardar"><Save size={15} /> Guardar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Catálogo → Tabelas de preços (tarifas): por cliente, artigo/categoria e quantidade. */
export default function TabelasPrecos() {
  const { can } = useAuth();
  const confirmAction = useConfirm();
  const [tabelas, setTabelas] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [edit, setEdit] = useState(null);
  const carregar = () => api.get("/tabelas-precos").then(setTabelas).catch(() => setTabelas([]));
  useEffect(() => {
    carregar();
    api.get("/artigos?lite=1").then(setArtigos).catch(() => {});
    api.get("/categorias").then(setCategorias).catch(() => {});
  }, []);
  const podeEditar = can("artigos", "edit");
  const hoje = new Date().toISOString().slice(0, 10);

  const apagar = async (t) => {
    if (!await confirmAction({ title: `Eliminar «${t.nome}»?`, confirmLabel: "Eliminar", tone: "danger" })) return;
    await api.del(`/tabelas-precos/${t.id}`);
    toast.success("Eliminada");
    carregar();
  };

  return (
    <div data-testid="tabelas-precos">
      <PageHeader
        title="Tabelas de preços"
        subtitle="Preços especiais e descontos por cliente, artigo ou categoria, com escalões de quantidade e validade. Aplicam-se nas encomendas e orçamentos."
        actions={podeEditar && <button type="button" onClick={() => setEdit(vazia())} className="btn btn-primario" data-testid="nova-tabela"><Plus size={16} /> Nova tabela</button>}
      />
      {!tabelas && <div className="text-sm text-gray-500">A carregar...</div>}
      {tabelas && tabelas.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-sm px-6 py-10 text-center text-sm text-gray-500">
          <Tags className="mx-auto mb-2 text-gray-300" size={28} />
          Ainda não há tabelas. Exemplos: «Revendedores −15% em tudo», «Canecas: 4,50 € a partir de 100 un», «Natal 2026» com datas.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(tabelas || []).map((t) => {
          const vigente = t.ativo && (!t.de || t.de <= hoje) && (!t.ate || t.ate >= hoje);
          return (
            <div key={t.id} className="bg-white border border-gray-200 rounded-sm p-4" data-testid={`tabela-${t.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900 flex items-center gap-2">
                    {t.nome}
                    <span className={`text-[11px] rounded-full px-2 py-0.5 border ${vigente ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-gray-50 text-gray-500"}`}>{vigente ? "Em vigor" : "Fora de vigor"}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Prioridade {t.prioridade}
                    {(t.de || t.ate) && ` · ${t.de ? fmtDate(t.de) : "…"} a ${t.ate ? fmtDate(t.ate) : "…"}`}
                    {t.cliente_ids?.length ? ` · ${t.clientes_nomes?.join(", ") || `${t.cliente_ids.length} cliente(s)`}` : " · todos os clientes"}
                  </div>
                </div>
                {podeEditar && (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEdit(JSON.parse(JSON.stringify(t)))} className="p-1.5 text-gray-500 hover:text-gray-900" title="Editar"><Pencil size={15} /></button>
                    <button type="button" onClick={() => { const c = JSON.parse(JSON.stringify(t)); delete c.id; c.nome = `${t.nome} (cópia)`; setEdit(c); }} className="p-1.5 text-gray-500 hover:text-gray-900" title="Duplicar"><Copy size={15} /></button>
                    <button type="button" onClick={() => apagar(t)} className="p-1.5 text-gray-400 hover:text-red-600" title="Eliminar"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                {(t.regras || []).map((r) => <li key={r.id} className="truncate">• {resumoRegra(r)}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      {edit && <Editor tabela={edit} artigos={artigos} categorias={categorias} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); carregar(); }} />}
    </div>
  );
}
