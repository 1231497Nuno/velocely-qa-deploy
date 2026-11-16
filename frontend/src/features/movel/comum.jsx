import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Camera, Loader2, Search, X, MapPin, Check, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useLocalizacoes, limparCacheLocalizacoes } from "@/features/stock/StockLocais";
import { useAuth } from "@/context/AuthContext";

export const num = (v) => Number(v || 0).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
export const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);

/** Vibração curta (feedback ao ler um código / gravar). */
export function vibrar(ms = 60) {
  try { navigator.vibrate?.(ms); } catch { /* sem suporte */ }
}

/** Cabeçalho fixo dos ecrãs da app móvel. */
export function MovelHeader({ titulo, voltar = "/m", direita = null }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-30 bg-[#0A0A0A] text-white px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 flex items-center gap-2 shadow">
      {voltar ? (
        <button type="button" aria-label="Voltar" className="p-2 -ml-1 rounded-lg active:bg-white/10" onClick={() => nav(voltar)} data-testid="movel-voltar">
          <ArrowLeft className="w-6 h-6" />
        </button>
      ) : <img src="/favicon.png" alt="" className="w-8 h-8 rounded" />}
      <h1 className="text-lg font-semibold flex-1 truncate">{titulo}</h1>
      {direita}
    </header>
  );
}

export function Pagina({ children }) {
  return <div className="min-h-[100dvh] bg-gray-50 pb-[max(env(safe-area-inset-bottom),1rem)]">{children}</div>;
}

export function BotaoGrande({ children, className = "", variante = "primario", ...p }) {
  const cores = {
    primario: "bg-[#0A0A0A] text-white active:bg-black",
    secundario: "bg-white text-gray-900 border border-gray-300 active:bg-gray-100",
    perigo: "bg-red-600 text-white active:bg-red-700",
    sucesso: "bg-emerald-600 text-white active:bg-emerald-700",
  };
  return (
    <button type="button" className={`w-full min-h-[3.25rem] rounded-xl px-4 text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${cores[variante]} ${className}`} {...p}>
      {children}
    </button>
  );
}

/** Campo de quantidade grande com − / +. */
export function Quantidade({ value, onChange, unidade = "", autoFocus = false, passo = 1, testid = "movel-qtd" }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 50); }, [autoFocus]);
  const v = value === "" || value == null ? "" : value;
  const somar = (d) => onChange(String(Math.max(0, Math.round(((Number(v) || 0) + d) * 1000) / 1000)));
  return (
    <div className="flex items-stretch gap-2">
      <button type="button" className="w-14 rounded-xl bg-gray-200 text-2xl font-bold active:bg-gray-300" onClick={() => somar(-passo)} aria-label="Menos">−</button>
      <div className="flex-1 relative">
        <input ref={ref} type="number" inputMode="decimal" step="any" min="0" value={v} onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-full h-14 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none text-center text-2xl font-bold pr-10" data-testid={testid} />
        {unidade && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">{unidade}</span>}
      </div>
      <button type="button" className="w-14 rounded-xl bg-gray-200 text-2xl font-bold active:bg-gray-300" onClick={() => somar(passo)} aria-label="Mais">+</button>
    </div>
  );
}

const FORMATOS = ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "data_matrix"];

