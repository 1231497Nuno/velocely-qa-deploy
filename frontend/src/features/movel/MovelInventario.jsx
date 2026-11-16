import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ClipboardList, CheckCircle2, ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { useLocalizacoes } from "@/features/stock/StockLocais";
import { MovelHeader, Pagina, BotaoGrande, Quantidade, ArtigoPicker, ArtigoCartao, LocalPicker, useLocalLembrado, num, erro, vibrar } from "./comum";

/** Contagem de inventário: localização → artigo (pesquisa ou código de barras) → quantidade. */
export default function MovelInventario() {
  const confirm = useConfirm();
  const [locs] = useLocalizacoes();
  const [inv, setInv] = useState(undefined);
  const [linhas, setLinhas] = useState([]);
  const [loc, setLoc] = useLocalLembrado("inventario");
  const [artigo, setArtigo] = useState(null);
  const [qtd, setQtd] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentes, setRecentes] = useState([]);
  const [verFalta, setVerFalta] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get("/movel/inventario-aberto");
      setInv(r);
      if (r) setLinhas((await api.get(`/inventarios/${r.id}`)).linhas || []);
    } catch (e) { erro(e, "Erro a carregar o inventário"); setInv(null); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!loc && locs.length) setLoc((locs.find((l) => l.padrao) || locs[0]).id);
  }, [locs]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhaAtual = useMemo(() => (artigo ? linhas.find((l) => l.chave === `${artigo.id}|${loc}`) : null), [artigo, linhas, loc]);
  const anterior = linhaAtual?.qtd_contada;
  const porContar = useMemo(() => linhas.filter((l) => l.localizacao_id === loc && l.qtd_contada == null), [linhas, loc]);
  const contados = linhas.filter((l) => l.qtd_contada != null).length;

  const abrir = async () => {
    if (!(await confirm({ title: "Abrir um inventário?", description: "Fica uma folha de contagem com todos os artigos com stock, por localização. Só um inventário pode estar aberto de cada vez.", confirmLabel: "Abrir" }))) return;
    setBusy(true);
    try { await api.post("/inventarios", {}); toast.success("Inventário aberto"); await carregar(); }
    catch (e) { erro(e, "Não foi possível abrir o inventário"); } finally { setBusy(false); }
  };

  const gravar = async (somar) => {
    if (qtd === "" || Number.isNaN(Number(qtd))) { toast.error("Indique a quantidade contada"); return; }
    setBusy(true);
    try {
      const r = await api.post(`/movel/inventario/${inv.id}/contar`, { artigo_id: artigo.id, localizacao_id: loc, qtd_contada: Number(qtd), somar });
      setLinhas((ls) => {
        const i = ls.findIndex((l) => l.chave === r.linha.chave);
        if (i < 0) return [...ls, r.linha];
        const n = [...ls]; n[i] = r.linha; return n;
      });
      vibrar(40);
      toast.success(`${artigo.nome}: ${num(r.linha.qtd_contada)} ${artigo.unidade || ""}`);
      setRecentes((rs) => [{ chave: r.linha.chave, nome: artigo.nome, qtd: r.linha.qtd_contada, un: artigo.unidade, local: r.linha.localizacao }, ...rs.filter((x) => x.chave !== r.linha.chave)].slice(0, 15));
      setArtigo(null); setQtd("");
    } catch (e) { erro(e, "Não foi possível gravar a contagem"); } finally { setBusy(false); }
  };

  const escolherLinha = (l) => {
    setArtigo({ id: l.artigo_id, nome: l.nome, codigo: l.codigo, codigo_produto: l.codigo_barras, unidade: l.unidade });
    setQtd(""); setVerFalta(false);
  };

  if (inv === undefined) return <Pagina><MovelHeader titulo="Inventário" /><div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div></Pagina>;
  if (!inv) {
    return (
      <Pagina>
        <MovelHeader titulo="Inventário" />
        <div className="p-6 text-center space-y-4">
          <ClipboardList className="w-14 h-14 mx-auto text-gray-300" />
          <p className="text-gray-600">Não há nenhum inventário aberto.</p>
          <BotaoGrande onClick={abrir} disabled={busy} data-testid="movel-abrir-inventario">{busy ? <Loader2 className="animate-spin" /> : null} Abrir inventário</BotaoGrande>
          <p className="text-xs text-gray-500">O fecho (e os acertos de stock) faz-se no computador, em Stock → Inventários.</p>
        </div>
      </Pagina>
    );
  }

  const pct = linhas.length ? Math.round((contados / linhas.length) * 100) : 0;
  return (
    <Pagina>
      <MovelHeader titulo={`Inventário ${inv.data?.split("-").reverse().join("/") || ""}`} />
      <div className="bg-white border-b px-4 py-2">
        <div className="flex justify-between text-xs text-gray-600 mb-1"><span>{contados} de {linhas.length} contados</span><span>{pct}%</span></div>
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden"><div className="h-full bg-sky-600 transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="p-4 space-y-4">
        <LocalPicker value={loc} onChange={(v) => { setLoc(v); setVerFalta(false); }} titulo="Estou a contar em" />

        {!artigo ? (
          <>
            <ArtigoPicker onEscolher={(a) => { setArtigo(a); setQtd(""); }} />
            <button type="button" className="w-full text-sm flex items-center justify-center gap-2 py-2 text-gray-700" onClick={() => setVerFalta((v) => !v)} data-testid="movel-por-contar">
              <ListChecks className="w-4 h-4" /> {verFalta ? "Esconder" : "Ver"} por contar aqui ({porContar.length})
            </button>
            {verFalta && (
              <ul className="bg-white rounded-xl border divide-y max-h-[50vh] overflow-auto">
                {porContar.length === 0 && <li className="p-4 text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Tudo contado nesta localização.</li>}
                {porContar.map((l) => (
                  <li key={l.chave}><button type="button" className="w-full text-left p-3 active:bg-gray-100" onClick={() => escolherLinha(l)}>
                    <div className="font-medium">{l.nome}</div><div className="text-xs text-gray-500">{l.codigo}</div>
                  </button></li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <ArtigoCartao artigo={artigo} onLimpar={() => { setArtigo(null); setQtd(""); }}>
            <div className="mt-3 space-y-3">
              {anterior != null && (
                <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Já contado aqui: <b>{num(anterior)} {artigo.unidade}</b>. Pode substituir ou somar.</p>
              )}
              {!linhaAtual && <p className="text-xs text-gray-500">Este artigo não estava previsto nesta localização — a contagem acrescenta-o.</p>}
              <Quantidade value={qtd} onChange={setQtd} unidade={artigo.unidade} autoFocus />
              <div className={`grid gap-2 ${anterior != null ? "grid-cols-2" : "grid-cols-1"}`}>
                {anterior != null && <BotaoGrande variante="secundario" onClick={() => gravar(true)} disabled={busy}>Somar</BotaoGrande>}
                <BotaoGrande variante="sucesso" onClick={() => gravar(false)} disabled={busy} data-testid="movel-gravar-contagem">{busy && <Loader2 className="animate-spin w-5 h-5" />} {anterior != null ? "Substituir" : "Gravar"}</BotaoGrande>
              </div>
            </div>
          </ArtigoCartao>
        )}

        {recentes.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Contado agora</h2>
            <ul className="bg-white rounded-xl border divide-y text-sm">
              {recentes.map((r) => (
                <li key={r.chave} className="px-3 py-2 flex justify-between gap-2">
                  <span className="truncate">{r.nome} <span className="text-xs text-gray-500">· {r.local || locs.find((l) => r.chave.endsWith(l.id))?.nome}</span></span>
                  <b className="whitespace-nowrap">{num(r.qtd)} {r.un}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Pagina>
  );
}
