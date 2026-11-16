import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";

/** Converte uma lista de ficheiros num «evento» igual ao do <input type="file"> (para reutilizar o mesmo handler). */
export const comoEvento = (files) => ({ target: { files, value: "" }, currentTarget: { files, value: "" } });

/** O ficheiro corresponde ao `accept` do input? (".pdf,image/*,application/pdf") */
export function aceita(file, accept) {
  if (!accept) return true;
  const nome = (file.name || "").toLowerCase();
  const tipo = (file.type || "").toLowerCase();
  return accept.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).some((a) => {
    if (a.startsWith(".")) return nome.endsWith(a);
    if (a.endsWith("/*")) return tipo.startsWith(a.slice(0, -1));
    return tipo === a;
  });
}

const temFicheiros = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

/**
 * Zona onde se pode largar ficheiros arrastados (do explorador/ambiente de trabalho), além do botão de escolher.
 * Mostra um realce «Largue aqui» enquanto se arrasta por cima.
 *
 * onFicheiros(files: File[]) · accept (igual ao do input) · multiple · disabled · texto · className
 */
export default function ZonaArrastar({
  onFicheiros, accept = "", multiple = false, disabled = false, texto, className = "", children, testid, compacto = false,
}) {
  const [por, setPor] = useState(false);
  const cont = useRef(0);

  const enter = (e) => {
    if (disabled || !temFicheiros(e)) return;
    e.preventDefault();
    cont.current += 1;
    setPor(true);
  };
  const over = (e) => {
    if (disabled || !temFicheiros(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const leave = (e) => {
    if (disabled || !temFicheiros(e)) return;
    cont.current = Math.max(0, cont.current - 1);
    if (!cont.current) setPor(false);
  };
  const drop = (e) => {
    if (disabled || !temFicheiros(e)) return;
    e.preventDefault();
    e.stopPropagation();
    cont.current = 0;
    setPor(false);
    let files = Array.from(e.dataTransfer.files || []);
    const rejeitados = files.filter((f) => !aceita(f, accept));
    files = files.filter((f) => aceita(f, accept));
    if (rejeitados.length) toast.error(`Tipo de ficheiro não aceite aqui: ${rejeitados.map((f) => f.name).join(", ")}`);
    if (!files.length) return;
    if (!multiple && files.length > 1) {
      toast.message(`Só é possível um ficheiro aqui — usei «${files[0].name}».`);
      files = files.slice(0, 1);
    }
    onFicheiros(files);
  };

  return (
    <div className={`relative ${className}`} onDragEnter={enter} onDragOver={over} onDragLeave={leave} onDrop={drop} data-testid={testid}>
      {children}
      {por && (
        <div className={`pointer-events-none absolute inset-0 z-40 rounded-sm border-2 border-dashed border-brand bg-white/85 flex flex-col items-center justify-center gap-1 text-sm font-medium text-gray-800 ${compacto ? "" : "min-h-[3rem]"}`}>
          <UploadCloud size={compacto ? 16 : 22} className="text-brand" />
          {!compacto && (texto || (multiple ? "Largue os ficheiros aqui" : "Largue o ficheiro aqui"))}
        </div>
      )}
    </div>
  );
}

/**
 * Evita que o browser abra um ficheiro largado fora de uma zona de carregamento (perdendo o que estava no ecrã).
 * Montado uma vez na App.
 */
export function BloquearLargarFora() {
  useEffect(() => {
    const parar = (e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", parar);
    window.addEventListener("drop", parar);
    return () => { window.removeEventListener("dragover", parar); window.removeEventListener("drop", parar); };
  }, []);
  return null;
}
