import { enviarOuGuardar } from "@/lib/filaOffline";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ChevronRight, Loader2, MapPin, Search, SlidersHorizontal, AlertTriangle } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLocalizacoes } from "@/features/stock/StockLocais";
import { MovelHeader, Pagina, BotaoGrande, Quantidade, ArtigoPicker, ArtigoCartao, LocalPicker, useLocalLembrado, num, erro, vibrar } from "./comum";

/** Lista de localizações com nº de artigos; abre o stock de cada uma. */
export function MovelLocalizacoes() {
  const nav = useNavigate();
  const [locs, recarregar] = useLocalizacoes();
  const [q, setQ] = useState("");
  useEffect(() => { recarregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ql = q.trim().toLowerCase();
  const lista = locs.filter((l) => l.ativo !== false && (!ql || `${l.nome} ${l.codigo || ""}`.toLowerCase().includes(ql)));
  return (
    <Pagina>
      <MovelHeader titulo="Localizações" />
      <div className="p-4 space-y-3">
        <LocalPicker value="" onChange={(id) => nav(`/m/localizacoes/${id}`)} titulo="Ler a etiqueta ou criar" />
        <div className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar localização…" className="w-full h-12 rounded-xl border-2 border-gray-300 pl-10 pr-3 bg-white" />
        </div>
        <ul className="space-y-2">
          {lista.map((l, i) => (
            <li key={l.id}>
              {l.armazem_nome && l.armazem_id !== lista[i - 1]?.armazem_id && new Set(lista.map((x) => x.armazem_id)).size > 1 && (
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-3 mb-1.5">{l.armazem_nome}</div>
              )}
              <Link to={`/m/localizacoes/${l.id}`} className="bg-white rounded-xl border p-3 flex items-center gap-3 active:bg-gray-100">
                <span className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0"><MapPin className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{l.nome_curto || l.nome}{l.padrao ? " ★" : ""}</div>
                  <div className="text-xs text-gray-500">{l.codigo ? `${l.codigo} · ` : ""}{l.n_artigos || 0} artigos</div>
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

/** O que está numa localização, com atalhos para transferir, acertar e contar. */
export function MovelLocalizacao() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [locs] = useLocalizacoes();
  const [itens, setItens] = useState(null);
  const [q, setQ] = useState("");
  const [, setLocInv] = useLocalLembrado("inventario");
  const l = locs.find((x) => x.id === id);
  useEffect(() => {
    setItens(null);
    api.get(`/stock?localizacao=${encodeURIComponent(id)}`).then((r) => setItens(r.items || [])).catch((e) => { erro(e, "Erro a carregar"); setItens([]); });
  }, [id]);
  const ql = q.trim().toLowerCase();
  const lista = (itens || []).filter((a) => !ql || `${a.nome} ${a.codigo} ${a.codigo_produto}`.toLowerCase().includes(ql));
  const ir = (rota, a) => nav(rota, { state: { artigo: { id: a.id, nome: a.nome, codigo: a.codigo, codigo_produto: a.codigo_produto, unidade: a.unidade }, loc: id } });
  return (
    <Pagina>
      <MovelHeader titulo={l?.nome || "Localização"} voltar="/m/localizacoes" />
      <div className="p-4 space-y-3">
        <div className="text-sm text-gray-600">{l?.codigo ? `Código ${l.codigo} · ` : ""}{itens ? `${itens.length} artigos` : ""}</div>
        {can("artigos", "edit") && (
          <BotaoGrande variante="secundario" onClick={() => { setLocInv(id); nav("/m/inventario"); }}>Contar esta localização</BotaoGrande>
        )}
        {(itens || []).length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar artigos…" className="w-full h-12 rounded-xl border-2 border-gray-300 px-3 bg-white" />}
        {itens === null && <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
        {itens && !itens.length && <p className="text-center text-gray-500 py-8">Esta localização está vazia.</p>}
        <ul className="space-y-2">
          {lista.map((a) => (
            <li key={a.id} className="bg-white rounded-xl border p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight">{a.nome}</div>
                  <div className="text-xs text-gray-500">{[a.codigo, a.codigo_produto].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right"><b className={a.qtd_local < 0 ? "text-red-600" : ""}>{num(a.qtd_local)}</b> <span className="text-xs text-gray-500">{a.unidade}</span>
                  {a.por_local?.length > 1 && <div className="text-[11px] text-gray-400">total {num(a.qtd_stock)}</div>}</div>
              </div>
              {can("artigos", "edit") && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <button type="button" className="min-h-[2.5rem] rounded-lg bg-gray-100 text-sm font-medium flex items-center justify-center gap-1 active:bg-gray-200" onClick={() => ir("/m/transferir", a)}><ArrowLeftRight className="w-4 h-4" /> Mover</button>
                  <button type="button" className="min-h-[2.5rem] rounded-lg bg-gray-100 text-sm font-medium flex items-center justify-center gap-1 active:bg-gray-200" onClick={() => ir("/m/movimento", a)}><ArrowUpFromLine className="w-4 h-4" /> Saída</button>
                  <button type="button" className="min-h-[2.5rem] rounded-lg bg-gray-100 text-sm font-medium flex items-center justify-center gap-1 active:bg-gray-200" onClick={() => ir("/m/acertar", a)}><SlidersHorizontal className="w-4 h-4" /> Acertar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Pagina>
  );
}

const MOTIVOS = {
  saida: ["Consumo interno", "Amostra", "Oferta", "Partido / estragado", "Devolução ao fornecedor"],
  entrada: ["Devolução de cliente", "Sobra de produção", "Encontrado", "Oferta de fornecedor"],
};

/** Entrada ou saída avulsa (sem documento): consumo, amostras, quebras, devoluções… */
export function MovelMovimento() {
  const { state } = useLocation();
  const [tipo, setTipo] = useState(state?.tipo || "saida");
  const [artigo, setArtigo] = useState(state?.artigo || null);
  const [loc, setLoc] = useState(state?.loc || "");
  const [porLocal, setPorLocal] = useState({});
  const [qtd, setQtd] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPorLocal({});
    if (!artigo) return;
    api.get(`/stock/artigos/${artigo.id}`).then((s) => {
      setPorLocal(Object.fromEntries((s.localizacoes || []).map((x) => [x.localizacao_id, x.quantidade])));
      setArtigo((a) => ({ ...a, unidade: s.unidade }));
      if (!state?.loc) setLoc(s.localizacoes?.[0]?.localizacao_id || s.localizacao_padrao_id || "");
    }).catch(() => {});
  }, [artigo?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const gravar = async () => {
    if (!(Number(qtd) > 0)) { toast.error("Indique a quantidade"); return; }
    if (!motivo.trim()) { toast.error("Indique o motivo"); return; }
    setBusy(true);
    try {
      const r = await enviarOuGuardar("/movel/movimento", { artigo_id: artigo.id, localizacao_id: loc || null, tipo, quantidade: Number(qtd), motivo: motivo.trim() },
        `${tipo === "saida" ? "Saída" : "Entrada"} ${num(qtd)} · ${artigo.nome}`);
      vibrar(40);
      if (r?.offline) toast.info("Sem rede: ficou guardado no telemóvel e é enviado quando a rede voltar");
      else toast.success(`${tipo === "saida" ? "Saída" : "Entrada"} de ${num(qtd)} ${artigo.unidade || ""} · ${artigo.nome}`);
      setArtigo(null); setQtd(""); setMotivo("");
    } catch (e) { erro(e, "Não foi possível registar"); } finally { setBusy(false); }
  };
  return (
    <Pagina>
      <MovelHeader titulo="Entrada / saída" />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[["saida", "Saída", ArrowUpFromLine], ["entrada", "Entrada", ArrowDownToLine]].map(([k, l, I]) => (
            <button key={k} type="button" onClick={() => { setTipo(k); setMotivo(""); }} className={`min-h-[3.25rem] rounded-xl border-2 font-semibold flex items-center justify-center gap-2 ${tipo === k ? (k === "saida" ? "bg-red-600 border-red-600 text-white" : "bg-emerald-600 border-emerald-600 text-white") : "bg-white border-gray-300"}`}>
              <I className="w-5 h-5" /> {l}
            </button>
          ))}
        </div>
        {!artigo ? <ArtigoPicker onEscolher={setArtigo} /> : (
          <ArtigoCartao artigo={artigo} onLimpar={() => setArtigo(null)}>
            <div className="mt-3 space-y-4">
              <LocalPicker value={loc} onChange={setLoc} titulo={tipo === "saida" ? "Sai de" : "Entra em"} quantidades={porLocal} />
              <Quantidade value={qtd} onChange={setQtd} unidade={artigo.unidade} />
              <div className="flex flex-wrap gap-2">
                {MOTIVOS[tipo].map((m) => (
                  <button key={m} type="button" onClick={() => setMotivo(m)} className={`px-3 py-2 rounded-xl border text-sm ${motivo === m ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-white border-gray-300"}`}>{m}</button>
                ))}
              </div>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className="w-full h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none px-3 bg-white" />
              <BotaoGrande variante={tipo === "saida" ? "perigo" : "sucesso"} onClick={gravar} disabled={busy} data-testid="movel-gravar-movimento">
                {busy && <Loader2 className="animate-spin w-5 h-5" />} Registar {tipo === "saida" ? "saída" : "entrada"}
              </BotaoGrande>
            </div>
          </ArtigoCartao>
        )}
      </div>
    </Pagina>
  );
}

/** Artigos abaixo do nível de reabastecimento. */
export function MovelStockBaixo() {
  const [itens, setItens] = useState(null);
  const nav = useNavigate();
  useEffect(() => { api.get("/stock?filtro=abaixo").then((r) => setItens(r.items || [])).catch(() => setItens([])); }, []);
  return (
    <Pagina>
      <MovelHeader titulo="Stock baixo" />
      <div className="p-4 space-y-2">
        {itens === null && <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
        {itens && !itens.length && <p className="text-center text-gray-500 py-8">Nenhum artigo abaixo do nível de reabastecimento.</p>}
        {(itens || []).map((a) => (
          <button key={a.id} type="button" onClick={() => nav("/m/consultar", { state: { artigo: a } })} className="w-full text-left bg-white rounded-xl border p-3 flex items-center gap-3 active:bg-gray-100">
            <AlertTriangle className={`w-5 h-5 shrink-0 ${a.estado === "negativo" ? "text-red-600" : "text-amber-500"}`} />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{a.nome}</div>
              <div className="text-xs text-gray-500 truncate">{a.fornecedor_nome || "Sem fornecedor"}</div>
            </div>
            <div className="text-right text-sm"><b>{num(a.qtd_stock)}</b> <span className="text-gray-500">/ {num(a.nivel_reabastecimento)}</span></div>
          </button>
        ))}
        {itens && itens.length > 0 && <p className="text-xs text-gray-500 pt-2">As encomendas ao fornecedor criam-se no computador em Stock → Sugestões de compra.</p>}
      </div>
    </Pagina>
  );
}

const TIPO = { entrada: "Entrada", saida: "Saída", ajuste: "Acerto", consumo: "Consumo", transferencia: "Transferência", inventario: "Inventário" };

/** Últimos movimentos de stock (quem fez o quê). */
export function MovelMovimentos() {
  const [movs, setMovs] = useState(null);
  const [locs] = useLocalizacoes();
  const nomeLoc = useMemo(() => Object.fromEntries(locs.map((l) => [l.id, l.nome])), [locs]);
  useEffect(() => { api.get("/stock/movimentos?limit=80").then(setMovs).catch(() => setMovs([])); }, []);
  return (
    <Pagina>
      <MovelHeader titulo="Últimos movimentos" />
      <div className="p-4">
        {movs === null && <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
        <ul className="bg-white rounded-xl border divide-y">
          {(movs || []).map((m) => (
            <li key={m.id} className="px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.artigo_nome}</div>
                <div className="text-xs text-gray-500 truncate">{TIPO[m.tipo] || m.tipo} · {fmtDate(m.data || m.created_at)}{m.localizacao_id && nomeLoc[m.localizacao_id] ? ` · ${nomeLoc[m.localizacao_id]}` : ""}{(typeof m.por === "string" ? m.por : m.por?.nome) ? ` · ${typeof m.por === "string" ? m.por : m.por.nome}` : ""}{m.nota ? ` · ${m.nota}` : ""}</div>
              </div>
              <b className={`whitespace-nowrap ${m.quantidade < 0 ? "text-red-600" : "text-emerald-700"}`}>{m.quantidade > 0 ? "+" : ""}{num(m.quantidade)}</b>
            </li>
          ))}
          {movs && !movs.length && <li className="p-4 text-sm text-gray-500">Sem movimentos.</li>}
        </ul>
      </div>
    </Pagina>
  );
}
