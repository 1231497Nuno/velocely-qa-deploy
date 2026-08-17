import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "./ui/command";

export default function Combobox({
  options,
  value,
  onChange,
  placeholder = "Selecionar...",
  searchPlaceholder = "Pesquisar pelo início do nome...",
  emptyText = "Sem resultados.",
  testid,
  optionTestidPrefix = "option",
  className = "",
  /** Prefixo no label (igual a clientes/fornecedores). Default: true. */
  matchPrefix = true,
}) {
  const [open, setOpen] = useState(false);
  const ordered = [...options].sort((a, b) => Number(!!b.pin) - Number(!!a.pin));
  const selected = ordered.find((o) => o.value === value);

  const filter = matchPrefix
    ? (itemValue, search) => {
        const s = (search || "").trim().toLowerCase();
        if (!s) return 1;
        const label = (itemValue || "").toLowerCase();
        return label.startsWith(s) ? 1 : 0;
      }
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          className={`w-full flex items-center justify-between gap-2 border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black transition-colors ${className}`}
        >
          <span className={selected ? "text-gray-900 truncate" : "text-gray-400 truncate"}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown size={15} className="text-gray-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[240px]" align="start">
        <Command filter={filter}>
          <CommandInput placeholder={searchPlaceholder} data-testid={testid ? `${testid}-search` : undefined} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {ordered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={matchPrefix ? (o.label || "") : `${o.label} ${o.hint || ""}`}
                  data-testid={`${optionTestidPrefix}-${o.value}`}
                  onSelect={() => { onChange(o.value, o); setOpen(false); }}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Check size={15} className={value === o.value ? "opacity-100 shrink-0" : "opacity-0 shrink-0"} />
                    <span className="truncate">{o.label}</span>
                  </span>
                  {o.hint && <span className="text-xs text-gray-500 tabular-nums shrink-0">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