/** Câmara a ler QR / código de barras (BarcodeDetector — Chrome/Android). */
export function Scanner({ onLido, onFechar }) {
  const video = useRef(null);
  useEffect(() => {
    let stream; let vivo = true; let timer;
    (async () => {
      if (!("BarcodeDetector" in window)) { toast.error("Este browser não lê códigos pela câmara — pesquise pelo nome ou código"); onFechar(); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.current.srcObject = stream;
        await video.current.play();
        let formats = FORMATOS;
        try { const sup = await window.BarcodeDetector.getSupportedFormats(); formats = FORMATOS.filter((f) => sup.includes(f)); } catch { /* usa todos */ }
        const det = new window.BarcodeDetector({ formats });
        const ler = async () => {
          if (!vivo) return;
          try {
            const r = await det.detect(video.current);
            if (r[0]?.rawValue) { vibrar(); onLido(r[0].rawValue.trim()); return; }
          } catch { /* continua */ }
          timer = setTimeout(ler, 250);
        };
        ler();
      } catch { toast.error("Sem acesso à câmara"); onFechar(); }
    })();
    return () => { vivo = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex-1 relative flex items-center justify-center">
        <video ref={video} className="w-full h-full object-cover" playsInline muted />
        <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-40 border-4 border-white/80 rounded-2xl pointer-events-none" />
        <p className="absolute top-6 inset-x-0 text-center text-white text-sm">Aponte para o código de barras ou QR</p>
      </div>
      <button type="button" className="m-4 min-h-[3.25rem] rounded-xl bg-white text-lg font-semibold flex items-center justify-center gap-2" onClick={onFechar}>
        <X className="w-5 h-5" /> Fechar
      </button>
    </div>
  );
}

/** Procura um artigo com stock por código exato (código de barras, código interno) ou texto. */
export async function procurarArtigos(q) {
  const r = await api.get(`/stock?q=${encodeURIComponent(q)}`);
  const items = r?.items || [];
  const ql = q.trim().toLowerCase();
  const exato = items.filter((a) => [a.codigo_produto, a.codigo].some((c) => (c || "").toLowerCase() === ql));
  return { items, exato: exato.length === 1 ? exato[0] : null };
}

/** Escolher artigo: pesquisa por texto ou leitura do código de barras. */
export function ArtigoPicker({ onEscolher, autoFocus = true, placeholder = "Nome, código ou código de barras…" }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [camara, setCamara] = useState(false);
  const inp = useRef(null);
  const seq = useRef(0);

  useEffect(() => { if (autoFocus) inp.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(async () => {
      const id = ++seq.current;
      setBusy(true);
      try { const r = await procurarArtigos(q); if (id === seq.current) setRes(r.items.slice(0, 30)); }
      catch { if (id === seq.current) setRes([]); } finally { if (id === seq.current) setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const lerCodigo = async (codigo) => {
    setCamara(false);
    setBusy(true);
    try {
      const r = await procurarArtigos(codigo);
      if (r.exato || r.items.length === 1) { setQ(""); setRes(null); onEscolher(r.exato || r.items[0]); return; }
      setQ(codigo); setRes(r.items.slice(0, 30));
      if (!r.items.length) toast.error(`Nenhum artigo com stock tem o código «${codigo}»`);
    } catch (e) { erro(e, "Erro a procurar o artigo"); } finally { setBusy(false); }
  };

  const enter = (e) => {
    if (e.key !== "Enter" || !q.trim()) return;
    e.preventDefault();
    lerCodigo(q.trim()); // leitores de código de barras USB/Bluetooth terminam com Enter
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={enter} placeholder={placeholder} enterKeyHint="search"
            className="w-full h-14 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none pl-10 pr-9 text-base bg-white" data-testid="movel-pesquisa" />
          {busy && <Loader2 className="w-5 h-5 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>
        <button type="button" aria-label="Ler código" className="w-14 h-14 rounded-xl bg-[#0A0A0A] text-white flex items-center justify-center active:bg-black" onClick={() => setCamara(true)} data-testid="movel-camara">
          <Camera className="w-6 h-6" />
        </button>
      </div>
      {res && (
        <ul className="bg-white rounded-xl border divide-y overflow-hidden" data-testid="movel-resultados">
          {res.length === 0 && <li className="p-4 text-sm text-gray-500">Sem resultados (só aparecem artigos com gestão de stock).</li>}
          {res.map((a) => (
            <li key={a.id}>
              <button type="button" className="w-full text-left p-3 active:bg-gray-100 flex items-center gap-3" onClick={() => { setQ(""); setRes(null); onEscolher(a); }}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.nome}</div>
                  <div className="text-xs text-gray-500 truncate">{[a.codigo, a.codigo_produto].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right text-sm font-semibold whitespace-nowrap">{num(a.qtd_stock)} <span className="text-xs text-gray-500 font-normal">{a.unidade}</span></div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {camara && <Scanner onLido={lerCodigo} onFechar={() => setCamara(false)} />}
    </div>
  );
}

/** Cartão do artigo escolhido. */
export function ArtigoCartao({ artigo, onLimpar, children }) {
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-base leading-tight">{artigo.nome}</div>
          <div className="text-xs text-gray-500 mt-0.5">{[artigo.codigo, artigo.codigo_produto].filter(Boolean).join(" · ")}</div>
        </div>
        {onLimpar && <button type="button" aria-label="Trocar artigo" className="p-1.5 rounded-lg text-gray-500 active:bg-gray-100" onClick={onLimpar}><X className="w-5 h-5" /></button>}
      </div>
      {children}
    </div>
  );
}

const RECENTES = "velocely_movel_locs_recentes";
const lerRecentes = () => { try { return JSON.parse(localStorage.getItem(RECENTES) || "[]"); } catch { return []; } };
const guardarRecente = (id) => { try { localStorage.setItem(RECENTES, JSON.stringify([id, ...lerRecentes().filter((x) => x !== id)].slice(0, 6))); } catch { /* sem storage */ } };

/**
 * Escolha de localização: chips grandes (poucas), ou pesquisa + recentes (muitas); ler o QR da etiqueta;
 * criar uma localização nova no momento.
 */
export function LocalPicker({ value, onChange, titulo = "Localização", opcoes = null, quantidades = null, testid = "movel-local", permitirNova = true }) {
  const [locs, recarregar] = useLocalizacoes();
  const { can } = useAuth();
  const [camara, setCamara] = useState(false);
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [nova, setNova] = useState(null);
  const lista = (opcoes || locs).filter((l) => l.ativo !== false || l.id === value);
  const escolher = (id) => { guardarRecente(id); onChange(id); setAberto(false); setQ(""); };
  const ler = (c) => {
    setCamara(false);
    const cl = c.toLowerCase();
    const l = lista.find((x) => (x.codigo || "").toLowerCase() === cl || (x.nome || "").toLowerCase() === cl || (x.nome_curto || "").toLowerCase() === cl || x.id === c);
    if (l) { vibrar(); escolher(l.id); } else toast.error(`Localização «${c}» não encontrada`);
  };
  const criar = async () => {
    if (!nova?.nome?.trim()) { toast.error("Indique o nome"); return; }
    try {
      const l = await api.post("/stock/localizacoes", { nome: nova.nome.trim(), codigo: (nova.codigo || "").trim() });
      limparCacheLocalizacoes(); await recarregar();
      toast.success(`Localização «${l.nome}» criada`);
      setNova(null); escolher(l.id);
    } catch (e) { erro(e, "Não foi possível criar"); }
  };
  if (!lista.length && !permitirNova) return null;
  const sel = lista.find((l) => l.id === value);
  const muitas = lista.length > 6;
  const recentes = lerRecentes().map((id) => lista.find((l) => l.id === id)).filter(Boolean).filter((l) => l.id !== value).slice(0, 4);
  const ql = q.trim().toLowerCase();
  const filtradas = lista.filter((l) => !ql || `${l.nome} ${l.codigo || ""}`.toLowerCase().includes(ql));
  const chip = (l, compacto = false) => {
    const ativo = l.id === value;
    const qt = quantidades ? quantidades[l.id] : null;
    return (
      <button key={l.id} type="button" onClick={() => escolher(l.id)}
        className={`${compacto ? "min-h-[2.5rem]" : "min-h-[2.75rem]"} px-3 rounded-xl border-2 text-sm font-medium flex items-center gap-1.5 ${ativo ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-white border-gray-300 active:bg-gray-100"}`}>
        {ativo && <Check className="w-4 h-4" />}
        {l.nome}{l.codigo ? <span className={`text-[11px] ${ativo ? "text-white/60" : "text-gray-400"}`}>{l.codigo}</span> : null}
        {qt != null && <span className={`text-xs ${ativo ? "text-white/70" : "text-gray-500"}`}>({num(qt)})</span>}
      </button>
    );
  };
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{titulo}</span>
        <div className="flex items-center gap-1">
          {permitirNova && !opcoes && can("artigos", "edit") && (
            <button type="button" className="text-xs text-gray-600 flex items-center gap-1 px-2 py-1 rounded active:bg-gray-200" onClick={() => setNova({ nome: "", codigo: "" })}><Plus className="w-3.5 h-3.5" /> Nova</button>
          )}
          <button type="button" className="text-xs text-gray-600 flex items-center gap-1 px-2 py-1 rounded active:bg-gray-200" onClick={() => setCamara(true)}><Camera className="w-3.5 h-3.5" /> Ler etiqueta</button>
        </div>
      </div>
      {!muitas ? (
        <div className="flex flex-wrap gap-2">{lista.map((l) => chip(l))}</div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => setAberto((v) => !v)} className={`w-full min-h-[3rem] px-3 rounded-xl border-2 text-left flex items-center gap-2 ${sel ? "border-[#0A0A0A] bg-white" : "border-gray-300 bg-white"}`}>
            <MapPin className="w-5 h-5 text-gray-500" />
            <span className="flex-1 font-semibold truncate">{sel ? sel.nome : "Escolher localização…"}</span>
            {sel?.codigo && <span className="text-xs text-gray-500">{sel.codigo}</span>}
            {sel && quantidades && <span className="text-xs text-gray-500">({num(quantidades[sel.id] || 0)})</span>}
          </button>
          {!aberto && recentes.length > 0 && <div className="flex flex-wrap gap-2">{recentes.map((l) => chip(l, true))}</div>}
          {aberto && (
            <div className="bg-white rounded-xl border-2 border-gray-200 p-2 space-y-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar localização…" className="w-full h-11 rounded-lg border border-gray-300 px-3" />
              <ul className="max-h-64 overflow-auto divide-y">
                {filtradas.map((l) => (
                  <li key={l.id}><button type="button" onClick={() => escolher(l.id)} className={`w-full text-left px-3 py-2.5 flex items-center gap-2 ${l.id === value ? "bg-gray-100" : "active:bg-gray-100"}`}>
                    <span className="flex-1">{l.nome}</span>
                    {l.codigo && <span className="text-xs text-gray-500">{l.codigo}</span>}
                    {quantidades && <span className="text-xs text-gray-500">{num(quantidades[l.id] || 0)}</span>}
                  </button></li>
                ))}
                {!filtradas.length && <li className="px-3 py-3 text-sm text-gray-500">Nenhuma localização.</li>}
              </ul>
            </div>
          )}
        </div>
      )}
      {nova && (
        <div className="mt-2 bg-white rounded-xl border-2 border-gray-200 p-3 space-y-2">
          <div className="text-sm font-semibold">Nova localização</div>
          <input autoFocus value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nome (ex.: Prateleira A2)" className="w-full h-11 rounded-lg border border-gray-300 px-3" />
          <input value={nova.codigo} onChange={(e) => setNova({ ...nova, codigo: e.target.value })} placeholder="Código da etiqueta (ex.: A2)" className="w-full h-11 rounded-lg border border-gray-300 px-3" />
          <div className="grid grid-cols-2 gap-2">
            <BotaoGrande variante="secundario" onClick={() => setNova(null)}>Cancelar</BotaoGrande>
            <BotaoGrande onClick={criar}>Criar</BotaoGrande>
          </div>
        </div>
      )}
      {camara && <Scanner onLido={ler} onFechar={() => setCamara(false)} />}
    </div>
  );
}

/** Lembra a última localização usada (por ecrã) neste telemóvel. */
export function useLocalLembrado(chave) {
  const k = `velocely_movel_loc_${chave}`;
  const [v, setV] = useState(() => { try { return localStorage.getItem(k) || ""; } catch { return ""; } });
  const set = (x) => { setV(x); try { localStorage.setItem(k, x || ""); } catch { /* sem storage */ } };
  return [v, set];
}
