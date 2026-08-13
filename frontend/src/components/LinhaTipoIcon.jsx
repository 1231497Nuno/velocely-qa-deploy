/** Ícone de tipo de linha — só UI (não vai para PDF). */
const META = {
  produto: { letter: "P", title: "Produto", className: "bg-teal-600 text-white" },
  servico: { letter: "S", title: "Serviço", className: "bg-sky-600 text-white" },
  descritor: { letter: "D", title: "Descritor", className: "bg-amber-600 text-white" },
};

export default function LinhaTipoIcon({ tipo, size = 22, className = "" }) {
  const m = META[tipo] || { letter: "T", title: "Tipo", className: "bg-gray-400 text-white" };
  const px = typeof size === "number" ? `${size}px` : size;
  return (
    <span
      title={m.title}
      aria-label={m.title}
      className={`inline-flex items-center justify-center rounded-full text-[10px] font-bold leading-none shrink-0 select-none ${m.className} ${className}`}
      style={{ width: px, height: px }}
    >
      {m.letter}
    </span>
  );
}

export function isDiversosArtigo(a) {
  if (!a) return false;
  if (a.diversos) return true;
  const cod = (a.codigo || "").trim();
  return /^DIV[-_]/i.test(cod);
}

/** Opções do dropdown de tipo (vazio = todos). */
export const TIPO_LINHA_OPTS = [
  { v: "", l: "Produtos e Serviços" },
  { v: "produto", l: "Produto" },
  { v: "servico", l: "Serviço" },
  { v: "descritor", l: "Descritor" },
];
