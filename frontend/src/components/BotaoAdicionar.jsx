import { Children, Fragment, forwardRef, isValidElement, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, ChevronDown } from "lucide-react";

/**
 * Ações de «adicionar» dentro das fichas (linhas, artigos, materiais, operações,
 * personalizações, medidas, contactos…) — o mesmo aspeto em todo o ERP:
 * contorno tracejado na cor da marca, círculo «+» cheio e texto explícito.
 *
 *   <BotaoAdicionar onClick={…}>Adicionar operação</BotaoAdicionar>
 *   <SelectAdicionar label="Adicionar material" onChange={(id) => …}>…<option/>…</SelectAdicionar>
 *
 * tamanho: "md" (por defeito, ações principais da secção) | "sm" (dentro de uma linha)
 * largo: ocupa a largura toda (fim de listas/tabelas)
 */
const BASE =
  "group inline-flex items-center justify-center gap-2 rounded-sm border border-dashed border-brand/50 bg-brand-soft/60 text-brand font-semibold " +
  "hover:border-brand hover:bg-brand-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const TAMANHOS = {
  md: { btn: "px-3.5 py-2 text-sm min-h-10", circ: "w-5 h-5", icon: 14 },
  sm: { btn: "px-2.5 py-1 text-xs min-h-8", circ: "w-4 h-4", icon: 11 },
};

export function CirculoMais({ tamanho = "md" }) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  return (
    <span className={`${t.circ} shrink-0 rounded-full bg-brand text-brand-fg flex items-center justify-center`}>
      <Plus size={t.icon} strokeWidth={3} />
    </span>
  );
}

const BotaoAdicionar = forwardRef(function BotaoAdicionar(
  { children, tamanho = "md", largo = false, className = "", testid, type = "button", ...props },
  ref,
) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  return (
    <button
      ref={ref}
      type={type}
      data-testid={testid}
      className={`${BASE} ${t.btn} ${largo ? "w-full" : ""} ${className}`}
      {...props}
    >
      <CirculoMais tamanho={tamanho} />
      <span className="truncate">{children}</span>
    </button>
  );
});

export default BotaoAdicionar;

function textoDe(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textoDe).join("");
  if (isValidElement(node)) return textoDe(node.props.children);
  return "";
}

function opcoesDe(children) {
  const out = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === Fragment) { out.push(...opcoesDe(c.props.children)); return; }
    if (c.type === "option" && c.props.value !== "" && c.props.value != null) {
      out.push({ value: String(c.props.value), label: textoDe(c.props.children), disabled: !!c.props.disabled });
    }
  });
  return out;
}

const fold = (x) => String(x || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Botão «adicionar» com lista e pesquisa (escrever para filtrar por nome ou código).
 * Recebe as opções como <option> (mesma API de antes).
 */
export function SelectAdicionar({ label, onChange, children, tamanho = "md", largo = false, testid, disabled, className = "" }) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  const [open, setOpen] = useState(false);
  const opcoes = opcoesDe(children);
  return (
    <Popover open={disabled ? false : open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testid} disabled={disabled} aria-label={label}
          className={`${BASE} ${t.btn} ${largo ? "w-full" : ""} ${className}`}>
          <CirculoMais tamanho={tamanho} />
          <span className="truncate">{label}</span>
          <ChevronDown size={tamanho === "sm" ? 12 : 14} className="shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[min(28rem,90vw)]" align="start">
        <Command filter={(v, q) => (fold(v).includes(fold(q).trim()) ? 1 : 0)}>
          <CommandInput placeholder="Pesquisar…" data-testid={testid ? `${testid}-search` : undefined} />
          <CommandList>
            <CommandEmpty>Sem resultados.</CommandEmpty>
            <CommandGroup>
              {opcoes.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.value}`} disabled={o.disabled}
                  data-testid={testid ? `${testid}-opt-${o.value}` : undefined}
                  onSelect={() => { setOpen(false); onChange(o.value); }}>
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
