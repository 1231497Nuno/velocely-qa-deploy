import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileUp, Loader2, RefreshCw } from "lucide-react";
import { API, api, eur, getToken } from "@/lib/api";
import { PageHeader } from "@/components/Layout";

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";

/** Catálogo → Atualizar custos: lê a tabela do fornecedor (Excel/CSV), compara pela referência e atualiza os custos. */
export default function PrecosFornecedor() {
  const [forns, setForns] = useState([]);
  const [fid, setFid] = useState("");
  const [lido, setLido] = useState(null);
  const [cols, setCols] = useState({ ref: "", preco: "" });
  const [ajuste, setAjuste] = useState(0);
  const [pv, setPv] = useState(null);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState("");
  useEffect(() => { api.get("/fornecedores").then((r) => setForns(Array.isArray(r) ? r : r.items || [])).catch(() => {}); }, []);

  const ler = async (file) => {
    if (!file) return;
    setBusy("ler"); setPv(null);
    try {
      const fd = new FormData();
      fd.append("ficheiro", file);
      const res = await fetch(`${API}/precos-fornecedor/ler`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${getToken()}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Não foi possível ler o ficheiro");
      setLido(j);
      setCols({ ref: j.col_ref ?? "", preco: j.col_preco ?? "" });
    } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };
  const corpo = () => ({ token: lido.token, fornecedor_id: fid, col_ref: Number(cols.ref), col_preco: Number(cols.preco), ajuste_pct: Number(ajuste) || 0 });
  const comparar = async () => {
    setBusy("pv");
    try {
      const r = await api.post("/precos-fornecedor/previsao", corpo());
      setPv(r);
      setSel(Object.fromEntries(r.alteracoes.map((x) => [x.artigo_id, true])));
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível comparar"); } finally { setBusy(""); }
  };
  const aplicar = async () => {
    setBusy("ap");
    try {
      const r = await api.post("/precos-fornecedor/aplicar", { ...corpo(), artigo_ids: Object.keys(sel).filter((k) => sel[k]) });
      toast.success(`${r.atualizados} artigo(s) com custo atualizado — o preço de venda acompanha a margem`);
      setPv(null); setLido(null);
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível aplicar"); } finally { setBusy(""); }
  };
  const nSel = Object.values(sel).filter(Boolean).length;

  return (
    <div>
      <PageHeader title="Atualizar custos de fornecedor" subtitle="Carregue a tabela de preços do fornecedor (Excel ou CSV). Os artigos são encontrados pela referência do fornecedor (campo «Cód. fornecedor») e o custo é atualizado; o preço de venda acompanha pela margem." />
      <div className="bg-white border border-gray-200 rounded-sm p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">Fornecedor
            <select className={`${inputCls} block min-w-[14rem]`} value={fid} onChange={(e) => setFid(e.target.value)} data-testid="pf-fornecedor">
              <option value="">Escolher…</option>
              {forns.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select></label>
          <label className="btn btn-secundario cursor-pointer">
            {busy === "ler" ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Carregar tabela
            <input type="file" accept=".xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => ler(e.target.files?.[0])} data-testid="pf-ficheiro" />
          </label>
          {lido && <span className="text-sm text-gray-500">{lido.linhas} linhas lidas</span>}
        </div>
        {lido && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600">Coluna da referência
              <select className={`${inputCls} block`} value={cols.ref} onChange={(e) => setCols({ ...cols, ref: e.target.value })}>
                <option value="">—</option>{lido.colunas.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select></label>
            <label className="text-xs text-gray-600">Coluna do custo (ex.: escalão «-500» da Makito)
              <select className={`${inputCls} block`} value={cols.preco} onChange={(e) => setCols({ ...cols, preco: e.target.value })}>
                <option value="">—</option>{lido.colunas.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select></label>
            <label className="text-xs text-gray-600">Ajuste (%)<input type="number" step="any" className={`${inputCls} block w-24`} value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></label>
            <button type="button" className="btn btn-primario" disabled={!fid || cols.ref === "" || cols.preco === "" || !!busy} onClick={comparar} data-testid="pf-comparar"><RefreshCw size={15} /> Comparar</button>
          </div>
        )}
      </div>
      {pv && (
        <div className="mt-4 space-y-2">
          <div className="text-sm text-gray-600">{pv.alteracoes.length} artigo(s) com custo diferente · {pv.iguais} iguais · {pv.precos_no_ficheiro} preços no ficheiro{pv.artigos_sem_ref ? ` · ${pv.artigos_sem_ref} artigos deste fornecedor sem referência` : ""}</div>
          {pv.alteracoes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50"><tr>
                  <th className="px-3 py-2"><input type="checkbox" checked={nSel === pv.alteracoes.length} onChange={(e) => setSel(Object.fromEntries(pv.alteracoes.map((x) => [x.artigo_id, e.target.checked])))} /></th>
                  <th className="text-left px-3">Artigo</th><th className="text-left px-3">Ref.</th><th className="text-right px-3">Custo atual</th><th className="text-right px-3">Novo</th><th className="text-right px-3">Variação</th></tr></thead>
                <tbody>
                  {pv.alteracoes.map((x) => (
                    <tr key={x.artigo_id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={!!sel[x.artigo_id]} onChange={(e) => setSel({ ...sel, [x.artigo_id]: e.target.checked })} /></td>
                      <td className="px-3"><div className="font-medium">{x.nome}</div><div className="text-xs text-gray-400">{x.codigo}</div></td>
                      <td className="px-3 text-gray-600">{x.ref}</td>
                      <td className="px-3 text-right tabular-nums">{eur(x.custo_atual)}</td>
                      <td className="px-3 text-right tabular-nums font-medium">{eur(x.custo_novo)}</td>
                      <td className={`px-3 text-right tabular-nums ${x.variacao_pct > 0 ? "text-red-700" : "text-emerald-700"}`}>{x.variacao_pct == null ? "—" : `${x.variacao_pct > 0 ? "+" : ""}${x.variacao_pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nSel > 0 && <div className="flex justify-end"><button type="button" className="btn btn-primario" disabled={!!busy} onClick={aplicar} data-testid="pf-aplicar">Atualizar {nSel} artigo(s)</button></div>}
        </div>
      )}
    </div>
  );
}
