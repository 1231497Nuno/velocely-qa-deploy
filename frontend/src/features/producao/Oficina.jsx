import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Camera, Loader2, QrCode, X } from "lucide-react";
import OficinaOF from "./OficinaOF";
import { api, fmtDate } from "@/lib/api";

const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : d);

function LeitorQR({ onLido, onFechar }) {
  const video = useRef(null);
  useEffect(() => {
    let stream; let vivo = true; let timer;
    (async () => {
      if (!("BarcodeDetector" in window)) { toast.error("Este browser não lê QR pela câmara — escreva o número da OF"); onFechar(); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.current.srcObject = stream;
        await video.current.play();
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        const ler = async () => {
          if (!vivo) return;
          try {
            const r = await det.detect(video.current);
            if (r[0]?.rawValue) { onLido(r[0].rawValue); return; }
          } catch { /* continua */ }
          timer = setTimeout(ler, 300);
        };
        ler();
      } catch { toast.error("Sem acesso à câmara"); onFechar(); }
    })();
    return () => { vivo = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
      <video ref={video} className="max-w-full max-h-[70vh] rounded-lg" playsInline muted />
      <button type="button" className="mt-4 px-6 py-3 rounded-lg bg-white text-lg font-semibold" onClick={onFechar}><X className="inline mr-1" /> Fechar</button>
    </div>
  );
}

/** Ecrã da oficina (tablet): ler o QR da OF e iniciar/parar/concluir operações com botões grandes. */
export default function Oficina() {
  const [sp, setSp] = useSearchParams();
  const [of, setOf] = useState(null);
  const [ref, setRef] = useState("");
  const [lista, setLista] = useState([]);
  const [camara, setCamara] = useState(false);
  const [busy, setBusy] = useState("");
  const carregarLista = () => api.get("/producao/planeamento?dias=1").then((r) => {
    const m = new Map();
    r.operacoes.forEach((o) => {
      const x = m.get(o.of_id) || { id: o.of_id, numero: o.of_numero, cliente: o.cliente, prioritaria: o.prioritaria, prazo: o.prazo, em_curso: false, n: 0 };
      x.n += 1; x.em_curso = x.em_curso || o.em_curso; m.set(o.of_id, x);
    });
    setLista([...m.values()].sort((a, b) => (b.em_curso - a.em_curso) || (b.prioritaria - a.prioritaria) || String(a.prazo || "9").localeCompare(String(b.prazo || "9"))));
  }).catch(() => {});
  const abrir = async (r) => {
    let v = (r || "").trim();
    try { const u = new URL(v); v = u.searchParams.get("of") || v; } catch { /* não é URL */ }
    if (!v) return;
    setBusy("abrir");
    try { const o = await api.get(`/oficina/of/${encodeURIComponent(v)}`); setOf(o); setSp({ of: o.id }, { replace: true }); setRef(""); }
    catch (e) { erro(e, "OF não encontrada"); } finally { setBusy(""); setCamara(false); }
  };
  useEffect(() => { carregarLista(); if (sp.get("of")) abrir(sp.get("of")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-[80vh] -mx-[var(--app-pad-x)] px-3 sm:px-6 py-4 bg-gray-50" data-testid="oficina">
      {camara && <LeitorQR onLido={abrir} onFechar={() => setCamara(false)} />}
      <div className="flex flex-wrap gap-3 items-center mb-5">
        <button type="button" className="px-5 py-4 rounded-xl bg-gray-900 text-white text-lg font-semibold flex items-center gap-2" onClick={() => setCamara(true)} data-testid="oficina-qr"><Camera /> Ler QR da OF</button>
        <form className="flex gap-2 flex-1 min-w-[14rem]" onSubmit={(e) => { e.preventDefault(); abrir(ref); }}>
          <input className="flex-1 border-2 border-gray-300 rounded-xl px-4 py-3.5 text-lg" placeholder="ou escreva o nº da OF" value={ref} onChange={(e) => setRef(e.target.value)} data-testid="oficina-ref" />
          <button type="submit" className="px-5 rounded-xl bg-white border-2 border-gray-300 text-lg font-semibold">{busy === "abrir" ? <Loader2 className="animate-spin" /> : <QrCode />}</button>
        </form>
      </div>
      {!of ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((o) => (
            <button key={o.id} type="button" onClick={() => abrir(o.id)} className={`text-left rounded-xl border-2 p-4 bg-white ${o.em_curso ? "border-emerald-500" : o.prioritaria ? "border-amber-400" : "border-gray-200"}`}>
              <div className="text-xl font-bold">{o.numero}</div>
              <div className="text-gray-600 truncate">{o.cliente}</div>
              <div className="text-sm text-gray-500 mt-1">{o.n} operação(ões) por fazer{o.prazo ? ` · prazo ${fmtDate(o.prazo)}` : ""}{o.em_curso ? " · em curso" : ""}</div>
            </button>
          ))}
          {!lista.length && <div className="text-gray-500 text-lg">Não há OF por fazer.</div>}
        </div>
      ) : (
        <OficinaOF of={of} setOf={setOf} onOutra={() => { setOf(null); setSp({}, { replace: true }); carregarLista(); }} />
      )}
    </div>
  );
}
