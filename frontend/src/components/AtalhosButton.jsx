import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Atalhos pessoais: guardar a página atual (com filtros do endereço) e voltar a ela num clique. */
export default function AtalhosButton() {
  const loc = useLocation();
  const nav = useNavigate();
  const [atalhos, setAtalhos] = useState([]);
  const [nome, setNome] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { api.get("/me/preferencias").then((p) => setAtalhos(p.atalhos || [])).catch(() => {}); }, []);
  const url = `${loc.pathname}${loc.search}`;
  const guardar = async (lista) => {
    try { const r = await api.put("/me/preferencias", { atalhos: lista }); setAtalhos(r.atalhos); } catch { toast.error("Não foi possível guardar"); }
  };
  const ja = atalhos.some((a) => a.url === url);
  const tituloPagina = () => (document.querySelector("h1")?.textContent || "").trim().slice(0, 50);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setNome(tituloPagina()); }}>
      <PopoverTrigger asChild>
        <button type="button" className="touch-target relative inline-flex items-center justify-center rounded-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 p-2" aria-label="Atalhos" title="Os meus atalhos" data-testid="atalhos-btn">
          <Star size={18} strokeWidth={1.8} className={ja ? "fill-amber-400 text-amber-500" : ""} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="text-xs font-semibold text-gray-500 px-1 pb-1">Os meus atalhos</div>
        {atalhos.map((a) => (
          <div key={a.id} className="group flex items-center rounded-sm hover:bg-gray-100">
            <button type="button" className="flex-1 text-left px-2 py-1.5 text-sm truncate" onClick={() => { setOpen(false); nav(a.url); }}>{a.nome}</button>
            <button type="button" className="p-1.5 opacity-0 group-hover:opacity-70 hover:!opacity-100" onClick={() => guardar(atalhos.filter((x) => x.id !== a.id))} title="Remover"><Trash2 size={13} /></button>
          </div>
        ))}
        {!atalhos.length && <div className="text-xs text-gray-400 px-2 py-2">Guarde aqui as páginas e listas filtradas que usa todos os dias.</div>}
        {!ja && (
          <div className="border-t border-gray-100 mt-2 pt-2 flex gap-1.5">
            <input className="flex-1 border border-gray-300 rounded-sm px-2 py-1 text-sm" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do atalho" />
            <button type="button" className="btn btn-primario btn-sm" disabled={!nome.trim()} onClick={() => guardar([...atalhos, { nome: nome.trim(), url }])} data-testid="atalho-guardar">Guardar esta página</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
