import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { eur } from "../lib/api";

export default function ArtigoCombobox({ artigos, value, onChange, testid }) {
  const [open, setOpen] = useState(false);
  const selected = artigos.find((a) => a.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black transition-colors"
        >
          <span className={selected ? "text-gray-900 truncate" : "text-gray-400"}>
            {selected ? selected.nome : "Pesquisar artigo..."}
          </span>
          <ChevronsUpDown size={15} className="text-gray-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
        <Command>
          <CommandInput placeholder="Escrever para pesquisar..." data-testid="artigo-search-input" />
          <CommandList>
            <CommandEmpty>Nenhum artigo encontrado.</CommandEmpty>
            <CommandGroup>
              {artigos.map((a) => (
                <CommandItem
                  key={a.id}
                  value={a.nome}
                  data-testid={`artigo-option-${a.id}`}
                  onSelect={() => {
                    onChange(a);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <Check
                      size={15}
                      className={value === a.id ? "opacity-100" : "opacity-0"}
                    />
                    {a.nome}
                  </span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {eur(a.preco_venda)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
