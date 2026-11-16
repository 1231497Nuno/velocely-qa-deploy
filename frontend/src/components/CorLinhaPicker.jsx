import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, X } from "lucide-react";

export const CORES_LINHA = [
  { cor: "#dc2626", nome: "Vermelho" },
  { cor: "#ea580c", nome: "Laranja" },
  { cor: "#d97706", nome: "Amarelo" },
  { cor: "#16a34a", nome: "Verde" },
  { cor: "#0891b2", nome: "Ciano" },
  { cor: "#2563eb", nome: "Azul" },
  { cor: "#7c3aed", nome: "Violeta" },
  { cor: "#64748b", nome: "Cinza" },
];

/** Estilo de uma linha de artigo com cor (barra à esquerda + fundo suave). */
export function estiloLinhaCor(cor) {
  if (!cor) return undefined;
  return { boxShadow: `inset 4px 0 0 ${cor}`, backgroundColor: `${cor}12` };
}

/** Bolinha que abre uma paleta para marcar a linha com uma cor. */
export default function CorLinhaPicker({ value, onChange, disabled = false, testid }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={value ? "Mudar a cor da linha" : "Marcar a linha com uma cor"}
          data-testid={testid}
          className="w-5 h-5 rounded-full border border-gray-300 shrink-0 flex items-center justify-center hover:ring-2 hover:ring-gray-200 disabled:opacity-50"
          style={value ? { background: value, borderColor: value } : { background: "repeating-linear-gradient(45deg,#fff,#fff 2px,#e5e7eb 2px,#e5e7eb 4px)" }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-4 gap-1.5">
          {CORES_LINHA.map((c) => (
            <button
              key={c.cor}
              type="button"
              title={c.nome}
              onClick={() => onChange(c.cor)}
              className="w-7 h-7 rounded-full flex items-center justify-center ring-1 ring-black/5"
              style={{ background: c.cor }}
            >
              {value === c.cor && <Check size={14} className="text-white" />}
            </button>
          ))}
        </div>
        {value && (
          <button type="button" onClick={() => onChange("")} className="mt-2 w-full text-xs text-gray-600 hover:text-gray-900 inline-flex items-center justify-center gap-1">
            <X size={12} /> Sem cor
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
