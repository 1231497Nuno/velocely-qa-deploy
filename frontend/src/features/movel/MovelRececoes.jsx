import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, PackageCheck, ChevronRight, Camera, RefreshCw } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { useLocalizacoes } from "@/features/stock/StockLocais";
import { MovelHeader, Pagina, BotaoGrande, LocalPicker, Scanner, procurarArtigos, useLocalLembrado, num, erro, vibrar } from "./comum";

/** Lista de ordens de compra por receber. */
export function MovelRececoes() {
  const [ocs, setOcs] = useState(null);
  const [q, setQ] = useState("");
  const carregar = useCallback(() => { setOcs(null); api.get("/movel/ocs-abertas").then(setOcs).catch((e) => { erro(e, "Erro a carregar"); setOcs([]); }); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const ql = q.trim().toLowerCase();
  const lista = (ocs || []).filter((o) => !ql || `${o.codigo} ${o.fornecedor} ${o.assunto} ${o.linhas.map((l) => l.nome).join(" ")}`.toLowerCase().includes(ql));
  return (
    <Pagina>
      <MovelHeader titulo="Receções" direita={<button type="button" aria-label="Atualizar" className="p-2 rounded-lg active:bg-white/10" onClick={carregar}><RefreshCw className="w-5 h-5" /></button>} />
      <div className="p-4 space-y-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fornecedor, OC ou artigo…" className="w-full h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none px-3 bg-white" />
        {ocs === null && <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
        {ocs && lista.length === 0 && (
          <div className="text-center text-gray-500 py-10"><PackageCheck className="w-12 h-12 mx-auto text-gray-300 mb-2" />Não há encomendas a fornecedores por receber.</div>
        )}
        <ul className="space-y-2">
          {lista.map((o) => {
            const falta = o.linhas.filter((l) => l.falta > 0).length;
            return (
              <li key={o.id}>
                <Link to={`/m/rececoes/${o.id}`} className="bg-white rounded-xl border p-3 flex items-center gap-3 active:bg-gray-100" data-testid="movel-oc">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{o.fornecedor || "Sem fornecedor"}</div>
                    <div className="text-xs text-gray-500 truncate">{o.codigo} · {fmtDate(o.data)}{o.assunto ? ` · ${o.assunto}` : ""}</div>
                    <div className="text-xs text-gray-700 mt-1">{falta} {falta === 1 ? "linha" : "linhas"} por receber</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Pagina>
  );
}

/** Receber uma OC: quantidades por linha (ou ler o código de barras de cada volume), arrumar numa localização. */
export function MovelRececao() {
  const { id } = useParams();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [locs] = useLocalizacoes();
  const [oc, setOc] = useState(null);
  const [qtd, setQtd] = useState({});
  const [loc, setLoc] = useLocalLembrado("rececao");
  const [guia, setGuia] = useState("");
  const [camara, setCamara] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/movel/ocs-abertas").then((r) => {
      const o = r.find((x) => x.id === id);
      if (!o) { toast.error("Esta ordem de compra já não tem nada por receber"); nav("/m/rececoes", { replace: true }); return; }
      setOc(o);
    }).catch((e) => erro(e, "Erro a carregar"));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loc && locs.length) setLoc((locs.find((l) => l.padrao) || locs[0]).id);
  }, [locs]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhas = useMemo(() => (oc?.linhas || []).filter((l) => l.falta > 0), [oc]);
  const total = linhas.reduce((s, l) => s + (Number(qtd[l.id]) || 0), 0);
  const set = (lid, v) => setQtd((q) => ({ ...q, [lid]: v }));

  const lerCodigo = async (codigo) => {
    setCamara(false);
    try {
      const r = await procurarArtigos(codigo);
      const a = r.exato || (r.items.length === 1 ? r.items[0] : null);
      const l = a && linhas.find((x) => x.artigo_id === a.id);
      if (!l) { toast.error(a ? `«${a.nome}» não está nesta ordem de compra` : `Código «${codigo}» não reconhecido`); return; }
      const novo = (Number(qtd[l.id]) || 0) + 1;
      set(l.id, String(novo));
      vibrar();
      toast.success(`${l.nome}: ${num(novo)}`);
      setTimeout(() => setCamara(true), 600); // continua a ler o próximo volume
    } catch (e) { erro(e, "Erro a procurar o artigo"); }
  };

  const enviar = async (aceitar = false) => {
    const itens = linhas.filter((l) => Number(qtd[l.id]) > 0).map((l) => ({ linha_id: l.id, quantidade: Number(qtd[l.id]) }));
    if (!itens.length) { toast.error("Indique o que chegou"); return; }
    const excesso = linhas.filter((l) => Number(qtd[l.id]) > l.falta + 1e-9);
    if (excesso.length && !aceitar) {
      if (!(await confirm({ title: "Chegou mais do que o encomendado?", description: excesso.map((l) => `${l.nome}: ${num(qtd[l.id])} (faltavam ${num(l.falta)})`).join("\n"), confirmLabel: "Sim, receber a mais" }))) return;
      aceitar = true;
    }
    setBusy(true);
    try {
      const r = await api.post(`/ordens-compra/${id}/rececoes`, { linhas: itens, localizacao_id: loc || null, guia_fornecedor: guia, aceitar_excesso: aceitar });
      toast.success(r.estado === "recebida" ? `${oc.codigo} recebida na totalidade` : `Receção registada em ${oc.codigo}`);
      nav("/m/rececoes", { replace: true });
    } catch (e) { erro(e, "Não foi possível registar a receção"); } finally { setBusy(false); }
  };

  if (!oc) return <Pagina><MovelHeader titulo="Receção" voltar="/m/rececoes" /><div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div></Pagina>;
  return (
    <Pagina>
      <MovelHeader titulo={oc.codigo} voltar="/m/rececoes" />
      <div className="p-4 space-y-4 pb-32">
        <div>
          <div className="font-semibold text-lg leading-tight">{oc.fornecedor || "Sem fornecedor"}</div>
          <div className="text-xs text-gray-500">{fmtDate(oc.data)}{oc.assunto ? ` · ${oc.assunto}` : ""}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <BotaoGrande variante="secundario" onClick={() => setQtd(Object.fromEntries(linhas.map((l) => [l.id, String(l.falta)])))} data-testid="movel-receber-tudo">Chegou tudo</BotaoGrande>
          <BotaoGrande variante="secundario" onClick={() => setCamara(true)}><Camera className="w-5 h-5" /> Ler volumes</BotaoGrande>
        </div>
        <ul className="space-y-2">
          {linhas.map((l) => {
            const v = qtd[l.id] ?? "";
            const ok = Number(v) >= l.falta - 1e-9 && v !== "";
            return (
              <li key={l.id} className={`bg-white rounded-xl border-2 p-3 ${ok ? "border-emerald-500" : Number(v) > 0 ? "border-amber-400" : "border-gray-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium leading-tight">{l.nome}</div>
                  <div className="text-xs text-gray-500 whitespace-nowrap">falta {num(l.falta)}{l.recebida > 0 ? ` de ${num(l.quantidade)}` : ""}</div>
                </div>
                <div className="flex gap-2 mt-2">
                  <input type="number" inputMode="decimal" min="0" step="any" value={v} onChange={(e) => set(l.id, e.target.value)} onFocus={(e) => e.target.select()} placeholder="0"
                    className="flex-1 h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none text-center text-xl font-bold" data-testid="movel-rec-qtd" />
                  <button type="button" className="px-4 rounded-xl bg-gray-200 font-semibold active:bg-gray-300" onClick={() => set(l.id, String(l.falta))}>Tudo</button>
                  <button type="button" className="px-4 rounded-xl bg-gray-100 text-gray-600 active:bg-gray-200" onClick={() => set(l.id, "")}>0</button>
                </div>
              </li>
            );
          })}
        </ul>
        <LocalPicker value={loc} onChange={setLoc} titulo="Arrumar em" />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Guia do fornecedor (opcional)</span>
          <input value={guia} onChange={(e) => setGuia(e.target.value)} className="mt-1 w-full h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none px-3 bg-white" placeholder="N.º da guia de remessa" />
        </label>
      </div>
      <div className="fixed bottom-0 inset-x-0 bg-white border-t p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <BotaoGrande variante="sucesso" onClick={() => enviar(false)} disabled={busy || total <= 0} data-testid="movel-confirmar-rececao">
          {busy && <Loader2 className="animate-spin w-5 h-5" />} Confirmar receção{total > 0 ? ` (${num(total)})` : ""}
        </BotaoGrande>
      </div>
      {camara && <Scanner onLido={lerCodigo} onFechar={() => setCamara(false)} />}
    </Pagina>
  );
}
