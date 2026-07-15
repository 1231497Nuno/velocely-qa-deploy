import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Search, X, FileText, ClipboardList, Factory, Contact, Boxes } from "lucide-react";

const ICON = {
  "Cliente": Contact, "Orçamento": FileText, "Encomenda": ClipboardList,
  "Ordem de Fabrico": Factory, "Artigo": Boxes,
};

export default function GlobalSearch({ onNavigate }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const d = await api.get(`/search?q=${encodeURIComponent(q.trim())}`);
        setRes(d.resultados || []);
        setOpen(true);
      } finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (url) => { setOpen(false); setQ(""); setRes([]); onNavigate?.(); nav(url); };

  return (
    <div className="relative w-full max-w-md" ref={boxRef} data-testid="global-search">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        data-testid="global-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res.length && setOpen(true)}
        placeholder="Pesquisar clientes, orçamentos, encomendas, OFs, artigos..."
        className="w-full pl-9 pr-8 py-2 text-sm bg-gray-100 border border-transparent rounded-sm focus:bg-white focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-900"
      />
      {q && <button onClick={() => { setQ(""); setRes([]); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X size={15} /></button>}

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-sm shadow-lg max-h-96 overflow-y-auto" data-testid="global-search-results">
          {loading && res.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">A pesquisar...</div>
          ) : res.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">Sem resultados para "{q}".</div>
          ) : (
            res.map((r) => {
              const Icon = ICON[r.tipo] || Search;
              return (
                <button key={`${r.tipo}-${r.id}`} data-testid={`search-result-${r.id}`} onClick={() => go(r.url)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0">
                  <span className="shrink-0 h-8 w-8 rounded-sm bg-gray-100 text-gray-500 flex items-center justify-center"><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 truncate">{r.titulo}</div>
                    <div className="text-xs text-gray-400 truncate">{r.subtitulo}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{r.tipo}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
