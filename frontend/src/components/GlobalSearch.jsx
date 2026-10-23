import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Search, X, FileText, ClipboardList, Factory, Contact, Boxes, AlertTriangle, Scale } from "lucide-react";

const ICON = {
  "Cliente": Contact, "Orçamento": FileText, "Encomenda": ClipboardList,
  "Ordem de Fabrico": Factory, "Artigo": Boxes, "Não conformidade": AlertTriangle,
  "A receber": Scale, "A pagar": Scale,
};

export default function GlobalSearch({ onNavigate, autoFocus = false }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus?.(), 50);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const updatePanelPos = () => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanelStyle({
      position: "fixed",
      top: r.bottom + 4,
      left: r.left,
      width: r.width,
      zIndex: 60,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPos();
    const onScrollOrResize = () => updatePanelPos();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, res.length, q]);

  useEffect(() => {
    const h = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      const panel = document.getElementById("global-search-results-portal");
      if (panel && panel.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    const ql = q.trim();
    if (!ql) { setRes([]); setOpen(false); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const d = await api.get(`/search?q=${encodeURIComponent(ql)}`);
        setRes(d.resultados || []);
        setOpen(true);
      } finally { setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const go = (url) => { setOpen(false); setQ(""); setRes([]); onNavigate?.(); nav(url); };

  const resultsPanel = open && panelStyle && createPortal(
    <div
      id="global-search-results-portal"
      style={panelStyle}
      className="bg-white border border-gray-200 rounded-sm shadow-lg max-h-96 overflow-y-auto"
      data-testid="global-search-results"
    >
      {loading && res.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-400">A pesquisar...</div>
      ) : res.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-400">Sem resultados para "{q}".</div>
      ) : (
        res.map((r) => {
          const Icon = ICON[r.tipo] || Search;
          return (
            <button
              key={`${r.tipo}-${r.id}`}
              type="button"
              data-testid={`search-result-${r.id}`}
              onClick={() => go(r.url)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0"
            >
              <span className="shrink-0 h-8 w-8 rounded-sm bg-gray-100 text-gray-500 flex items-center justify-center">
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900 truncate">{r.titulo}</div>
                <div className="text-xs text-gray-400 truncate">{r.subtitulo}</div>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{r.tipo}</span>
            </button>
          );
        })
      )}
    </div>,
    document.body,
  );

  return (
    <div className="relative w-full max-w-md" ref={boxRef} data-testid="global-search">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        data-testid="global-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res.length && setOpen(true)}
        placeholder="Pesquisar pelo início do nome, nº ou código..."
        className="w-full pl-9 pr-8 py-2 text-sm bg-gray-100 border border-transparent rounded-sm focus:bg-white focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-900"
      />
      {q && (
        <button
          type="button"
          onClick={() => { setQ(""); setRes([]); setOpen(false); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
        >
          <X size={15} />
        </button>
      )}
      {resultsPanel}
    </div>
  );
}
