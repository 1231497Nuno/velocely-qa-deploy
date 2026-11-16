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
import BotaoAdicionar from "@/components/BotaoAdicionar";
import { useAuth } from "@/context/AuthContext";
import { isDiversosArtigo } from "@/components/LinhaTipoIcon";
import SelecionarVariantesDialog, { artigosParaSelector, artigoTemVariantes } from "./SelecionarVariantesDialog";

/** Pesquisa igual em todo o ERP: ignora acentos e maiúsculas, procura no código, nome, ref. do fornecedor e código de barras. */
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
 * modo="adicionar": botão «+ Adicionar artigos» — escolha múltipla com quantidades
 *   (com onChangeMulti); os artigos com variantes abrem a escolha de variantes.
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
  // Escolha múltipla (modo «adicionar»): id → { artigo, quantidade }
  const [selecao, setSelecao] = useState({});
  const multiplo = modo === "adicionar" && !!onChangeMulti;
  const nSel = Object.keys(selecao).length;

  function alternar(a) {
    setSelecao((sel) => {
      const n = { ...sel };
      if (n[a.id]) delete n[a.id];
      else n[a.id] = { artigo: a, quantidade: 1 };
      return n;
    });
  }

  function confirmarSelecao() {
    const lista = Object.values(selecao).map(({ artigo, quantidade }) => ({
      ...artigo,
      quantidade: Number(quantidade) > 0 ? Number(quantidade) : 1,
    }));
    if (!lista.length) return;
    setSelecao({});
    setOpen(false);
    onChangeMulti(lista);
  }

  const list = useMemo(() => artigosParaSelector(artigos || []), [artigos]);
  const diversos = useMemo(() => list.filter(isDiversosArtigo), [list]);
  const normais = useMemo(() => list.filter((a) => !isDiversosArtigo(a)), [list]);
  const selected = (artigos || []).find((a) => a.id === value);
  const podeCriar = permitirCriar && can("artigos", "create");

  function escolher(a) {
    if (artigoTemVariantes(a)) {
      setOpen(false);
      setVariantesPick(a);
      return;
    }
    if (multiplo) {
      alternar(a);
      return;
    }
    setOpen(false);
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
      if (multiplo) {
        setSelecao((sel) => ({ ...sel, [a.id]: { artigo: a, quantidade: 1 } }));
        setOpen(true);
      } else {
        onChange(a);
      }
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
      value={`${a.codigo || ""}|||${a.nome || ""}|||${a.cod_fornecedor || ""}|||${a.codigo_produto || ""}|||${a.id}`}
      data-testid={`${testid}-option-${a.id}`}
      onSelect={() => escolher(a)}
      className="flex items-center gap-2"
    >
      {multiplo ? (
        <span className={`w-4 h-4 shrink-0 rounded-sm border flex items-center justify-center ${selecao[a.id] ? "bg-brand border-brand text-brand-fg" : "border-gray-300 bg-white"}`}>
          {selecao[a.id] && <Check size={11} />}
        </span>
      ) : (
        <Check size={14} className={value === a.id ? "opacity-100 shrink-0" : "opacity-0 shrink-0"} />
      )}
      <span className="tabular-nums text-xs text-gray-500 w-16 shrink-0">{a.codigo}</span>
      <span className="truncate flex-1">
        {a.nome}
        {a.tem_variantes && !a.pai_id && <span className="ml-1 text-[10px] font-medium text-violet-600">variantes</span>}
        {a.cod_fornecedor && <span className="ml-1.5 text-[10px] text-gray-400 font-mono">ref. {a.cod_fornecedor}</span>}
      </span>
      <span className="text-xs text-gray-400 tabular-nums shrink-0">{eur(preco(a))}</span>
    </CommandItem>
  );

  return (
    <>
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          {modo === "adicionar" ? (
            <BotaoAdicionar disabled={disabled} testid={testid}>
              {placeholder === "Escolher artigo..." ? (multiplo ? "Adicionar artigos" : "Adicionar artigo") : placeholder}
            </BotaoAdicionar>
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
          {multiplo && nSel > 0 && (
            <div className="border-t border-gray-200 p-2 space-y-1.5 bg-gray-50" data-testid={`${testid}-selecao`}>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {Object.values(selecao).map(({ artigo, quantidade }) => (
                  <div key={artigo.id} className="flex items-center gap-2 text-sm">
                    <span className="truncate flex-1">{artigo.nome}</span>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      value={quantidade}
                      onChange={(e) => setSelecao((sel) => ({ ...sel, [artigo.id]: { artigo, quantidade: e.target.value } }))}
                      className="w-16 border border-gray-300 rounded-sm px-1.5 py-0.5 text-right tabular-nums text-sm bg-white"
                      title="Quantidade"
                    />
                    <button type="button" onClick={() => alternar(artigo)} className="text-gray-400 hover:text-red-600 text-xs" title="Tirar">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button type="button" onClick={() => setSelecao({})} className="text-xs text-gray-600 hover:text-gray-900">Limpar</button>
                <button
                  type="button"
                  onClick={confirmarSelecao}
                  className="btn btn-primario"
                  data-testid={`${testid}-confirmar`}
                >
                  Adicionar {nSel} {nSel === 1 ? "artigo" : "artigos"}
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <SelecionarVariantesDialog
        open={!!variantesPick}
        onOpenChange={(o) => { if (!o) setVariantesPick(null); }}
        paiId={variantesPick?.id}
        paiNome={variantesPick?.nome || ""}
        onConfirm={(picked) => {
          setVariantesPick(null);
          if (multiplo) {
            // as variantes entram na seleção (com a quantidade escolhida) e o seletor volta a abrir
            setSelecao((sel) => {
              const n = { ...sel };
              picked.forEach((p) => { n[p.id] = { artigo: p, quantidade: p.quantidade || 1 }; });
              return n;
            });
            setOpen(true);
            return;
          }
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
            <button type="button" disabled={creating} onClick={criar} className="btn btn-primario" data-testid={`${testid}-create-save`}>
              {creating ? "A criar..." : "Criar e escolher"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
