import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ClipboardCheck, FileDown, Lock, Plus, Settings2, ShoppingCart, SlidersHorizontal, Trash2 } from "lucide-react";
import { API, api, eur, fmtDate } from "@/lib/api";
import { openAuthenticated } from "@/lib/openAuthenticated";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/Layout";
import DetailTabs from "@/components/DetailTabs";
import ArtigoCombobox from "@/components/ArtigoCombobox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";
const num = (v, d = 2) => (Number(v) || 0).toLocaleString("pt-PT", { maximumFractionDigits: d });
const erro = (e, msg) => {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : msg);
};
const TIPO_MOV = { entrada: "Entrada (receção)", ajuste: "Acerto", inventario: "Inventário", nao_conformidade: "Não conformidade", consumo: "Consumo (produção)", producao: "Produção" };
const ESTADO = {
  ok: { label: "OK", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  abaixo: { label: "Abaixo do nível", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  negativo: { label: "Negativo", cls: "bg-red-50 text-red-700 border-red-200" },
};

function ConfigDialog({ artigo, onClose, onSaved }) {
  const [f, setF] = useState({ unidade_compra: artigo.unidade_compra || "", fator_compra: artigo.fator_compra || 1, nivel_reabastecimento: artigo.nivel_reabastecimento || 0 });
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    setBusy(true);
    try {
      await api.put(`/stock/artigos/${artigo.id}/config`, { ...f, gere_stock: true });
      toast.success("Artigo configurado");
      onSaved();
    } catch (e) { erro(e, "Não foi possível guardar"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Stock de «{artigo.nome}»</DialogTitle>
          <DialogDescription>Unidade de stock: <b>{artigo.unidade || "un"}</b>. Se compra noutra unidade (ex.: rolo de 50 m), indique a conversão.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-gray-600">Unidade de compra</label><input className={inputCls} placeholder={artigo.unidade || "un"} value={f.unidade_compra} onChange={(e) => setF({ ...f, unidade_compra: e.target.value })} data-testid="cfg-unidade-compra" /></div>
          <div><label className="text-xs font-medium text-gray-600">1 {f.unidade_compra || "un. compra"} = … {artigo.unidade || "un"}</label><input type="number" min="0" step="any" className={inputCls} value={f.fator_compra} onChange={(e) => setF({ ...f, fator_compra: e.target.value })} data-testid="cfg-fator" /></div>
          <div className="col-span-2"><label className="text-xs font-medium text-gray-600">Nível de reabastecimento ({artigo.unidade || "un"})</label><input type="number" min="0" step="any" className={inputCls} value={f.nivel_reabastecimento} onChange={(e) => setF({ ...f, nivel_reabastecimento: e.target.value })} data-testid="cfg-nivel" />
            <p className="text-xs text-gray-500 mt-1">Abaixo deste valor (contando o que está em compra e o que as encomendas abertas vão gastar) o artigo aparece nas sugestões de compra.</p></div>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy} onClick={guardar} data-testid="cfg-guardar">Guardar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AjusteDialog({ artigo, onClose, onSaved }) {
  const [qtd, setQtd] = useState(artigo.qtd_stock);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    if (!motivo.trim()) { toast.error("Indique o motivo do acerto"); return; }
    setBusy(true);
    try {
      await api.post("/stock/ajuste", { artigo_id: artigo.id, nova_quantidade: Number(qtd) || 0, motivo });
      toast.success("Stock acertado");
      onSaved();
    } catch (e) { erro(e, "Não foi possível acertar"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Acertar stock</DialogTitle>
          <DialogDescription>{artigo.nome} — atual {num(artigo.qtd_stock)} {artigo.unidade}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs font-medium text-gray-600">Quantidade real ({artigo.unidade})</label><input type="number" step="any" className={inputCls} value={qtd} onChange={(e) => setQtd(e.target.value)} data-testid="ajuste-qtd" /></div>
          <div><label className="text-xs font-medium text-gray-600">Motivo</label><input className={inputCls} placeholder="Ex.: quebra, contagem, oferta" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="ajuste-motivo" /></div>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy} onClick={guardar} data-testid="ajuste-guardar">Acertar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabStock({ podeEditar, verCustos }) {
  const [dados, setDados] = useState({ items: [], valor_total: 0 });
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [cfg, setCfg] = useState(null);
  const [aj, setAj] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const carregar = useCallback(() => api.get(`/stock?filtro=${filtro}&q=${encodeURIComponent(q)}`).then(setDados).catch(() => toast.error("Não foi possível carregar o stock")), [filtro, q]);
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [carregar]);
  useEffect(() => { if (podeEditar) api.get("/artigos?lite=1").then((r) => setArtigos((Array.isArray(r) ? r : r.items || []).filter((a) => a.tipo_artigo !== "servico"))).catch(() => {}); }, [podeEditar]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="Procurar artigo ou fornecedor…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="stock-q" />
        <select className={`${inputCls} w-auto`} value={filtro} onChange={(e) => setFiltro(e.target.value)} data-testid="stock-filtro">
          <option value="todos">Todos</option><option value="abaixo">Abaixo do nível</option><option value="negativo">Negativos</option>
        </select>
        {podeEditar && (
          <div className="w-72"><ArtigoCombobox artigos={artigos} value="" permitirCriar={false} placeholder="Gerir stock de outro artigo…" testid="stock-add-artigo"
            onChange={(a) => a && setCfg({ ...a, qtd_stock: a.qtd_stock || 0 })} /></div>
        )}
        {verCustos && <div className="ml-auto text-sm text-gray-600 dado-custo">Valor em stock: <b className="tabular-nums">{eur(dados.valor_total)}</b></div>}
      </div>
      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50">
            <tr><th className="text-left px-3 py-2">Artigo</th><th className="text-left px-3">Fornecedor</th><th className="text-right px-3">Stock</th><th className="text-right px-3">Nível</th>
              <th className="text-left px-3">Compra</th>{verCustos && <th className="text-right px-3 dado-custo">Custo médio</th>}{verCustos && <th className="text-right px-3 dado-custo">Valor</th>}<th className="px-3">Estado</th><th /></tr>
          </thead>
          <tbody>
            {dados.items.map((a) => (
              <tr key={a.id} className="border-t border-gray-100" data-testid={`stock-row-${a.id}`}>
                <td className="px-3 py-2"><div className="font-medium">{a.nome}</div><div className="text-xs text-gray-400">{a.codigo}</div></td>
                <td className="px-3 text-gray-600">{a.fornecedor_nome || "—"}</td>
                <td className="px-3 text-right tabular-nums font-medium">{num(a.qtd_stock)} <span className="text-xs text-gray-400">{a.unidade}</span></td>
                <td className="px-3 text-right tabular-nums text-gray-600">{a.nivel_reabastecimento ? num(a.nivel_reabastecimento) : "—"}</td>
                <td className="px-3 text-xs text-gray-500">{a.unidade_compra && a.fator_compra !== 1 ? `1 ${a.unidade_compra} = ${num(a.fator_compra)} ${a.unidade}` : "—"}</td>
                {verCustos && <td className="px-3 text-right tabular-nums dado-custo">{eur(a.custo_medio)}</td>}
                {verCustos && <td className="px-3 text-right tabular-nums dado-custo">{eur(a.valor)}</td>}
                <td className="px-3"><span className={`inline-block text-xs border rounded-sm px-1.5 py-0.5 ${ESTADO[a.estado].cls}`}>{ESTADO[a.estado].label}</span></td>
                <td className="px-3 text-right whitespace-nowrap">
                  {podeEditar && <>
                    <button type="button" className="p-1.5 text-gray-500 hover:text-gray-900" title="Acertar stock" onClick={() => setAj(a)} data-testid={`stock-ajuste-${a.id}`}><SlidersHorizontal size={15} /></button>
                    <button type="button" className="p-1.5 text-gray-500 hover:text-gray-900" title="Unidade de compra e nível" onClick={() => setCfg(a)} data-testid={`stock-cfg-${a.id}`}><Settings2 size={15} /></button>
                  </>}
                </td>
              </tr>
            ))}
            {!dados.items.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">Nenhum artigo com gestão de stock. Escolha um artigo acima para começar.</td></tr>}
          </tbody>
        </table>
      </div>
      {cfg && <ConfigDialog artigo={cfg} onClose={() => setCfg(null)} onSaved={() => { setCfg(null); carregar(); }} />}
      {aj && <AjusteDialog artigo={aj} onClose={() => setAj(null)} onSaved={() => { setAj(null); carregar(); }} />}
    </div>
  );
}

function TabMovimentos() {
  const [movs, setMovs] = useState([]);
  useEffect(() => { api.get("/stock/movimentos?limit=500").then(setMovs).catch(() => toast.error("Não foi possível carregar os movimentos")); }, []);
  const nav = useNavigate();
  return (
    <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500 bg-gray-50">
          <tr><th className="text-left px-3 py-2">Data</th><th className="text-left px-3">Artigo</th><th className="text-left px-3">Tipo</th><th className="text-right px-3">Quantidade</th><th className="text-right px-3">Saldo</th><th className="text-left px-3">Origem</th><th className="text-left px-3">Por</th></tr>
        </thead>
        <tbody>
          {movs.map((m) => (
            <tr key={m.id} className="border-t border-gray-100">
              <td className="px-3 py-2 whitespace-nowrap">{fmtDate(m.data)}</td>
              <td className="px-3">{m.artigo_nome}</td>
              <td className="px-3 text-gray-600">{TIPO_MOV[m.tipo] || m.tipo}</td>
              <td className={`px-3 text-right tabular-nums font-medium ${m.quantidade < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.quantidade > 0 ? "+" : ""}{num(m.quantidade)}</td>
              <td className="px-3 text-right tabular-nums">{num(m.saldo)}</td>
              <td className="px-3">
                {m.origem?.tipo === "oc" ? <button type="button" className="text-brand hover:underline" onClick={() => nav(`/ordens-compra/${m.origem.id}`)}>{m.origem.numero}</button>
                  : m.origem?.numero || m.nota || "—"}
              </td>
              <td className="px-3 text-gray-500">{m.por?.nome || "—"}</td>
            </tr>
          ))}
          {!movs.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Sem movimentos</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TabSugestoes({ podeCriar }) {
  const [sug, setSug] = useState(null);
  const [qtd, setQtd] = useState({});
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const carregar = () => api.get("/stock/sugestoes").then((r) => { setSug(r); setQtd(Object.fromEntries(r.map((s) => [s.artigo_id, s.qtd_sugerida]))); }).catch(() => toast.error("Não foi possível calcular as sugestões"));
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const grupos = useMemo(() => {
    const g = {};
    (sug || []).forEach((s) => { (g[s.fornecedor_nome] = g[s.fornecedor_nome] || []).push(s); });
    return Object.entries(g);
  }, [sug]);
  const criar = async () => {
    setBusy(true);
    try {
      const itens = (sug || []).map((s) => ({ ...s, quantidade: Number(qtd[s.artigo_id]) || 0 })).filter((s) => s.quantidade > 0);
      const r = await api.post("/stock/sugestoes/criar-oc", { itens });
      toast.success(`${r.criadas.length} ordem(ns) de compra criada(s): ${r.criadas.map((c) => c.codigo).join(", ")}`);
      if (r.criadas.length === 1) nav(`/ordens-compra/${r.criadas[0].id}`);
      else carregar();
    } catch (e) { erro(e, "Não foi possível criar as ordens de compra"); } finally { setBusy(false); }
  };
  if (!sug) return <div className="text-sm text-gray-400 py-8 text-center">A calcular…</div>;
  if (!sug.length) return <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-sm text-gray-500">Nada a comprar: todos os artigos com nível de reabastecimento estão acima do nível (contando o que já está em compra e o que as encomendas abertas vão gastar).</div>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Projetado = stock + em compra − reservado pelas encomendas abertas. Ajuste as quantidades (em unidade de compra) e crie uma OC por fornecedor.</p>
      {grupos.map(([forn, itens]) => (
        <div key={forn} className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
          <div className="px-3 py-2 border-b border-gray-100 font-semibold text-sm">{forn}</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50"><tr><th className="text-left px-3 py-1.5">Artigo</th><th className="text-right px-3">Stock</th><th className="text-right px-3">Em compra</th><th className="text-right px-3">Reservado</th><th className="text-right px-3">Projetado</th><th className="text-right px-3">Nível</th><th className="text-right px-3">Comprar</th></tr></thead>
            <tbody>
              {itens.map((s) => (
                <tr key={s.artigo_id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5"><div className="font-medium">{s.nome}</div><div className="text-xs text-gray-400">{s.codigo}{s.cod_fornecedor ? ` · ref. forn. ${s.cod_fornecedor}` : ""}</div></td>
                  <td className="px-3 text-right tabular-nums">{num(s.stock)}</td>
                  <td className="px-3 text-right tabular-nums">{num(s.em_compra)}</td>
                  <td className="px-3 text-right tabular-nums">{num(s.reservado)}</td>
                  <td className="px-3 text-right tabular-nums font-medium text-amber-700">{num(s.projetado)} <span className="text-xs text-gray-400">{s.unidade}</span></td>
                  <td className="px-3 text-right tabular-nums">{num(s.nivel)}</td>
                  <td className="px-3 text-right whitespace-nowrap">
                    <input type="number" min="0" step="any" className={`${inputCls} w-20 text-right inline-block`} value={qtd[s.artigo_id] ?? ""} onChange={(e) => setQtd({ ...qtd, [s.artigo_id]: e.target.value })} data-testid={`sug-qtd-${s.artigo_id}`} />
                    <span className="text-xs text-gray-500 ml-1">{s.unidade_compra}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {podeCriar && <div className="flex justify-end"><button type="button" className="btn btn-primario" disabled={busy} onClick={criar} data-testid="sug-criar-oc"><ShoppingCart size={15} /> Criar ordens de compra</button></div>}
    </div>
  );
}

function InventarioDetalhe({ id, podeEditar, verCustos, onVoltar }) {
  const [inv, setInv] = useState(null);
  const [cont, setCont] = useState({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const carregar = useCallback(() => api.get(`/inventarios/${id}`).then((r) => {
    setInv(r);
    setCont(Object.fromEntries(r.linhas.map((l) => [l.artigo_id, l.qtd_contada ?? ""])));
  }), [id]);
  useEffect(() => { carregar().catch(() => toast.error("Não foi possível abrir o inventário")); }, [carregar]);
  if (!inv) return null;
  const aberto = inv.estado === "aberto";
  const guardar = async () => {
    setBusy(true);
    try {
      await api.put(`/inventarios/${id}/contagens`, { contagens: inv.linhas.map((l) => ({ artigo_id: l.artigo_id, qtd_contada: cont[l.artigo_id] === "" ? null : Number(cont[l.artigo_id]) })) });
      toast.success("Contagens guardadas");
      await carregar();
    } catch (e) { erro(e, "Não foi possível guardar"); } finally { setBusy(false); }
  };
  const fechar = async () => {
    const ok = await confirm({ title: "Fechar inventário?", description: "O stock dos artigos contados passa a ser o valor contado (fica registado como acerto). Os não contados mantêm o stock atual. Não pode ser desfeito.", confirmLabel: "Fechar inventário" });
    if (!ok) return;
    setBusy(true);
    try {
      await guardar();
      const r = await api.post(`/inventarios/${id}/fechar`, {});
      toast.success(`Inventário fechado — ${r.acertos} acerto(s)`);
      await carregar();
    } catch (e) { erro(e, "Não foi possível fechar"); } finally { setBusy(false); }
  };
  const ql = q.trim().toLowerCase();
  const linhas = inv.linhas.filter((l) => !ql || `${l.codigo} ${l.nome}`.toLowerCase().includes(ql));
  const contados = inv.linhas.filter((l) => cont[l.artigo_id] !== "" && cont[l.artigo_id] !== null && cont[l.artigo_id] !== undefined).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secundario" onClick={onVoltar}>← Inventários</button>
        <div className="font-semibold">Inventário de {fmtDate(inv.data)}</div>
        {!aberto && <span className="inline-flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded-sm px-1.5 py-0.5"><Lock size={12} /> Fechado</span>}
        <span className="text-sm text-gray-500">{contados}/{inv.linhas.length} contados</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-secundario" onClick={() => openAuthenticated(`${API}/inventarios/${id}/at.csv`, { filename: `inventario-${inv.data}.csv` }).catch((e) => toast.error(e.message))} data-testid="inv-csv-at"><FileDown size={15} /> Ficheiro AT (CSV)</button>
          {aberto && podeEditar && <>
            <button type="button" className="btn btn-secundario" disabled={busy} onClick={guardar} data-testid="inv-guardar">Guardar contagens</button>
            <button type="button" className="btn btn-primario" disabled={busy} onClick={fechar} data-testid="inv-fechar"><ClipboardCheck size={15} /> Fechar inventário</button>
          </>}
        </div>
      </div>
      <input className={`${inputCls} max-w-xs`} placeholder="Procurar…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50"><tr><th className="text-left px-3 py-2">Artigo</th><th className="text-right px-3">Teórico</th><th className="text-right px-3">Contado</th><th className="text-right px-3">Diferença</th>{verCustos && <th className="text-right px-3 dado-custo">Custo</th>}{verCustos && !aberto && <th className="text-right px-3 dado-custo">Valor</th>}</tr></thead>
          <tbody>
            {linhas.map((l) => {
              const c = cont[l.artigo_id];
              const dif = c === "" || c === null || c === undefined ? null : Number(c) - l.qtd_teorica;
              return (
                <tr key={l.artigo_id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5"><div className="font-medium">{l.nome}</div><div className="text-xs text-gray-400">{l.codigo} · {l.unidade}</div></td>
                  <td className="px-3 text-right tabular-nums">{num(l.qtd_teorica)}</td>
                  <td className="px-3 text-right">
                    {aberto && podeEditar ? <input type="number" step="any" className={`${inputCls} w-24 text-right inline-block`} value={c ?? ""} onChange={(e) => setCont({ ...cont, [l.artigo_id]: e.target.value })} data-testid={`inv-cont-${l.artigo_id}`} />
                      : <span className="tabular-nums">{c === "" || c === null ? "—" : num(c)}</span>}
                  </td>
                  <td className={`px-3 text-right tabular-nums ${dif ? (dif < 0 ? "text-red-700" : "text-emerald-700") : "text-gray-400"}`}>{dif === null ? "—" : `${dif > 0 ? "+" : ""}${num(dif)}`}</td>
                  {verCustos && <td className="px-3 text-right tabular-nums dado-custo">{eur(l.custo)}</td>}
                  {verCustos && !aberto && <td className="px-3 text-right tabular-nums dado-custo">{eur(l.valor)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {verCustos && !aberto && <div className="text-right text-sm dado-custo">Valor total do inventário: <b>{eur(inv.valor_total)}</b></div>}
    </div>
  );
}

function TabInventarios({ podeEditar, verCustos }) {
  const [lista, setLista] = useState([]);
  const [aberto, setAberto] = useState(null);
  const [data, setData] = useState(`${new Date().getFullYear()}-12-31`);
  const confirm = useConfirm();
  const carregar = () => api.get("/inventarios").then(setLista).catch(() => toast.error("Não foi possível carregar os inventários"));
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (aberto) return <InventarioDetalhe id={aberto} podeEditar={podeEditar} verCustos={verCustos} onVoltar={() => { setAberto(null); carregar(); }} />;
  const novo = async () => {
    try {
      const r = await api.post("/inventarios", { data });
      setAberto(r.id);
    } catch (e) { erro(e, "Não foi possível criar o inventário"); }
  };
  const eliminar = async (i) => {
    if (!(await confirm({ title: "Eliminar inventário?", description: "As contagens feitas perdem-se.", confirmLabel: "Eliminar", tone: "danger" }))) return;
    try { await api.del(`/inventarios/${i.id}`); carregar(); } catch (e) { erro(e, "Não foi possível eliminar"); }
  };
  return (
    <div className="space-y-3">
      {podeEditar && (
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="text-xs font-medium text-gray-600">Data do inventário</label><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} /></div>
          <button type="button" className="btn btn-primario" onClick={novo} data-testid="inv-novo"><Plus size={15} /> Novo inventário</button>
          <p className="text-xs text-gray-500 basis-full">Tira uma fotografia do stock atual; depois conta-se e fecha-se. O ficheiro CSV segue o formato de comunicação de inventários à AT (até 31 de janeiro).</p>
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-sm">
        {lista.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0 border-gray-100 text-sm">
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => setAberto(i.id)}>Inventário de {fmtDate(i.data)}</button>
            <span className="text-gray-500">{i.estado === "aberto" ? `Aberto · ${i.n_contados}/${i.n_artigos} contados` : `Fechado · ${i.acertos || 0} acertos`}</span>
            {verCustos && i.estado === "fechado" && <span className="text-gray-600 dado-custo">{eur(i.valor_total)}</span>}
            {podeEditar && i.estado === "aberto" && <button type="button" className="ml-auto p-1.5 text-gray-400 hover:text-red-600" onClick={() => eliminar(i)}><Trash2 size={15} /></button>}
          </div>
        ))}
        {!lista.length && <div className="px-4 py-8 text-center text-sm text-gray-400">Ainda não há inventários</div>}
      </div>
    </div>
  );
}

export default function Stock() {
  const { can, user } = useAuth();
  const [tab, setTab] = useState("stock");
  const podeEditar = can("artigos", "edit");
  const verCustos = user?.perfil?.ver_custos !== false;
  return (
    <div>
      <PageHeader title="Stock" subtitle="Quantidades, movimentos, sugestões de compra e inventário anual." />
      <DetailTabs testid="stock-tabs" value={tab} onChange={setTab} tabs={[
        { id: "stock", label: "Stock", testid: "stock-tab-stock" },
        { id: "movimentos", label: "Movimentos", testid: "stock-tab-movimentos" },
        ...(can("ordens_compra", "view") ? [{ id: "sugestoes", label: "Sugestões de compra", testid: "stock-tab-sugestoes" }] : []),
        { id: "inventarios", label: "Inventários", testid: "stock-tab-inventarios" },
      ]} />
      {tab === "stock" && <TabStock podeEditar={podeEditar} verCustos={verCustos} />}
      {tab === "movimentos" && <TabMovimentos />}
      {tab === "sugestoes" && <TabSugestoes podeCriar={can("ordens_compra", "create")} />}
      {tab === "inventarios" && <TabInventarios podeEditar={podeEditar} verCustos={verCustos} />}
    </div>
  );
}
