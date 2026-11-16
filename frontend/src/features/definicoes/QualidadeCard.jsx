import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Save } from "lucide-react";
import { api } from "@/lib/api";

/** Pontos do controlo de qualidade pedidos ao fechar cada OF (e se são obrigatórios). */
export default function QualidadeCard() {
  const [cfg, setCfg] = useState(null);
  const [texto, setTexto] = useState("");
  useEffect(() => { api.get("/producao/qualidade").then((r) => { setCfg(r); setTexto(r.itens.join("\n")); }).catch(() => {}); }, []);
  if (!cfg) return null;
  const guardar = async () => {
    try {
      const r = await api.put("/producao/qualidade", { ...cfg, itens: texto.split("\n") });
      setCfg(r); setTexto(r.itens.join("\n")); toast.success("Controlo de qualidade guardado");
    } catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível guardar"); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 mb-5" data-testid="qualidade-card">
      <div className="font-semibold text-sm flex items-center gap-2"><ShieldCheck size={16} /> Controlo de qualidade no fecho da OF</div>
      <p className="text-xs text-gray-500 mb-2">Um ponto por linha. Aparecem como lista de verificação quando se fecha uma ordem de fabrico; as fotos ficam nos Ficheiros da OF.</p>
      <textarea className="w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div className="flex flex-wrap items-center gap-4 mt-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.obrigatorio} onChange={(e) => setCfg({ ...cfg, obrigatorio: e.target.checked })} /> Todos os pontos obrigatórios</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.foto_obrigatoria} onChange={(e) => setCfg({ ...cfg, foto_obrigatoria: e.target.checked })} /> Foto obrigatória</label>
        <button type="button" className="btn btn-primario ml-auto" onClick={guardar}><Save size={15} /> Guardar</button>
      </div>
    </div>
  );
}
