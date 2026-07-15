import { useRef, useState } from "react";
import { API, getToken } from "@/lib/api";
import { imagemUrl } from "@/components/ImagemUpload";
import { ImagePlus, X, Loader2, Images } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";

export default function ImagensGaleria({ value = [], onChange, editable = true, title = "Imagens do documento", hint }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const imgs = value || [];

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const paths = [];
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) { toast.error(`"${file.name}" excede 5 MB`); continue; }
        const fd = new FormData();
        fd.append("file", file);
        const { data } = await axios.post(`${API}/upload/imagem`, fd, { headers: { Authorization: `Bearer ${getToken()}` } });
        paths.push(data.path);
      }
      if (paths.length) { onChange([...imgs, ...paths]); toast.success(paths.length > 1 ? `${paths.length} imagens carregadas` : "Imagem carregada"); }
    } catch {
      toast.error("Falha ao carregar imagem");
    } finally {
      setBusy(false);
    }
  };

  const remove = (p) => onChange(imgs.filter((x) => x !== p));

  return (
    <section className="mt-6" data-testid="imagens-galeria">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Images size={15} /> {title}
      </h2>
      <div className="bg-white border border-gray-200 rounded-sm p-5">
        {hint && <p className="text-xs text-gray-400 mb-3">{hint}</p>}
        <div className="flex flex-wrap gap-3">
          {imgs.map((p) => (
            <div key={p} className="relative group" style={{ width: 96, height: 96 }} data-testid={`galeria-item-${p.split("/").pop()}`}>
              <img src={imagemUrl(p)} alt="anexo" style={{ width: 96, height: 96 }} onClick={() => setPreview(p)} className="object-cover rounded-sm border border-gray-200 cursor-zoom-in" />
              {editable && (
                <button type="button" onClick={() => remove(p)} data-testid="galeria-remove" className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full p-0.5 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm" aria-label="Remover">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          {editable && (
            <>
              <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden" onChange={handleFiles} data-testid="galeria-input" />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                data-testid="galeria-add"
                style={{ width: 96, height: 96 }}
                className="flex flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-gray-300 text-gray-400 hover:border-gray-900 hover:text-gray-700 transition-colors text-xs"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <><ImagePlus size={18} /><span>Adicionar</span></>}
              </button>
            </>
          )}
          {!editable && imgs.length === 0 && <p className="text-sm text-gray-400">Sem imagens.</p>}
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-6" onClick={() => setPreview(null)} data-testid="galeria-preview">
          <img src={imagemUrl(preview)} alt="anexo" className="max-h-[85vh] max-w-[85vw] object-contain rounded-sm" />
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" aria-label="Fechar"><X size={28} /></button>
        </div>
      )}
    </section>
  );
}
