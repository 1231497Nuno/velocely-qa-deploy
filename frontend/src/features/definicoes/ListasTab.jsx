import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { recarregarListas } from "@/lib/listas";

/** Definições → Listas: valores que aparecem nos menus do ERP (as "tabelas diversas" do Sage). */
export default function ListasTab() {
  const { isAdmin } = useAuth();
  const [listas, setListas] = useState(null);
  const [sel, setSel] = useState("");
  const [valores, setValores] = useState([]);
  const [novo, setNovo] = useState("");
  const [busy, setBusy] = useState(false);

  const aplicar = (r, chave) => {
    setListas(r.listas);
    const k = chave || sel || r.listas[0]?.key;
    setSel(k);
    setValores([...(r.listas.find((l) => l.key === k)?.valores || [])]);
  };
  useEffect(() => { api.get("/definicoes/listas").then((r) => aplicar(r)).catch(() => toast.error("Não foi possível carregar as listas")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!listas) return <div className="text-sm text-gray-500">A carregar...</div>;
  const atual = listas.find((l) => l.key === sel);
  const sujo = JSON.stringify(valores) !== JSON.stringify(atual?.valores || []);
  const dis = !isAdmin;

  const escolher = (k) => {
    if (sujo && !window.confirm("Há alterações por guardar nesta lista. Sair na mesma?")) return;
    setSel(k);
    setValores([...(listas.find((l) => l.key === k)?.valores || [])]);
    setNovo("");
  };
  const adicionar = () => {
    const v = novo.trim();
    if (!v) return;
    if (valores.some((x) => x.toLowerCase() === v.toLowerCase())) { toast.error("Esse valor já existe"); return; }
    setValores([...valores, v]);
    setNovo("");
  };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= valores.length) return;
    const v = [...valores];
    [v[i], v[j]] = [v[j], v[i]];
    setValores(v);
  };
  const guardar = async () => {
    setBusy(true);
    try {
      aplicar(await api.put(`/definicoes/listas/${sel}`, { valores }), sel);
      recarregarListas();
      toast.success(`Lista «${atual.label}» guardada`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] gap-5" data-testid="listas-tab">
      <nav className="bg-white border border-gray-200 rounded-sm p-2 h-fit">
        {listas.map((l) => (
          <button key={l.key} type="button" onClick={() => escolher(l.key)} data-testid={`lista-${l.key}`}
            className={`w-full text-left px-3 py-2 rounded-sm text-sm flex items-center justify-between ${l.key === sel ? "bg-brand text-brand-fg" : "text-gray-700 hover:bg-gray-100"}`}>
            <span className="truncate">{l.label}</span>
            <span className={`text-[11px] tabular-nums ${l.key === sel ? "opacity-80" : "text-gray-400"}`}>{l.valores.length}</span>
          </button>
        ))}
      </nav>
      {atual && (
        <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-700">{atual.label}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Aparece em: {atual.onde}. A ordem aqui é a ordem nos menus. Retirar um valor não altera os registos que já o usam.</p>
          </div>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-sm">
            {valores.map((v, i) => (
              <li key={v} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <div className="flex flex-col">
                  <button type="button" disabled={dis || i === 0} onClick={() => mover(i, -1)} className="text-gray-400 hover:text-gray-900 disabled:opacity-30"><ArrowUp size={12} /></button>
                  <button type="button" disabled={dis || i === valores.length - 1} onClick={() => mover(i, 1)} className="text-gray-400 hover:text-gray-900 disabled:opacity-30"><ArrowDown size={12} /></button>
                </div>
                <input value={v} disabled={dis} onChange={(e) => setValores(valores.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1 border border-transparent hover:border-gray-200 focus:border-brand rounded-sm px-2 py-1 text-sm disabled:bg-transparent" />
                {!dis && <button type="button" onClick={() => setValores(valores.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X size={14} /></button>}
              </li>
            ))}
            {valores.length === 0 && <li className="px-3 py-4 text-sm text-gray-400">Lista vazia.</li>}
          </ul>
          {!dis && (
            <div className="flex flex-wrap gap-2">
              <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} placeholder="Novo valor" className="flex-1 min-w-[12rem] border border-gray-300 rounded-sm px-3 py-1.5 text-sm" data-testid="lista-novo" />
              <button type="button" onClick={adicionar} className="btn btn-secundario"><Plus size={14} /> Adicionar</button>
              <button type="button" onClick={() => setValores([...atual.padrao])} className="btn btn-secundario" title="Repor os valores de origem"><RotateCcw size={14} /> Repor</button>
              <button type="button" onClick={guardar} disabled={busy || !sujo} className="btn btn-primario ml-auto" data-testid="lista-guardar"><Save size={15} /> Guardar</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
