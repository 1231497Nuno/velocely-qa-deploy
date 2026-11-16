import { useEffect, useRef, useState } from "react";
import ZonaArrastar, { comoEvento } from "@/components/ZonaArrastar";
import { toast } from "sonner";
import { aPreparar } from "@/lib/ofItens";
import { CheckCircle2, Loader2, Pause, Play, Paperclip, FileText, StickyNote, Image as ImageIcon, Camera, Trash2, X, AlertTriangle, CalendarClock, Package } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { fileApiUrl, useAuthFileUrl } from "@/lib/authFileUrl";
import { openAuthenticated } from "@/lib/openAuthenticated";

export const fmtSeg = (s) => {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}h ` : ""}${String(m).padStart(h ? 2 : 1, "0")}m`;
};
const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);
const qtdFmt = (v) => Number(v || 0).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
const quando = (iso) => { try { return new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const abrirFicheiro = (f) => openAuthenticated(fileApiUrl(f.path), { filename: f.nome }).catch((e) => toast.error(e.message || "Não foi possível abrir"));

function Miniatura({ path, className = "", alt = "" }) {
  const src = useAuthFileUrl(path);
  if (!src) return <div className={`bg-gray-100 flex items-center justify-center ${className}`}><ImageIcon className="text-gray-300" /></div>;
  return <img src={src} alt={alt} className={`object-cover ${className}`} />;
}

function VerImagem({ f, onFechar }) {
  const src = useAuthFileUrl(f.path);
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onFechar} role="presentation">
      <div className="flex items-center gap-3 p-3 text-white">
        <span className="flex-1 truncate">{f.nome}</span>
        <button type="button" className="px-4 py-2 rounded-lg bg-white/10" onClick={(e) => { e.stopPropagation(); abrirFicheiro(f); }}>Abrir original</button>
        <button type="button" aria-label="Fechar" className="p-2 rounded-lg bg-white/10" onClick={onFechar}><X /></button>
      </div>
      <div className="flex-1 flex items-center justify-center p-2">{src ? <img src={src} alt={f.nome} className="max-w-full max-h-full object-contain" /> : <Loader2 className="animate-spin text-white" />}</div>
    </div>
  );
}

const NOTAS_RAPIDAS = ["Falta material", "Máquina com problema", "Dúvida na arte", "Peças com defeito", "Pronto para embalar"];

