import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { fileApiUrl, useAuthFileUrl } from "@/lib/authFileUrl";
import { openAuthenticated } from "@/lib/openAuthenticated";

const eImagem = (a) => /^image\//.test(a.content_type || "") || /\.(png|jpe?g|gif|webp)$/i.test(a.nome || a.path);

function Miniatura({ a }) {
  const src = useAuthFileUrl(eImagem(a) ? a.path : null);
  return src ? <img src={src} alt={a.nome} className="w-full h-28 object-contain bg-gray-50" />
    : <div className="w-full h-28 flex items-center justify-center bg-gray-50"><FileText className="text-gray-400" size={32} /></div>;
}

/** Lista de artes do cliente; `onEscolher(arte)` torna-a selecionável (para usar numa linha). */
export function useArtesCliente(clienteId) {
  const [artes, setArtes] = useState(null);
  useEffect(() => {
    if (!clienteId) { setArtes([]); return; }
    api.get(`/clientes/${clienteId}/artes`).then(setArtes).catch(() => setArtes([]));
  }, [clienteId]);
  return artes;
}

export function GrelhaArtes({ artes, onEscolher, compacto = false }) {
  if (artes === null) return <div className="flex justify-center p-6"><Loader2 className="animate-spin text-gray-400" /></div>;
  if (!artes.length) return <p className="text-sm text-gray-500">Ainda não há artes deste cliente. As maquetas anexadas às linhas dos orçamentos e encomendas aparecem aqui.</p>;
  return (
    <div className={`grid gap-3 ${compacto ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
      {artes.map((a) => (
        <div key={a.path} className="bg-white border border-gray-200 rounded-sm overflow-hidden flex flex-col">
          <button type="button" onClick={() => openAuthenticated(fileApiUrl(a.path), { filename: a.nome }).catch((e) => toast.error(e.message))} title="Abrir">
            <Miniatura a={a} />
          </button>
          <div className="p-2 text-xs space-y-0.5 flex-1">
            <div className="font-medium truncate" title={a.nome}>{a.nome}</div>
            <div className="text-gray-500 truncate">{a.artigo_nome}</div>
            <div className="text-gray-400">{a.documento} · {fmtDate(a.data)}{a.usos > 1 ? ` · ${a.usos}×` : ""}</div>
            {a.aprovada && <div className="text-emerald-700 flex items-center gap-1"><CheckCircle2 size={12} /> Aprovada pelo cliente</div>}
          </div>
          {onEscolher ? (
            <button type="button" className="m-2 mt-0 btn btn-secundario btn-sm justify-center" onClick={() => onEscolher(a)}>Usar esta</button>
          ) : (
            <Link to={a.link} className="px-2 pb-2 text-xs underline text-gray-600">Ver {a.tipo === "orcamento" ? "orçamento" : "encomenda"}</Link>
          )}
        </div>
      ))}
    </div>
  );
}

/** Separador «Artes» da ficha do cliente. */
export default function ArtesCliente({ clienteId }) {
  const artes = useArtesCliente(clienteId);
  return (
    <div className="space-y-3" data-testid="cliente-artes">
      <p className="text-sm text-gray-600">Logótipos, artes e maquetas usadas com este cliente — reutilize-as num orçamento novo com «Arte do cliente» na linha.</p>
      <GrelhaArtes artes={artes} />
    </div>
  );
}
