import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { api, eur } from "../lib/api";
import { toast } from "sonner";
import LinhaTipoIcon, { TIPO_LINHA_OPTS, isDiversosArtigo } from "./LinhaTipoIcon";

const inputCls =
  "w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";

/** Dropdown de tipo (ícone T/P/S/D). */
export function LinhaTipoSelect({ value, onChange, testid = "linha-tipo" }) {
  const [open, setOpen] = useState(false);
  const tipo = value || "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          title={TIPO_LINHA_OPTS.find((o) => o.v === tipo)?.l || "Tipo"}
          className="flex items-center gap-0.5 border border-gray-300 rounded-sm px-1.5 py-1.5 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/20"
        >
          <LinhaTipoIcon tipo={tipo || undefined} size={20} />
          <ChevronDown size={12} className="text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-52" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {TIPO_LINHA_OPTS.map((opt) => (
                <CommandItem
                  key={opt.v || "all"}
                  value={opt.l}
                  data-testid={`${testid}-${opt.v || "all"}`}
                  onSelect={() => {
                    onChange(opt.v);
                    setOpen(false);
                  }}
                  className={tipo === opt.v ? "bg-teal-600 text-white aria-selected:bg-teal-600 aria-selected:text-white" : ""}
                >
                  <span className="flex items-center gap-2">
                    <LinhaTipoIcon tipo={opt.v || undefined} size={18} />
                    {opt.l}
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

/** Combobox de código (filtrado pelo tipo da linha). */
export function LinhaCodigoSelect({
  artigos,
  linha,
  onPick,
  onArtigosRefresh,
  testid = "linha-codigo",
}) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createNome, setCreateNome] = useState("");
  const [creating, setCreating] = useState(false);

  const tipo = linha.tipo_linha || "";
  const isDescritor = tipo === "descritor";
  const selected = artigos.find((a) => a.id === linha.artigo_id);
  const codigo = linha.artigo_codigo || selected?.codigo || "";
  const diversos = useMemo(() => artigos.filter(isDiversosArtigo), [artigos]);

  const filter = (itemValue, search) => {
    const s = (search || "").trim().toLowerCase();
    if (!s) return 1;
    return itemValue.toLowerCase().includes(s) ? 1 : 0;
  };

  const pick = (a, opts = {}) => {
    onPick(a, opts);
    setOpen(false);
  };

  const createArtigo = async () => {
    const nome = createNome.trim();
    if (!nome) return toast.error("Indique o nome");
    setCreating(true);
    try {
      const a = await api.post("/artigos", {
        nome,
        descricao: "",
        unidade: "un",
        custo_artigo: 0,
        margem: 30,
        ativo: true,
        materiais: [],
        roteiro: [],
      });
      if (onArtigosRefresh) await onArtigosRefresh();
      pick(a);
      setCreateOpen(false);
      toast.success(tipo === "servico" ? "Serviço criado" : "Artigo criado");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Erro ao criar");
    } finally {
      setCreating(false);
    }
  };

  if (isDescritor) {
    return (
      <input
        disabled
        value=""
        placeholder="—"
        className={`${inputCls} text-gray-400 bg-gray-50`}
        data-testid={testid}
      />
    );
  }

  const heading =
    tipo === "servico" ? "Serviços" : tipo === "produto" ? "Produtos" : "Produtos e serviços";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={testid}
            className={`${inputCls} flex items-center justify-between gap-1 text-left`}
          >
            <span className={`truncate tabular-nums ${codigo ? "text-gray-900" : "text-gray-400"}`}>
              {codigo || "Cod."}
            </span>
            <ChevronDown size={12} className="text-gray-400 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[min(100vw-2rem,22rem)]" align="start">
          <Command filter={filter}>
            <CommandInput
              placeholder={tipo ? `Pesquisar ${tipo === "servico" ? "serviço" : "produto"}…` : "Código ou nome…"}
              data-testid={`${testid}-search`}
            />
            <CommandList>
              <CommandEmpty>Nenhum resultado.</CommandEmpty>
              {diversos.length > 0 && (
                <CommandGroup heading="Diversos (editar descrição)">
                  {diversos.map((a) => (
                    <CommandItem
                      key={`div-${a.id}`}
                      value={`${a.codigo || ""}|||${a.nome || ""}`}
                      data-testid={`${testid}-diversos-${a.id}`}
                      onSelect={() => pick(a, { descricao_livre: true, clear_nome: true })}
                    >
                      <span className="tabular-nums text-xs text-gray-500 w-16 shrink-0">{a.codigo}</span>
                      <span className="truncate">{a.nome}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup heading={heading}>
                {artigos.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.codigo || ""}|||${a.nome || ""}`}
                    data-testid={`${testid}-option-${a.id}`}
                    onSelect={() => pick(a)}
                    className="flex items-center gap-2"
                  >
                    <Check size={14} className={linha.artigo_id === a.id ? "opacity-100 shrink-0" : "opacity-0 shrink-0"} />
                    <span className="tabular-nums text-xs text-gray-500 w-16 shrink-0">{a.codigo}</span>
                    <span className="truncate flex-1">{a.nome}</span>
                    <span className="text-xs text-gray-400 tabular-nums shrink-0">{eur(a.preco_venda)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="criar novo"
                  data-testid={`${testid}-criar`}
                  onSelect={() => {
                    setCreateNome("");
                    setCreateOpen(true);
                    setOpen(false);
                  }}
                >
                  <Plus size={14} className="shrink-0" />
                  {tipo === "servico" ? "Criar serviço novo" : "Criar artigo novo"}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              {tipo === "servico" ? "Novo serviço" : "Novo artigo"}
            </DialogTitle>
            <DialogDescription>Cria no catálogo e associa à linha.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
            <input
              data-testid={`${testid}-create-nome`}
              autoFocus
              value={createNome}
              onChange={(e) => setCreateNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createArtigo()}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
              placeholder="Nome…"
            />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              data-testid={`${testid}-create-save`}
              disabled={creating}
              onClick={createArtigo}
              className="px-3 py-2 text-sm bg-black text-white rounded-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {creating ? "A criar…" : "Criar e selecionar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LinhaDescricaoInput({ value, onChange, codigo, showRef, testid = "linha-descricao" }) {
  return (
    <div className="min-w-0">
      <input
        data-testid={testid}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Descrição"
        className={inputCls}
      />
      {showRef && codigo && (
        <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">Ref. {codigo}</p>
      )}
    </div>
  );
}
