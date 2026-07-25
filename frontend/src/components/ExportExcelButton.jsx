import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportExcel } from "@/lib/excelIo";

/**
 * Exporta para Excel os IDs actualmente visíveis (respeita filtros da lista).
 */
export default function ExportExcelButton({ entity, ids, label = "Exportar Excel", className = "" }) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    if (!ids?.length) {
      toast.message("Nada para exportar com os filtros actuais");
      return;
    }
    setLoading(true);
    try {
      await exportExcel([entity], { [entity]: ids });
      toast.success("Excel descarregado");
    } catch (e) {
      toast.error(e?.message || "Erro ao exportar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      data-testid={`export-excel-${entity}`}
      onClick={onClick}
      disabled={loading}
      className={`bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-60 ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
      {label}
    </button>
  );
}
