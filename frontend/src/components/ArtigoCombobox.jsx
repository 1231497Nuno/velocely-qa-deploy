import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { isDiversosArtigo } from "@/components/LinhaTipoIcon";
import SelecionarVariantesDialog, { artigosParaSelector, artigoTemVariantes } from "./SelecionarVariantesDialog";

/** Pesquisa igual em todo o ERP: ignora acentos e maiúsculas, procura no código e no nome. */
export function filtroArtigo(itemValue, search) {
  const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const s = fold(search).trim();
  if (!s) return 1;
  return fold(itemValue).includes(s) ? 1 : 0;
}

/**
 * Seletor de artigos único — usado em Encomendas, Ordens de Fabrico,
 * Ordens de Compra e Pedidos de Cotação (os Orçamentos usam a mesma pesquisa).
 *
 * modo="selecionar": mostra o artigo escolhido (linha existente).
 * modo="adicionar": botão «+ Adicionar artigo» (acrescenta linhas).
 * onChange(artigo) · onChangeMulti([{ id, nome, quantidade, … }]) para variantes.
 * preco: (artigo) => número a mostrar ao lado (por defeito o preço de venda).
 */
export default function ArtigoCombobox({
  artigos,
  value,
  onChange,
  onChangeMulti,
  onArtigosRefresh,
  testid = "artigo-picker",
  placeholder = "Escolher artigo...",
  modo = "selecionar",
  preco = (a) => Number(a.preco_venda) || 0,
  permitirCriar = true,
  disabled = false,
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [variantesPick, setVariantesPick] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createNome, setCreateNome] = useState("");
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => artigosParaSelector(artigos || []), [artigos]);
  const diversos = useMemo(() => list.filter(isDiversosArtigo), [list]);
  const normais = useMemo(() => list.filter((a) => !isDiversosArtigo(a)), [list]);
  const selected = (artigos || []).find((a) => a.id === value);
  const podeCriar = permitirCriar && can("artigos", "create");

  function escolher(a) {
    setOpen(false);
    if (artigoTemVariantes(a)) {
      setVariantesPick(a);
      return;
    }
    onChange(a);
  }

  async function criar() {
    const nome = createNome.trim();
    if (!nome) {
      toast.error("Indique o nome");
      return;
    }
    setCreating(true);
    try {
      const a = await api.post("/artigos", {
        nome, descricao: "", unidade: "un", custo_artigo: 0, margem: 30, ativo: true, materiais: [], roteiro: [],
      });
      if (onArtigosRefresh) await onArtigosRefresh();
      setCreateOpen(false);
      onChange(a);
      toast.success("Artigo criado no catálogo");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível criar o artigo");
    } finally {
      setCreating(false);
    }
  }

  const item = (a, extra = {}) => (
    <CommandItem
      key={`${extra.prefix || ""}${a.id}`}
      value={`${a.codigo || ""}|||${a.nome || ""}`}
      data-testid={`${testid}-option-${a.id}`}
      onSelect={() => escolher(a)}
      className="flex items-center gap-2"
    >
      <Check size={14} className={value === a.id ? "opacity-100 shrink-0" : "opacity-0 shrink-0"} />
      <span className="tabular-nums text-xs text-gray-500 w-16 shrink-0">{a.codigo}</span>
      <span className="truncate flex-1">
        {a.nome}
        {a.tem_variantes && !a.pai_id && <span className="ml-1 text-[10px] font-medium text-violet-600">variantes</span>}
      </span>
      <span className="text-xs text-gray-400 tabular-nums shrink-0">{eur(preco(a))}</span>
    </CommandItem>
  );

  return (
    <>
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          {modo === "adicionar" ? (
            <button
              type="button"
              disabled={disabled}
              data-testid={testid}
              className="inline-flex items-center gap-1.5 border border-dashed border-gray-400 hover:border-gray-700 rounded-sm px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 bg-white disabled:opacity-50"
            >
              <Plus size={14} /> {placeholder === "Escolher artigo..." ? "Adicionar artigo" : placeholder}
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              data-testid={testid}
              className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors disabled:bg-gray-50"
            >
              <span className={`truncate ${selected ? "text-gray-900" : "text-gray-400"}`}>
                {selected ? (
                  <>
                    {selected.codigo && <span className="tabular-nums text-xs text-gray-500 mr-1.5">{selected.codigo}</span>}
                    {selected.nome}
                  </>
                ) : placeholder}
              </span>
              <ChevronsUpDown size={15} className="text-gray-400 shrink-0" />
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[min(100vw-2rem,26rem)]" align="start">
          <Command filter={filtroArtigo}>
            <CommandInput placeholder="Código ou nome do artigo..." data-testid={`${testid}-search`} />
            <CommandList>
              <CommandEmpty>Nenhum artigo encontrado.</CommandEmpty>
              {diversos.length > 0 && (
                <CommandGroup heading="Diversos">
                  {diversos.map((a) => item(a, { prefix: "div-" }))}
                </CommandGroup>
              )}
              {diversos.length > 0 && <CommandSeparator />}
              <CommandGroup heading="Artigos">
                {normais.map((a) => item(a))}
              </CommandGroup>
              {podeCriar && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="criar artigo novo"
                      data-testid={`${testid}-criar`}
                      onSelect={() => { setCreateNome(""); setCreateOpen(true); setOpen(false); }}
                    >
                      <Plus size={14} className="shrink-0" /> Criar artigo novo
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <SelecionarVariantesDialog
        open={!!variantesPick}
        onOpenChange={(o) => { if (!o) setVariantesPick(null); }}
        paiId={variantesPick?.id}
        paiNome={variantesPick?.nome || ""}
        onConfirm={(picked) => {
          setVariantesPick(null);
          if (onChangeMulti) {
            onChangeMulti(picked);
            return;
          }
          if (picked[0]) onChange(picked[0]);
        }}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Novo artigo</DialogTitle>
            <DialogDescription>Fica no catálogo e é escolhido nesta linha. Os restantes dados completam-se depois na ficha do artigo.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
            <input
              autoFocus
              data-testid={`${testid}-create-nome`}
              value={createNome}
              onChange={(e) => setCreateNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-sm hover:bg-gray-50">Cancelar</button>
            <button type="button" disabled={creating} onClick={criar} className="px-4 py-2 text-sm bg-brand text-brand-fg rounded-sm hover:bg-brand-hover disabled:opacity-50" data-testid={`${testid}-create-save`}>
              {creating ? "A criar..." : "Criar e escolher"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
