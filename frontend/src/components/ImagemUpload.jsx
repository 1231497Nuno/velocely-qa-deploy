import { useRef, useState } from "react";
import { API, getToken } from "@/lib/api";
import { ImagePlus, X, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";

export const imagemUrl = (path) => (path ? `${API}/files/${path}?auth=${getToken()}` : null);

export default function ImagemUpload({ value, onChange, editable = true, size = 44, testid }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const pick = () => inputRef.current?.click();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem demasiado grande (máx. 5 MB)"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(`${API}/upload/imagem`, fd, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      onChange(data.path);
      toast.success("Imagem carregada");
    } catch {
      toast.error("Falha ao carregar imagem");
    } finally {
      setBusy(false);
    }
  };

  const url = imagemUrl(value);
  const box = { width: size, height: size };

  return (
    <div className="inline-flex items-center" data-testid={testid}>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleFile} data-testid={testid ? `${testid}-input` : undefined} />
      {url ? (
        <div className="relative group" style={box}>
          <img
            src={url}
            alt="artigo"
            style={box}
            onClick={() => setPreview(true)}
            className="object-cover rounded-sm border border-gray-200 cursor-zoom-in"
            data-testid={testid ? `${testid}-thumb` : undefined}
          />
          <button type="button" onClick={() => setPreview(true)} className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-sm" aria-label="Ver imagem">
            <Maximize2 size={14} />
          </button>
          {editable && (
            <button type="button" onClick={() => onChange("")} data-testid={testid ? `${testid}-remove` : undefined} className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full p-0.5 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm" aria-label="Remover imagem">
              <X size={12} />
            </button>
          )}
        </div>
      ) : editable ? (
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          style={box}
          data-testid={testid ? `${testid}-add` : undefined}
          className="flex items-center justify-center rounded-sm border border-dashed border-gray-300 text-gray-400 hover:border-gray-900 hover:text-gray-700 transition-colors"
          aria-label="Adicionar imagem"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
        </button>
      ) : (
        <div style={box} className="flex items-center justify-center rounded-sm border border-gray-100 bg-gray-50 text-gray-300">
          <ImagePlus size={16} />
        </div>
      )}

      {preview && url && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-6" onClick={() => setPreview(false)} data-testid={testid ? `${testid}-preview` : undefined}>
          <img src={url} alt="artigo" className="max-h-[85vh] max-w-[85vw] object-contain rounded-sm" />
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" aria-label="Fechar"><X size={28} /></button>
        </div>
      )}
    </div>
  );
}
