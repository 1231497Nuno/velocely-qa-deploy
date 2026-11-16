import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, eur } from "@/lib/api";
import EntitySelect from "@/components/EntitySelect";
import FornecedorSelect from "@/components/FornecedorSelect";
import { useFornecedores } from "@/lib/useFornecedores";

const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);
const cel = "border border-gray-300 rounded-sm px-2 py-1 text-sm text-right tabular-nums w-20 bg-white";

/**
 * Criar ordem de compra a partir do PDF do fornecedor: lê, associa os artigos (referência do fornecedor,
 * código ou nome), mostra avisos (preço diferente, outro fornecedor) e cria a OC depois de revista.
 */
export default function ImportarPdfOC({ open, onOpenChange }) {
  const nav = useNavigate();
  const fornecedores = useFornecedores();
  const [artigos, setArtigos] = useState([]);
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState("");
  const inp = useRef(null);

  useEffect(() => {
    if (!open) { setR(null); return; }
    api.get("/artigos?lite=true").then((x) => setArtigos(Array.isArray(x) ? x : x.items || [])).catch(() => {});
  }, [open]);

  const ler = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy("ler");
    try {
      const fd = new FormData();
      fd.append("file", f);
      setR(await api.post("/ordens-compra/importar-pdf", fd));
    } catch (err) { erro(err, "Não foi possível ler o PDF"); } finally { setBusy(""); }
  };
  const setLinha = (id, patch) => setR((x) => ({ ...x, linhas: x.linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const incluidas = (r?.linhas || []).filter((l) => l.incluir);
  const total = incluidas.reduce((s, l) => s + (Number(l.quantidade) || 0) * (Number(l.preco_unit) || 0) * (1 - (Number(l.desconto) || 0) / 100), 0);
  const semArtigo = incluidas.filter((l) => !l.artigo_id).length;

  const criar = async () => {
    setBusy("criar");
    try {
      const oc = await api.post("/ordens-compra/importar-pdf/criar", { ...r, aprender: true });
      toast.success(`Ordem de compra ${oc.codigo} criada`);
      onOpenChange(false);
      nav(`/ordens-compra/${oc.id}`);
    } catch (err) { erro(err, "Não foi possível criar a ordem de compra"); } finally { setBusy(""); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display">Criar ordem de compra a partir do PDF</DialogTitle>
          <DialogDescription>Carregue a proforma, nota de encomenda ou fatura do fornecedor. Os artigos são reconhecidos pela referência do fornecedor; o que associar agora fica aprendido.</DialogDescription>
        </DialogHeader>
        <input ref={inp} type="file" accept="application/pdf,.pdf" className="hidden" onChange={ler} data-testid="oc-pdf-input" />
        {!r ? (
          <button type="button" onClick={() => inp.current?.click()} disabled={busy === "ler"} data-testid="oc-pdf-escolher"
            className="w-full border-2 border-dashed border-gray-300 rounded-sm py-12 flex flex-col items-center gap-2 text-gray-600 hover:bg-gray-50">
            {busy === "ler" ? <Loader2 className="animate-spin" /> : <FileUp size={28} />}
            <span className="font-medium">{busy === "ler" ? "A ler o PDF…" : "Escolher o PDF do fornecedor"}</span>
          </button>
        ) : (
          <div className="space-y-3 max-h-[65vh] overflow-y-auto" data-testid="oc-pdf-revisao">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm ${r.resumo.associadas === r.resumo.linhas ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                {r.resumo.associadas === r.resumo.linhas ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {r.resumo.associadas} de {r.resumo.linhas} artigos reconhecidos
              </span>
              {r.resumo.com_avisos > 0 && <span className="px-2 py-1 rounded-sm bg-amber-50 text-amber-800">{r.resumo.com_avisos} com avisos</span>}
              {r.metodo === "ia" && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-violet-50 text-violet-800"><Sparkles size={14} /> Lido com IA</span>}
              <button type="button" className="ml-auto text-sm underline" onClick={() => inp.current?.click()}>Outro PDF</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Fornecedor {r.fornecedor_id ? "" : <span className="text-amber-700">(não reconhecido{r.fornecedor_nome ? `: ${r.fornecedor_nome}` : ""})</span>}</div>
                <FornecedorSelect fornecedores={fornecedores} value={r.fornecedor_id} onChange={(id) => setR({ ...r, fornecedor_id: id })} testid="oc-pdf-fornecedor" />
              </div>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">N.º do documento do fornecedor</span>
                <input value={r.numero_documento || ""} onChange={(e) => setR({ ...r, numero_documento: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm" />
              </label>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-2 pr-2 w-8" />
                  <th className="py-2 pr-2">No PDF</th>
                  <th className="py-2 pr-2 min-w-[14rem]">Artigo</th>
                  <th className="py-2 pr-2 text-right">Qtd</th>
                  <th className="py-2 pr-2 text-right">Preço</th>
                  <th className="py-2 pr-2 text-right">Desc. %</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {r.linhas.map((l) => {
                  const t = (Number(l.quantidade) || 0) * (Number(l.preco_unit) || 0) * (1 - (Number(l.desconto) || 0) / 100);
                  return (
                    <tr key={l.id} className={`border-b align-top ${l.incluir ? "" : "opacity-40"}`}>
                      <td className="py-2 pr-2"><input type="checkbox" checked={l.incluir} onChange={(e) => setLinha(l.id, { incluir: e.target.checked })} aria-label="Incluir" /></td>
                      <td className="py-2 pr-2">
                        <div className="font-mono text-xs">{l.ref || "—"}</div>
                        <div className="text-xs text-gray-500 max-w-[14rem]">{l.descricao}</div>
                      </td>
                      <td className="py-2 pr-2">
                        <EntitySelect items={artigos} value={l.artigo_id} size="sm" placeholder="Associar artigo…"
                          onChange={(id, a) => setLinha(l.id, { artigo_id: id, artigo_nome: a?.nome || "", associacao: "manual", avisos: [] })} />
                        {l.associacao === "nome" && <div className="text-[11px] text-amber-700 mt-0.5">Associado pelo nome — confirme</div>}
                        {(l.avisos || []).map((a) => <div key={a} className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1"><AlertTriangle size={11} /> {a}</div>)}
                      </td>
                      <td className="py-2 pr-2 text-right"><input type="number" step="any" value={l.quantidade} onChange={(e) => setLinha(l.id, { quantidade: e.target.value })} className={cel} /></td>
                      <td className="py-2 pr-2 text-right"><input type="number" step="any" value={l.preco_unit} onChange={(e) => setLinha(l.id, { preco_unit: e.target.value })} className={cel} /></td>
                      <td className="py-2 pr-2 text-right"><input type="number" step="any" value={l.desconto} onChange={(e) => setLinha(l.id, { desconto: e.target.value })} className={`${cel} w-16`} /></td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">{eur(t)}</td>
                    </tr>
                  );
                })}
                {!r.linhas.length && <tr><td colSpan={7} className="py-6 text-center text-gray-500">Não encontrei linhas de artigos neste PDF.</td></tr>}
              </tbody>
            </table>
            <div className="text-right text-sm">Total sem IVA: <b className="tabular-nums">{eur(total)}</b></div>
          </div>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={() => onOpenChange(false)}>Cancelar</button>
          {r && (
            <button type="button" className="btn btn-primario" disabled={busy === "criar" || !incluidas.length || semArtigo > 0 || !r.fornecedor_id} onClick={criar} data-testid="oc-pdf-criar">
              {busy === "criar" && <Loader2 size={15} className="animate-spin" />}
              {semArtigo > 0 ? `Associe ${semArtigo} artigo(s)` : "Criar ordem de compra"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
