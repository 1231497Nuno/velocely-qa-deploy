import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Printer, X } from "lucide-react";
import { descarregarUrl } from "@/lib/openAuthenticated";

/**
 * Visualizador global de PDFs e imagens (aberto por `openAuthenticated`).
 * Mostra o documento dentro da app, com Descarregar, Imprimir e Abrir noutro separador.
 */
export default function VisualizadorFicheiro() {
  const [f, setF] = useState(null);
  const frame = useRef(null);

  useEffect(() => {
    window.__velocelyVerFicheiro = (x) => setF((antigo) => { if (antigo) URL.revokeObjectURL(antigo.url); return x; });
    return () => { delete window.__velocelyVerFicheiro; };
  }, []);
  const fechar = () => { setF((x) => { if (x) setTimeout(() => URL.revokeObjectURL(x.url), 1000); return null; }); };
  useEffect(() => {
    if (!f) return undefined;
    const k = (e) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [f]);

  if (!f) return null;
  const imagem = /^image\//.test(f.tipo) || /\.(png|jpe?g|gif|webp)$/i.test(f.nome);
  const imprimir = () => {
    try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }
    catch { window.open(f.url, "_blank"); }
  };
  const btn = "inline-flex items-center gap-1.5 px-3 py-2 rounded-sm text-sm font-medium bg-white/10 hover:bg-white/20 text-white";
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex flex-col" role="dialog" aria-modal="true" aria-label={f.nome} data-testid="visualizador-ficheiro">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0A0A0A] text-white pt-[max(env(safe-area-inset-top),0.5rem)]">
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{f.nome}</span>
        <button type="button" className={btn} onClick={() => descarregarUrl(f.url, f.nome)} data-testid="visualizador-descarregar"><Download size={16} /><span className="hidden sm:inline">Descarregar</span></button>
        {!imagem && <button type="button" className={btn} onClick={imprimir}><Printer size={16} /><span className="hidden sm:inline">Imprimir</span></button>}
        <button type="button" className={btn} onClick={() => window.open(f.url, "_blank")}><ExternalLink size={16} /><span className="hidden sm:inline">Abrir noutro separador</span></button>
        <button type="button" className={btn} onClick={fechar} aria-label="Fechar" data-testid="visualizador-fechar"><X size={18} /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-0 sm:p-3" onClick={(e) => { if (e.target === e.currentTarget) fechar(); }} role="presentation">
        {imagem
          ? <img src={f.url} alt={f.nome} className="max-w-full max-h-full object-contain bg-white" />
          : <iframe ref={frame} src={f.url} title={f.nome} className="w-full h-full max-w-5xl bg-white sm:rounded-sm" />}
      </div>
    </div>
  );
}
