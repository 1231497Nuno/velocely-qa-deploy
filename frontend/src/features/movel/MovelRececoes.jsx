import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, PackageCheck, ChevronRight, Camera, RefreshCw, Search, Truck } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { useLocalizacoes } from "@/features/stock/StockLocais";
import { MovelHeader, Pagina, BotaoGrande, LocalPicker, Scanner, procurarArtigos, useLocalLembrado, num, erro, vibrar } from "./comum";

const chaveForn = (o) => o.fornecedor_id || `nome:${o.fornecedor || ""}`;

/** Receções: primeiro o fornecedor (com o que há por receber), depois as linhas de todas as OC dele. */
export function MovelRececoes() {
  const [ocs, setOcs] = useState(null);
  const [q, setQ] = useState("");
  const carregar = useCallback(() => { setOcs(null); api.get("/movel/ocs-abertas").then(setOcs).catch((e) => { erro(e, "Erro a carregar"); setOcs([]); }); }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const grupos = useMemo(() => {
    const m = new Map();
    (ocs || []).forEach((o) => {
      const k = chaveForn(o);
      const g = m.get(k) || { chave: k, nome: o.fornecedor || "Sem fornecedor", ocs: [], linhas: 0, artigos: new Set(), ultima: "" };
      g.ocs.push(o);
      o.linhas.filter((l) => l.falta > 0).forEach((l) => { g.linhas += 1; g.artigos.add(l.nome); });
      if ((o.data || "") > g.ultima) g.ultima = o.data || "";
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [ocs]);
  const ql = q.trim().toLowerCase();
  const lista = grupos.filter((g) => !ql || `${g.nome} ${g.ocs.map((o) => `${o.codigo} ${o.assunto}`).join(" ")} ${[...g.artigos].join(" ")}`.toLowerCase().includes(ql));

  return (
    <Pagina>
      <MovelHeader titulo="Receções" direita={<button type="button" aria-label="Atualizar" className="p-2 rounded-lg active:bg-white/10" onClick={carregar}><RefreshCw className="w-5 h-5" /></button>} />
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar fornecedor, OC ou artigo…" data-testid="movel-rec-pesquisa"
            className="w-full h-14 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none pl-10 pr-3 bg-white" />
        </div>
        {ocs === null && <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
        {ocs && lista.length === 0 && (
          <div className="text-center text-gray-500 py-10"><PackageCheck className="w-12 h-12 mx-auto text-gray-300 mb-2" />{ql ? "Nenhum fornecedor com receções por fazer corresponde à pesquisa." : "Não há nada por receber."}</div>
        )}
        <ul className="space-y-2">
          {lista.map((g) => (
            <li key={g.chave}>
              <Link to={`/m/rececoes/f/${encodeURIComponent(g.chave)}`} className="bg-white rounded-xl border p-3 flex items-center gap-3 active:bg-gray-100" data-testid="movel-fornecedor">
                <span className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><Truck className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{g.nome}</div>
                  <div className="text-xs text-gray-500 truncate">{g.ocs.length} {g.ocs.length === 1 ? "encomenda" : "encomendas"} · {g.linhas} {g.linhas === 1 ? "linha" : "linhas"} por receber{g.ultima ? ` · desde ${fmtDate(g.ultima)}` : ""}</div>
                  <div className="text-xs text-gray-400 truncate">{[...g.artigos].slice(0, 3).join(", ")}{g.artigos.size > 3 ? "…" : ""}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Pagina>
  );
}

/**
 * Receber de um fornecedor (todas as OC em aberto) ou de uma OC: quantidades por linha, «Chegou tudo»,
 * «Ler volumes» (cada leitura soma 1 à linha do artigo, em qualquer OC do fornecedor), arrumar numa localização.
 */
export function MovelRececao() {
  const { id, fid } = useParams();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [locs] = useLocalizacoes();
  const [ocs, setOcs] = useState(null);
  const [qtd, setQtd] = useState({}); // chave `${oc}|${linha}`
  const [loc, setLoc] = useLocalLembrado("rececao");
  const [guia, setGuia] = useState("");
  const [camara, setCamara] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/movel/ocs-abertas").then((r) => {
      const sel = id ? r.filter((x) => x.id === id) : r.filter((x) => chaveForn(x) === decodeURIComponent(fid || ""));
      if (!sel.length) { toast.error("Já não há nada por receber aqui"); nav("/m/rececoes", { replace: true }); return; }
      setOcs(sel);
    }).catch((e) => erro(e, "Erro a carregar"));
  }, [id, fid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loc && locs.length) setLoc((locs.find((l) => l.padrao) || locs[0]).id);
  }, [locs]); // eslint-disable-line react-hooks/exhaustive-deps

  const todas = useMemo(() => (ocs || []).flatMap((o) => o.linhas.filter((l) => l.falta > 0).map((l) => ({ ...l, oc: o, k: `${o.id}|${l.id}` }))), [ocs]);
  const ql = q.trim().toLowerCase();
  const total = todas.reduce((s, l) => s + (Number(qtd[l.k]) || 0), 0);
  const set = (k, v) => setQtd((x) => ({ ...x, [k]: v }));
  const tudo = (lista) => setQtd((x) => ({ ...x, ...Object.fromEntries(lista.map((l) => [l.k, String(l.falta)])) }));

  const lerCodigo = async (codigo) => {
    setCamara(false);
    try {
      const r = await procurarArtigos(codigo);
      const a = r.exato || (r.items.length === 1 ? r.items[0] : null);
      const cand = a ? todas.filter((x) => x.artigo_id === a.id) : [];
      // primeiro a linha que ainda não está completa (OC mais antiga primeiro)
      const l = cand.find((x) => (Number(qtd[x.k]) || 0) < x.falta) || cand[0];
      if (!l) { toast.error(a ? `«${a.nome}» não está nas encomendas deste fornecedor` : `Código «${codigo}» não reconhecido`); return; }
      const novo = (Number(qtd[l.k]) || 0) + 1;
      set(l.k, String(novo));
      vibrar();
      toast.success(`${l.nome}: ${num(novo)} de ${num(l.falta)} (${l.oc.codigo})`);
      setTimeout(() => setCamara(true), 600);
    } catch (e) { erro(e, "Erro a procurar o artigo"); }
  };

  const enviar = async () => {
    const porOc = new Map();
    todas.forEach((l) => { if (Number(qtd[l.k]) > 0) porOc.set(l.oc.id, [...(porOc.get(l.oc.id) || []), l]); });
    if (!porOc.size) { toast.error("Indique o que chegou"); return; }
    const excesso = todas.filter((l) => Number(qtd[l.k]) > l.falta + 1e-9);
    if (excesso.length && !(await confirm({ title: "Chegou mais do que o encomendado?", description: excesso.map((l) => `${l.nome}: ${num(qtd[l.k])} (faltavam ${num(l.falta)})`).join("\n"), confirmLabel: "Sim, receber a mais" }))) return;
    setBusy(true);
    try {
      const r = await api.post("/ordens-compra/rececoes-lote", {
        localizacao_id: loc || null, guia_fornecedor: guia, aceitar_excesso: excesso.length > 0,
        ocs: [...porOc].map(([ocId, ls]) => ({ oc_id: ocId, linhas: ls.map((l) => ({ linha_id: l.id, quantidade: Number(qtd[l.k]) })) })),
      });
      toast.success(`Receção registada: ${r.rececoes.map((x) => `${x.codigo}${x.estado === "recebida" ? " (completa)" : ""}`).join(", ")}`);
      nav("/m/rececoes", { replace: true });
    } catch (e) {
      erro(e, "Não foi possível registar a receção");
    } finally { setBusy(false); }
  };

  if (!ocs) return <Pagina><MovelHeader titulo="Receção" voltar="/m/rececoes" /><div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div></Pagina>;
  const nome = ocs[0].fornecedor || "Sem fornecedor";
  return (
    <Pagina>
      <MovelHeader titulo={id ? ocs[0].codigo : nome} voltar="/m/rececoes" />
      <div className="p-4 space-y-4 pb-32">
        <div>
          <div className="font-semibold text-lg leading-tight">{nome}</div>
          <div className="text-xs text-gray-500">{ocs.length} {ocs.length === 1 ? "encomenda" : "encomendas"} · {todas.length} linhas por receber</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <BotaoGrande variante="secundario" onClick={() => tudo(todas)} data-testid="movel-receber-tudo">Chegou tudo</BotaoGrande>
          <BotaoGrande variante="secundario" onClick={() => setCamara(true)}><Camera className="w-5 h-5" /> Ler volumes</BotaoGrande>
        </div>
        {todas.length > 6 && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar artigos…" className="w-full h-12 rounded-xl border-2 border-gray-300 px-3 bg-white" />
        )}
        {ocs.map((o) => {
          const ls = todas.filter((l) => l.oc.id === o.id && (!ql || l.nome.toLowerCase().includes(ql)));
          if (!ls.length) return null;
          return (
            <div key={o.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{o.codigo} · {fmtDate(o.data)}{o.assunto ? ` · ${o.assunto}` : ""}</div>
                {ocs.length > 1 && <button type="button" className="text-xs font-semibold px-2 py-1 rounded bg-gray-200 active:bg-gray-300" onClick={() => tudo(ls)}>Tudo desta</button>}
              </div>
              <ul className="space-y-2">
                {ls.map((l) => {
                  const v = qtd[l.k] ?? "";
                  const ok = v !== "" && Number(v) >= l.falta - 1e-9;
                  return (
                    <li key={l.k} className={`bg-white rounded-xl border-2 p-3 ${ok ? "border-emerald-500" : Number(v) > 0 ? "border-amber-400" : "border-gray-200"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium leading-tight">{l.nome}</div>
                        <div className="text-xs text-gray-500 whitespace-nowrap">falta {num(l.falta)}{l.recebida > 0 ? ` de ${num(l.quantidade)}` : ""}</div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button type="button" className="w-12 rounded-xl bg-gray-200 text-xl font-bold active:bg-gray-300" onClick={() => set(l.k, String(Math.max(0, (Number(v) || 0) - 1)))}>−</button>
                        <input type="number" inputMode="decimal" min="0" step="any" value={v} onChange={(e) => set(l.k, e.target.value)} onFocus={(e) => e.target.select()} placeholder="0"
                          className="flex-1 min-w-0 h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none text-center text-xl font-bold" data-testid="movel-rec-qtd" />
                        <button type="button" className="w-12 rounded-xl bg-gray-200 text-xl font-bold active:bg-gray-300" onClick={() => set(l.k, String((Number(v) || 0) + 1))}>+</button>
                        <button type="button" className="px-3 rounded-xl bg-gray-900 text-white font-semibold active:bg-black" onClick={() => set(l.k, String(l.falta))}>Tudo</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <LocalPicker value={loc} onChange={setLoc} titulo="Arrumar em" />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Guia do fornecedor (opcional)</span>
          <input value={guia} onChange={(e) => setGuia(e.target.value)} className="mt-1 w-full h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none px-3 bg-white" placeholder="N.º da guia de remessa" />
        </label>
      </div>
      <div className="fixed bottom-0 inset-x-0 bg-white border-t p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <BotaoGrande variante="sucesso" onClick={enviar} disabled={busy || total <= 0} data-testid="movel-confirmar-rececao">
          {busy && <Loader2 className="animate-spin w-5 h-5" />} Confirmar receção{total > 0 ? ` (${num(total)})` : ""}
        </BotaoGrande>
      </div>
      {camara && <Scanner onLido={lerCodigo} onFechar={() => setCamara(false)} />}
    </Pagina>
  );
}
