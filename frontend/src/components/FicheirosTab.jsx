import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, API, getToken, fmtDate } from "@/lib/api";
import { imagemUrl } from "@/components/ImagemUpload";
import { toast } from "sonner";
import { FileText, Image as ImageIcon, Loader2, Paperclip, X, ExternalLink } from "lucide-react";

function fileHref(path) {
  return path ? `${API}/files/${path}?auth=${getToken()}` : null;
}

function fmtSize(n) {
  const b = Number(n) || 0;
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function ItemCard({ item, canDelete, onDelete }) {
  const href = fileHref(item.path);
  const isImg = item.kind === "imagem";
  const [preview, setPreview] = useState(false);
  return (
    <li className="relative group border border-gray-200 rounded-sm bg-white overflow-hidden">
      {isImg && href ? (
        <button type="button" onClick={() => setPreview(true)} className="block w-full" data-testid={`ficheiro-img-${item.id}`}>
          <img src={imagemUrl(item.path)} alt={item.nome} className="w-full h-28 object-cover bg-gray-50" />
        </button>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-3 min-h-[4.5rem]">
          <FileText size={18} className="text-gray-400 shrink-0" />
          <span className="text-sm text-gray-900 truncate">{item.nome}</span>
        </a>
      )}
      <div className="px-3 py-2 border-t border-gray-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-gray-800 truncate" title={item.nome}>{item.nome}</div>
          <div className="text-[11px] text-gray-400">
            {item.fonte === "capa" ? "Foto principal" : fmtSize(item.size) || (item.created_at ? fmtDate(item.created_at) : "—")}
          </div>
        </div>
        {canDelete && item.can_delete && (
          <button type="button" onClick={() => onDelete(item)} className="p-1 rounded-sm text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0" aria-label="Remover">
            <X size={14} />
          </button>
        )}
      </div>
      {preview && href && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-6" onClick={() => setPreview(false)}>
          <img src={imagemUrl(item.path)} alt={item.nome} className="max-h-[85vh] max-w-[85vw] object-contain rounded-sm" />
        </div>
      )}
    </li>
  );
}

export default function FicheirosTab({ tipo, id, canEdit = false, addLabel = "Adicionar ficheiro ou foto" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setData(await api.get(`/ficheiros/${tipo}/${id}`));
  }, [tipo, id]);

  useEffect(() => { load().catch(() => setData({ grupos: [] })); }, [load]);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      let last = null;
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        last = await api.post(`/ficheiros/${tipo}/${id}`, fd);
      }
      if (last) setData(last);
      toast.success(files.length > 1 ? `${files.length} ficheiros associados` : "Ficheiro associado");
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível carregar o ficheiro");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remover «${item.nome}»?`)) return;
    try {
      const next = await api.del(`/ficheiros/${tipo}/${id}?item=${encodeURIComponent(item.id)}`);
      setData(next);
      toast.success("Removido");
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível remover");
    }
  };

  if (!data) return <div className="text-sm text-gray-500">A carregar ficheiros...</div>;

  const grupos = data.grupos || [];
  const total = grupos.reduce((n, g) => n + (g.itens || []).length, 0);

  return (
    <div className="space-y-6" data-testid="ficheiros-tab">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {tipo === "artigo"
            ? (total === 0 ? "Ainda sem ficheiros nem fotos neste artigo." : `${total} ficheiro${total === 1 ? "" : "s"} neste artigo.`)
            : (total === 0
              ? "Ainda sem ficheiros. Os dos artigos das linhas aparecem aqui automaticamente."
              : `${total} ficheiro${total === 1 ? "" : "s"} · deste documento e dos artigos.`)
          }
        </p>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.odt,.ods,.zip"
              className="hidden"
              onChange={onFiles}
              data-testid="ficheiros-input"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              data-testid="ficheiros-add"
              className="bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              {addLabel}
            </button>
          </>
        )}
      </div>

      {grupos.map((g) => (
        <section key={g.id} className="bg-white border border-gray-200 rounded-sm p-5" data-testid={`ficheiros-grupo-${g.id}`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0">
              {g.origem === "artigo" ? <ImageIcon size={15} className="text-gray-400 shrink-0" /> : <Paperclip size={15} className="text-gray-400 shrink-0" />}
              <span className="truncate">{g.titulo}</span>
            </h3>
            {g.origem === "artigo" && g.artigo_id && (
              <Link
                to={`/artigos/${g.artigo_id}?tab=ficheiros`}
                className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 shrink-0"
              >
                Ver artigo <ExternalLink size={12} />
              </Link>
            )}
          </div>
          {(g.itens || []).length === 0 ? (
            <p className="text-sm text-gray-400">
              {g.origem === "documento" ? "Pode adicionar PDFs, fotos ou folhas de cálculo só deste documento." : "Este artigo ainda não tem ficheiros."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(g.itens || []).map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  canDelete={canEdit && g.origem === "documento"}
                  onDelete={remove}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
