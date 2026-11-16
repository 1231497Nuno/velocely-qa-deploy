import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Fila de registos feitos sem rede (app móvel): ficam no telemóvel e são enviados quando a rede voltar.
 * Só para operações que podem ser repetidas mais tarde sem resposta imediata (movimentos, contagens, picking).
 */
const CHAVE = "velocely-fila-offline";
const EVENTO = "velocely:fila";

function ler() {
  try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch { return []; }
}
function gravar(fila) {
  try { localStorage.setItem(CHAVE, JSON.stringify(fila)); } catch { /* armazenamento indisponível */ }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: fila.length }));
}
const semRede = (e) => !e?.response;

/** Envia já; se não houver rede, guarda na fila e devolve `{ offline: true }`. Erros do servidor (4xx/5xx) são lançados. */
export async function enviarOuGuardar(caminho, corpo, descricao = "") {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    gravar([...ler(), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, caminho, corpo, descricao, em: new Date().toISOString() }]);
    return { offline: true };
  }
  try {
    return await api.post(caminho, corpo);
  } catch (e) {
    if (!semRede(e)) throw e;
    gravar([...ler(), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, caminho, corpo, descricao, em: new Date().toISOString() }]);
    return { offline: true };
  }
}

let aSincronizar = false;
/** Envia a fila pela ordem; para no primeiro erro de rede. Os rejeitados pelo servidor saem da fila e são devolvidos. */
export async function sincronizar() {
  if (aSincronizar) return { enviados: 0, rejeitados: [] };
  aSincronizar = true;
  let enviados = 0;
  const rejeitados = [];
  try {
    for (const item of ler()) {
      try {
        await api.post(item.caminho, item.corpo);
        enviados += 1;
      } catch (e) {
        if (semRede(e)) break;
        rejeitados.push({ ...item, erro: e?.response?.data?.detail || "Recusado pelo servidor" });
      }
      gravar(ler().filter((x) => x.id !== item.id));
    }
  } finally { aSincronizar = false; }
  return { enviados, rejeitados };
}

export function pendentesOffline() { return ler(); }

/** Nº de registos por enviar; sincroniza sozinho quando a rede volta. */
export function useFilaOffline(onResultado) {
  const [n, setN] = useState(() => ler().length);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const mudou = (e) => setN(typeof e?.detail === "number" ? e.detail : ler().length);
    const correr = async () => { const r = await sincronizar(); setN(ler().length); if (r.enviados || r.rejeitados.length) onResultado?.(r); };
    const on = () => { setOnline(true); correr(); };
    const off = () => setOnline(false);
    window.addEventListener(EVENTO, mudou);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (ler().length && navigator.onLine !== false) correr();
    const t = setInterval(() => { if (ler().length && navigator.onLine !== false) correr(); }, 60_000);
    return () => { window.removeEventListener(EVENTO, mudou); window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { pendentes: n, online, sincronizar: async () => { const r = await sincronizar(); setN(ler().length); onResultado?.(r); return r; } };
}

/** Regista o service worker (cópia da app para funcionar com rede fraca). */
export function registarServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
