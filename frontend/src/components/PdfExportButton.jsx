import { useEffect, useState } from "react";
import { api, API } from "../lib/api";
import { FileDown, ChevronDown, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const PATHS = { orcamento: "orcamentos", of: "ordens-fabrico", encomenda: "encomendas" };

export default function PdfExportButton({ modulo, recordId, label = "PDF" }) {
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const base = `${API}/${PATHS[modulo]}/${recordId}/pdf`;

  useEffect(() => {
    api.get(`/pdf-templates?modulo=${modulo}`).then(setTemplates).catch(() => setTemplates([]));
  }, [modulo]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="pdf-export-btn" className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors">
          <FileDown size={16} /> {label} <ChevronDown size={14} className="text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-1.5 w-64" align="end">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Exportar PDF</div>
        <a href={base} target="_blank" rel="noopener noreferrer" data-testid="pdf-completo" onClick={() => setOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-sm text-sm text-gray-700 hover:bg-gray-100">
          <FileText size={15} className="text-gray-400" /> Completo (todos os campos)
        </a>
        {templates.length > 0 && <div className="my-1 border-t border-gray-100" />}
        {templates.map((t) => (
          <a key={t.id} href={`${base}?template_id=${t.id}`} target="_blank" rel="noopener noreferrer" data-testid={`pdf-template-${t.id}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 px-2 py-2 rounded-sm text-sm text-gray-700 hover:bg-gray-100">
            <span className="flex items-center gap-2 min-w-0"><FileText size={15} className="text-gray-400 shrink-0" /> <span className="truncate">{t.nome}</span></span>
            <span className="text-[10px] uppercase text-gray-400 shrink-0">{t.finalidade}</span>
          </a>
        ))}
        {templates.length === 0 && <div className="px-2 py-2 text-xs text-gray-400">Sem modelos. Crie em Definições → Modelos PDF.</div>}
      </PopoverContent>
    </Popover>
  );
}
