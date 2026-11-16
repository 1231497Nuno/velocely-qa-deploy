import { useEffect, useState } from "react";
import { api, API } from "../lib/api";
import { FileDown, ChevronDown, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { toast } from "sonner";
import { openAuthenticated } from "@/lib/openAuthenticated";

const PATHS = { orcamento: "orcamentos", of: "ordens-fabrico", encomenda: "encomendas" };

export default function PdfExportButton({ modulo, recordId, label = "PDF" }) {
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const base = `${API}/${PATHS[modulo]}/${recordId}/pdf`;

  // Abre com o token (um link direto à API dava «Não autenticado») no visualizador da app
  const abrir = (url) => {
    setOpen(false);
    openAuthenticated(url).catch((e) => toast.error(e.message || "Não foi possível abrir o PDF"));
  };

  useEffect(() => {
    api.get(`/pdf-templates?modulo=${modulo}`).then(setTemplates).catch(() => setTemplates([]));
  }, [modulo]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="pdf-export-btn" className="btn btn-secundario">
          <FileDown size={16} /> {label} <ChevronDown size={14} className="text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-1.5 w-64" align="end">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Exportar PDF</div>
        <button type="button" data-testid="pdf-completo" onClick={() => abrir(base)} className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-sm text-sm text-gray-700 hover:bg-gray-100">
          <FileText size={15} className="text-gray-400" /> Predefinido
        </button>
        {templates.length > 0 && <div className="my-1 border-t border-gray-100" />}
        {templates.map((t) => (
          <button type="button" key={t.id} data-testid={`pdf-template-${t.id}`} onClick={() => abrir(`${base}?template_id=${t.id}`)} className="w-full text-left flex items-center justify-between gap-2 px-2 py-2 rounded-sm text-sm text-gray-700 hover:bg-gray-100">
            <span className="flex items-center gap-2 min-w-0"><FileText size={15} className="text-gray-400 shrink-0" /> <span className="truncate">{t.nome}</span></span>
            <span className="text-[10px] uppercase text-gray-400 shrink-0">{t.finalidade}</span>
          </button>
        ))}
        {templates.length === 0 && <div className="px-2 py-2 text-xs text-gray-400">Sem modelos. Crie em Definições → Modelos PDF.</div>}
      </PopoverContent>
    </Popover>
  );
}
