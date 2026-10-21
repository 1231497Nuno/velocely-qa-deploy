import { useRef, useState } from "react";
import axios from "axios";
import { Paperclip, X, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { API, getToken } from "@/lib/api";
import { imagemUrl } from "@/components/ImagemUpload";

/** Anexa PDF/JPEG à linha do orçamento (maqueta / arte final). */
export default function LinhaArteButton({ linha, onChange, canEdit, testid }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const hasArte = !!(linha?.arte_path);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Ficheiro demasiado grande (máx. 15 MB)");
      return;
    }
    const okType = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/i.test(file.type)
      || /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
    if (!okType) {
      toast.error("Só PDF ou JPEG/PNG");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(`${API}/upload/ficheiro`, fd, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      onChange?.({
        arte_path: data.path,
        arte_nome: data.nome || file.name,
        arte_content_type: data.content_type || file.type || "",
      });
      toast.success("Arte associada à linha");
    } catch {
      toast.error("Falha ao carregar o ficheiro");
    } finally {
      setBusy(false);
    }
  };

  const openArte = () => {
    if (!linha?.arte_path) return;
    const url = imagemUrl(linha.arte_path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="inline-flex items-center gap-0.5" data-testid={testid}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={upload}
      />
      {hasArte ? (
        <>
          <button
            type="button"
            title={linha.arte_nome || "Ver arte"}
            onClick={openArte}
            className="p-1 rounded-sm text-violet-700 hover:bg-violet-50"
            data-testid={testid ? `${testid}-open` : undefined}
          >
            <FileText size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              title="Remover arte"
              onClick={() => onChange?.({ arte_path: "", arte_nome: "", arte_content_type: "" })}
              className="p-0.5 rounded-sm text-gray-400 hover:text-red-600 hover:bg-red-50"
            >
              <X size={12} />
            </button>
          )}
        </>
      ) : canEdit ? (
        <button
          type="button"
          title="Anexar arte (PDF/JPEG)"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="p-1 rounded-sm text-gray-400 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-50"
          data-testid={testid ? `${testid}-add` : undefined}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
        </button>
      ) : null}
    </div>
  );
}