/** Ficha da OF no ecrã da oficina: o que fazer (artigos, personalização, materiais, operações), documentos e notas. */
export default function OficinaOF({ of, setOf, onOutra }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [tab, setTab] = useState("trabalho");
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState("");
  const [ver, setVer] = useState(null);
  const [nota, setNota] = useState({ texto: "", ref: "" });
  const [, tick] = useState(0);
  const foto = useRef(null);
  const notaRef = useRef(null);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const carregarDocs = () => api.get(`/oficina/of/${of.id}/documentos`).then((r) => setDocs(r.grupos || [])).catch(() => setDocs([]));
  useEffect(() => { setDocs(null); carregarDocs(); }, [of.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const preparar = async (it, preparado) => {
    setBusy(it.id);
    try { setOf({ ...of, ...(await api.post(`/ordens-fabrico/${of.id}/itens/${it.id}/preparado`, { preparado })) }); }
    catch (e) { erro(e, "Não foi possível marcar"); } finally { setBusy(""); }
  };
  const acao = async (it, op, tipo) => {
    setBusy(op.id);
    try {
      const body = { item_id: it.id, operacao_id: op.id };
      const r = tipo === "concluir" ? await api.post(`/ordens-fabrico/${of.id}/toggle-operacao`, { ...body, concluida: true })
        : await api.post(`/ordens-fabrico/${of.id}/operacao/${tipo}`, body);
      setOf({ ...of, ...r });
      if (tipo === "concluir") toast.success(`«${op.nome}» concluída`);
    } catch (e) { erro(e, "Não foi possível"); } finally { setBusy(""); }
  };
  const seg = (op) => (op.tempo_real_seg || 0) + (op.timer_inicio ? (Date.now() - new Date(op.timer_inicio).getTime()) / 1000 : 0);

  const notaPara = (it, op) => {
    setNota({ texto: "", ref: `${it.id}|${op?.id || ""}` });
    setTab("notas");
    setTimeout(() => notaRef.current?.focus(), 80);
  };
  const gravarNota = async () => {
    if (!nota.texto.trim()) { toast.error("Escreva a nota"); return; }
    const [item_id, operacao_id] = (nota.ref || "|").split("|");
    setBusy("nota");
    try {
      const r = await api.post(`/oficina/of/${of.id}/notas`, { texto: nota.texto, item_id: item_id || null, operacao_id: operacao_id || null });
      setOf({ ...of, notas_oficina: r });
      setNota({ texto: "", ref: "" });
      toast.success("Nota registada");
    } catch (e) { erro(e, "Não foi possível gravar a nota"); } finally { setBusy(""); }
  };
  const apagarNota = async (n) => {
    if (!(await confirm({ title: "Apagar a nota?", description: n.texto, confirmLabel: "Apagar", tone: "danger" }))) return;
    try { setOf({ ...of, notas_oficina: await api.del(`/oficina/of/${of.id}/notas/${n.id}`) }); } catch (e) { erro(e, "Não foi possível apagar"); }
  };
  const enviarFoto = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy("foto");
    try {
      for (const file of files) { const fd = new FormData(); fd.append("file", file); await api.post(`/ficheiros/ordem_fabrico/${of.id}`, fd); }
      toast.success(files.length > 1 ? `${files.length} fotos anexadas` : "Foto anexada à OF");
      carregarDocs();
    } catch (err) { erro(err, "Não foi possível anexar"); } finally { setBusy(""); }
  };

  const notas = [...(of.notas_oficina || [])].reverse();
  const nDocs = (docs || []).reduce((s, g) => s + g.itens.length, 0);
  const tabs = [["trabalho", "O que fazer", Package], ["documentos", `Documentos${docs ? ` (${nDocs})` : ""}`, Paperclip], ["notas", `Notas${notas.length ? ` (${notas.length})` : ""}`, StickyNote]];
  const instrucoes = [of.descricao, of.notas].map((x) => (x || "").trim()).filter(Boolean);
  const atrasada = of.prazo_entrega && of.prazo_entrega.slice(0, 10) < new Date().toISOString().slice(0, 10);

  return (
    <ZonaArrastar onFicheiros={(f) => enviarFoto(comoEvento(f))} multiple accept="image/*" disabled={busy === "foto"} texto="Largue as fotos aqui para as anexar à OF">
    <div className="space-y-4" data-testid="oficina-of">
      {ver && <VerImagem f={ver} onFechar={() => setVer(null)} />}
      <input ref={foto} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={enviarFoto} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="text-3xl font-bold flex items-center gap-2">{of.numero}{of.prioritaria && <span className="text-sm px-2 py-1 rounded-lg bg-amber-100 text-amber-800 font-semibold">Prioritária</span>}</div>
          <div className="text-lg text-gray-600">{of.cliente}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-gray-600">
            {of.prazo_entrega && <span className={`flex items-center gap-1 ${atrasada ? "text-red-600 font-semibold" : ""}`}><CalendarClock className="w-4 h-4" /> Prazo {fmtDate(of.prazo_entrega)}</span>}
            {of.encomenda_numero && <span>Encomenda {of.encomenda_numero}</span>}
            {of.progresso != null && <span>{Math.round(of.progresso)}% feito</span>}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className="px-4 py-3 rounded-xl border-2 border-gray-300 bg-white text-lg flex items-center gap-2" onClick={() => foto.current?.click()} disabled={busy === "foto"}>
            {busy === "foto" ? <Loader2 className="animate-spin" /> : <Camera />} Foto
          </button>
          <button type="button" className="px-4 py-3 rounded-xl border-2 border-gray-300 bg-white text-lg" onClick={onOutra}>Outra OF</button>
        </div>
      </div>

      {instrucoes.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-lg whitespace-pre-line" data-testid="oficina-instrucoes">
          <div className="text-sm font-semibold uppercase tracking-wide text-amber-800 mb-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Instruções</div>
          {instrucoes.join("\n\n")}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => setTab(k)} data-testid={`oficina-tab-${k}`}
            className={`px-5 py-3 rounded-xl text-lg font-semibold flex items-center gap-2 whitespace-nowrap ${tab === k ? "bg-gray-900 text-white" : "bg-white border-2 border-gray-200"}`}>
            <I className="w-5 h-5" /> {l}
          </button>
        ))}
      </div>

      {tab === "trabalho" && of.itens.map((it) => {
        const notasItem = (of.notas_oficina || []).filter((n) => n.item_id === it.id);
        return (
          <div key={it.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex gap-4">
              {it.imagem && <button type="button" onClick={() => setVer({ path: it.imagem, nome: it.artigo_nome })}><Miniatura path={it.imagem} className="w-24 h-24 rounded-lg border" alt={it.artigo_nome} /></button>}
              <div className="flex-1 min-w-0">
                <div className="text-xl font-semibold">{it.artigo_nome} <span className="text-gray-500 font-normal">× {qtdFmt(it.quantidade)} {it.unidade && it.unidade !== "un" ? it.unidade : ""}</span></div>
                {it.artigo_codigo && <div className="text-sm text-gray-500">{it.artigo_codigo}</div>}
                {(it.personalizacoes || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">{it.personalizacoes.map((p, i) => <span key={p.id || i} className="px-3 py-1 rounded-lg bg-violet-50 text-violet-800 font-medium">{p.nome}</span>)}</div>
                )}
                {!it.personalizacoes?.length && it.tipo_personalizacao_nome && <div className="mt-2"><span className="px-3 py-1 rounded-lg bg-violet-50 text-violet-800 font-medium">{it.tipo_personalizacao_nome}</span></div>}
              </div>
              {it.arte_path && (
                <button type="button" className="self-start px-4 py-3 rounded-xl bg-violet-600 text-white font-semibold flex items-center gap-2" onClick={() => (/\.(png|jpe?g|gif|webp)$/i.test(it.arte_nome || it.arte_path) ? setVer({ path: it.arte_path, nome: it.arte_nome }) : abrirFicheiro({ path: it.arte_path, nome: it.arte_nome }))}>
                  <Paperclip className="w-5 h-5" /> Ver arte
                </button>
              )}
            </div>
            {it.observacoes && <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-lg whitespace-pre-line">{it.observacoes}</div>}
            {(it.materiais || []).length > 0 && (
              <div className="rounded-lg border border-gray-200">
                <div className="px-3 py-2 text-sm font-semibold uppercase tracking-wide text-gray-500 border-b">Materiais a usar</div>
                <ul className="divide-y">
                  {it.materiais.map((m, i) => (
                    <li key={m.id || i} className={`px-3 py-2 flex justify-between gap-3 ${m.consumido ? "text-gray-400 line-through" : ""}`}>
                      <span>{m.nome}</span><b className="whitespace-nowrap">{qtdFmt(m.quantidade)} {m.unidade}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {aPreparar(it) && !(it.operacoes || []).length && (
              <div className={`rounded-lg p-3 flex flex-wrap items-center gap-3 ${it.preparado ? "bg-emerald-50" : "bg-amber-50"}`} data-testid={`oficina-preparar-${it.id}`}>
                <Package className="w-6 h-6 text-amber-700" />
                <div className="flex-1 min-w-[10rem]">
                  <div className="text-lg font-semibold">Não se produz — ir buscar e juntar à encomenda</div>
                  {it.preparado && <div className="text-gray-600">Preparado{it.preparado_por ? ` por ${it.preparado_por}` : ""}</div>}
                </div>
                {it.preparado
                  ? <button type="button" disabled={busy === it.id} className="px-5 py-4 rounded-xl bg-white border-2 border-gray-300 text-lg font-semibold" onClick={() => preparar(it, false)}>Anular</button>
                  : <button type="button" disabled={busy === it.id} className="px-6 py-4 rounded-xl bg-emerald-600 text-white text-lg font-bold flex items-center gap-2" onClick={() => preparar(it, true)}><CheckCircle2 /> Preparado</button>}
              </div>
            )}
            <div className="space-y-2">
              {(it.operacoes || []).map((op) => {
                const nOp = notasItem.filter((n) => n.operacao_id === op.id).length;
                return (
                  <div key={op.id} className={`rounded-lg p-3 ${op.concluida ? "bg-emerald-50" : op.timer_inicio ? "bg-amber-50" : "bg-gray-50"}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[10rem]">
                        <div className="text-lg font-semibold">{op.nome}</div>
                        <div className="text-gray-500">{op.maquina_nome || "Sem máquina"} · previsto {Math.round(op.tempo_min || 0)} min · feito <b className="tabular-nums">{fmtSeg(seg(op))}</b></div>
                      </div>
                      <button type="button" className="px-4 py-4 rounded-xl bg-white border-2 border-gray-300 text-lg flex items-center gap-1" onClick={() => notaPara(it, op)} title="Deixar nota">
                        <StickyNote className="w-5 h-5" />{nOp > 0 && <span className="text-sm font-semibold">{nOp}</span>}
                      </button>
                      {op.concluida ? <span className="text-emerald-700 text-lg font-semibold flex items-center gap-1"><CheckCircle2 /> Feita</span> : (
                        <div className="flex gap-2">
                          {op.timer_inicio
                            ? <button type="button" disabled={busy === op.id} className="px-6 py-4 rounded-xl bg-amber-500 text-white text-lg font-bold flex items-center gap-2" onClick={() => acao(it, op, "parar")}><Pause /> Parar</button>
                            : <button type="button" disabled={busy === op.id} className="px-6 py-4 rounded-xl bg-emerald-600 text-white text-lg font-bold flex items-center gap-2" onClick={() => acao(it, op, "iniciar")} data-testid={`oficina-iniciar-${op.id}`}><Play /> Iniciar</button>}
                          <button type="button" disabled={busy === op.id} className="px-5 py-4 rounded-xl bg-white border-2 border-gray-300 text-lg font-semibold" onClick={() => acao(it, op, "concluir")}>Concluir</button>
                        </div>
                      )}
                    </div>
                    {op.nota && <div className="mt-2 text-gray-700 whitespace-pre-line"><b>Indicação:</b> {op.nota}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {tab === "documentos" && (
        <div className="space-y-4">
          {docs === null && <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
          {docs && !docs.length && <div className="text-gray-500 text-lg">Esta OF não tem documentos. Pode tirar uma foto com o botão «Foto».</div>}
          {(docs || []).map((g) => (
            <div key={g.titulo}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">{g.titulo}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {g.itens.map((f) => (
                  <button key={f.path} type="button" className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden text-left active:bg-gray-50" onClick={() => (f.kind === "imagem" ? setVer(f) : abrirFicheiro(f))}>
                    {f.kind === "imagem" ? <Miniatura path={f.path} className="w-full h-32" alt={f.nome} />
                      : <div className="h-32 flex items-center justify-center bg-gray-50"><FileText className="w-12 h-12 text-gray-400" /></div>}
                    <div className="px-3 py-2 text-sm truncate">{f.nome}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "notas" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <select value={nota.ref} onChange={(e) => setNota({ ...nota, ref: e.target.value })} className="w-full border-2 border-gray-300 rounded-xl px-3 py-3 text-lg bg-white">
              <option value="">Nota geral da OF</option>
              {of.itens.map((it) => [
                <option key={it.id} value={`${it.id}|`}>{it.artigo_nome}</option>,
                ...(it.operacoes || []).map((op) => <option key={op.id} value={`${it.id}|${op.id}`}>{it.artigo_nome} · {op.nome}</option>),
              ])}
            </select>
            <div className="flex flex-wrap gap-2">
              {NOTAS_RAPIDAS.map((t) => (
                <button key={t} type="button" className="px-3 py-2 rounded-lg bg-gray-100 active:bg-gray-200" onClick={() => setNota((n) => ({ ...n, texto: n.texto ? `${n.texto} ${t}` : t }))}>{t}</button>
              ))}
            </div>
            <textarea ref={notaRef} rows={3} value={nota.texto} onChange={(e) => setNota({ ...nota, texto: e.target.value })} placeholder="Escreva aqui o que é preciso saber…"
              className="w-full border-2 border-gray-300 rounded-xl px-3 py-3 text-lg" data-testid="oficina-nota-texto" />
            <button type="button" disabled={busy === "nota"} className="w-full py-4 rounded-xl bg-gray-900 text-white text-lg font-semibold flex items-center justify-center gap-2" onClick={gravarNota} data-testid="oficina-nota-gravar">
              {busy === "nota" ? <Loader2 className="animate-spin" /> : <StickyNote />} Gravar nota
            </button>
          </div>
          {!notas.length && <div className="text-gray-500 text-lg">Ainda não há notas nesta OF.</div>}
          <ul className="space-y-2">
            {notas.map((n) => (
              <li key={n.id} className="bg-white rounded-xl border p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-500">{n.por} · {quando(n.data)}{n.referencia ? ` · ${n.referencia}` : ""}</div>
                    <div className="text-lg whitespace-pre-line">{n.texto}</div>
                  </div>
                  {(n.por_id === user?.id || user?.perfil?.admin) && (
                    <button type="button" aria-label="Apagar nota" className="p-2 text-gray-400 hover:text-red-600" onClick={() => apagarNota(n)}><Trash2 className="w-5 h-5" /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    </ZonaArrastar>
  );
}
