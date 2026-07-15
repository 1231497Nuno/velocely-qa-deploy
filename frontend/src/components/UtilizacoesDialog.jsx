import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { FileText, ClipboardList, Factory, Boxes, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const ESTADO_PT = {
  rascunho: "Rascunho", enviado: "Enviado", aceite: "Aceite", rejeitado: "Rejeitado",
  pendente: "Pendente", em_producao: "Em Produção", concluido: "Concluído",
  aberta: "Aberta", concluida: "Concluída", cancelada: "Cancelada",
};

function Grupo({ icon: Icon, titulo, testid, items, onGo }) {
  if (!items || items.length === 0) return null;
  return (
    <div data-testid={`utilizacoes-grupo-${testid}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-2">
        <Icon size={14} /> {titulo} <span className="text-gray-400 normal-case tracking-normal">({items.length})</span>
      </div>
      <div className="space-y-1">
        {items.map((r) => (
          <button
            key={r.id}
            data-testid={`utilizacao-${testid}-${r.id}`}
            onClick={onGo ? () => onGo(r) : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-sm border border-gray-100 text-left ${onGo ? "hover:bg-gray-50 hover:border-gray-200 cursor-pointer" : "cursor-default"}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{r.numero || r.nome}</div>
              {(r.cliente || r.estado) && (
                <div className="text-xs text-gray-400 truncate">
                  {r.cliente}{r.cliente && r.estado ? " · " : ""}{ESTADO_PT[r.estado] || r.estado}
                </div>
              )}
            </div>
            {onGo && <ExternalLink size={14} className="shrink-0 text-gray-400" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function UtilizacoesDialog({ open, onOpenChange, endpoint, titulo, subtitulo }) {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !endpoint) return;
    setData(null);
    setLoading(true);
    api.get(endpoint).then(setData).catch(() => setData({})).finally(() => setLoading(false));
  }, [open, endpoint]);

  const go = (base) => (r) => { onOpenChange(false); nav(`${base}/${r.id}`); };
  const d = data || {};
  const totalDocs = (d.artigos?.length || 0) + (d.orcamentos?.length || 0) + (d.encomendas?.length || 0) + (d.ordens_fabrico?.length || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="utilizacoes-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{titulo}</DialogTitle>
          <DialogDescription>{subtitulo || "Onde está a ser utilizado no sistema."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-1">
          {loading ? (
            <div className="text-sm text-gray-400 py-6 text-center">A carregar...</div>
          ) : totalDocs === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center" data-testid="utilizacoes-vazio">Ainda não está a ser utilizado em nenhum registo.</div>
          ) : (
            <>
              <Grupo icon={Boxes} titulo="Artigos" testid="artigos" items={d.artigos} />
              <Grupo icon={FileText} titulo="Orçamentos" testid="orcamentos" items={d.orcamentos} onGo={go("/orcamentos")} />
              <Grupo icon={ClipboardList} titulo="Encomendas" testid="encomendas" items={d.encomendas} onGo={go("/encomendas")} />
              <Grupo icon={Factory} titulo="Ordens de Fabrico" testid="ordens" items={d.ordens_fabrico} onGo={go("/ordens-fabrico")} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
