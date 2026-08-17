import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "./ui/command";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";

const emptyCliente = {
  nome: "",
  tipo: "empresa",
  morada: "",
  codigo_postal: "",
  cidade: "",
  pais: "Portugal",
  contacto: "",
  email: "",
  nif: "",
  notas: "",
};

const Field = ({ label, tid, value, onChange, placeholder = "", required = false }) => (
  <div>
    <label className="text-sm font-medium text-gray-700 mb-1.5 block">
      {label}{required ? <span className="text-red-600"> *</span> : null}
    </label>
    <input data-testid={tid} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
  </div>
);

function apiDetail(e) {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return typeof d === "string" ? d : null;
}

function validarFormCliente(form) {
  if (!form.nome.trim()) return "Nome obrigatório";
  if (form.tipo !== "empresa") return null;
  const faltam = [];
  if (!form.nif.trim()) faltam.push("NIF");
  if (!form.morada.trim()) faltam.push("morada");
  if (!form.codigo_postal.trim()) faltam.push("código postal");
  if (!form.cidade.trim()) faltam.push("cidade");
  if (!form.contacto.trim()) faltam.push("contacto");
  if (!form.email.trim()) faltam.push("email");
  if (faltam.length) return "Para empresas são obrigatórios: " + faltam.join(", ");
  return null;
}

function clienteLabel(c) {
  if (!c) return "";
  const codigo = (c.codigo || "").trim();
  const nome = (c.nome || "").trim();
  return codigo && nome ? `${codigo}  ${nome}` : (nome || codigo);
}

function ClienteRow({ c, selected }) {
  return (
    <span className="flex items-center gap-2 min-w-0 w-full">
      <Check size={15} className={selected ? "opacity-100 shrink-0" : "opacity-0 shrink-0"} />
      {c.codigo ? <span className="tabular-nums text-xs text-gray-500 w-[4.5rem] shrink-0">{c.codigo}</span> : null}
      <span className="truncate">{c.nome}</span>
    </span>
  );
}

export default function ClienteSelector({ value, onChange, testid = "cliente-select", canCreate = true }) {
  const [clientes, setClientes] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyCliente);

  const load = async () => {
    try {
      const [all, defs] = await Promise.all([
        api.get("/clientes"),
        api.get("/clientes/defaults").catch(() => []),
      ]);
      const list = Array.isArray(all) ? all : (all.items || []);
      const defaults = Array.isArray(defs) ? defs : (defs.items || []);
      const defIds = new Set(defaults.map((c) => c.id));
      setClientes([
        ...defaults.map((c) => ({ ...c, is_default: true })),
        ...list.filter((c) => !defIds.has(c.id)),
      ]);
    } catch (e) {
      console.error("Falha ao carregar clientes", e);
      setClientes([]);
    }
  };
  useEffect(() => { load(); }, []);

  const defaults = useMemo(
    () => clientes.filter((c) => c.sistema || c.is_default),
    [clientes],
  );
  const others = useMemo(
    () => clientes.filter((c) => !(c.sistema || c.is_default)),
    [clientes],
  );
  const selected = clientes.find((c) => c.id === value);

  const pick = (c) => {
    if (!c) return;
    onChange(c.id, c.nome, c);
    setListOpen(false);
  };

  const openCreate = () => {
    setForm(emptyCliente);
    setListOpen(false);
    setFormOpen(true);
  };

  const create = async () => {
    const err = validarFormCliente(form);
    if (err) return toast.error(err);
    try {
      const c = await api.post("/clientes", form);
      await load();
      onChange(c.id, c.nome, c);
      setFormOpen(false);
      setForm(emptyCliente);
      toast.success("Cliente criado e associado");
    } catch (e) { toast.error(apiDetail(e) || "Erro ao criar cliente"); }
  };

  const filter = (itemValue, search) => {
    const s = (search || "").trim().toLowerCase();
    if (!s) return 1;
    return (itemValue || "").toLowerCase().includes(s) ? 1 : 0;
  };

  return (
    <>
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={testid}
            className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black transition-colors"
          >
            <span className={selected ? "text-gray-900 truncate" : "text-gray-400 truncate"}>
              {selected ? clienteLabel(selected) : "— Selecionar cliente —"}
            </span>
            <ChevronsUpDown size={15} className="text-gray-400 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
          <Command filter={filter}>
            <CommandInput placeholder="Pesquisar por nome ou código..." data-testid={testid ? `${testid}-search` : undefined} />
            <CommandList>
              <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
              {defaults.length > 0 && (
                <CommandGroup heading="Default">
                  {defaults.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.codigo || ""} ${c.nome || ""}`}
                      data-testid={`cliente-option-${c.id}`}
                      onSelect={() => pick(c)}
                    >
                      <ClienteRow c={c} selected={value === c.id} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {defaults.length > 0 && others.length > 0 && <CommandSeparator />}
              {others.length > 0 && (
                <CommandGroup heading={defaults.length > 0 ? "Clientes" : undefined}>
                  {others.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.codigo || ""} ${c.nome || ""}`}
                      data-testid={`cliente-option-${c.id}`}
                      onSelect={() => pick(c)}
                    >
                      <ClienteRow c={c} selected={value === c.id} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          {canCreate && (
            <div className="border-t border-gray-200">
              <button
                type="button"
                data-testid="cliente-novo-btn"
                onClick={openCreate}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
              >
                <UserPlus size={15} className="shrink-0" /> Novo cliente
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Novo Cliente</DialogTitle>
            <DialogDescription>Fica associado a este documento sem sair da página.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Tipo</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "empresa", label: "Empresa" },
                  { value: "particular", label: "Particular" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`novo-cliente-tipo-${opt.value}`}
                    onClick={() => setForm({ ...form, tipo: opt.value })}
                    className={`rounded-sm px-3 py-2 text-sm font-medium border transition-colors ${
                      form.tipo === opt.value
                        ? "bg-black text-white border-black"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Nome" tid="novo-cliente-nome" value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} required />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Contacto" tid="novo-cliente-contacto" value={form.contacto} onChange={(v) => setForm({ ...form, contacto: v })} required={form.tipo === "empresa"} />
              <Field label="Email" tid="novo-cliente-email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required={form.tipo === "empresa"} />
            </div>
            <Field label="Morada" tid="novo-cliente-morada" value={form.morada} onChange={(v) => setForm({ ...form, morada: v })} required={form.tipo === "empresa"} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Código Postal" tid="novo-cliente-cp" value={form.codigo_postal} onChange={(v) => setForm({ ...form, codigo_postal: v })} required={form.tipo === "empresa"} />
              <Field label="Cidade" tid="novo-cliente-cidade" value={form.cidade} onChange={(v) => setForm({ ...form, cidade: v })} required={form.tipo === "empresa"} />
              <Field label="País" tid="novo-cliente-pais" value={form.pais} onChange={(v) => setForm({ ...form, pais: v })} />
            </div>
            <Field
              label={form.tipo === "empresa" ? "NIF" : "NIF (opcional)"}
              tid="novo-cliente-nif"
              value={form.nif}
              onChange={(v) => setForm({ ...form, nif: v })}
              placeholder={form.tipo === "particular" ? "Deixar vazio = sem NIF" : ""}
              required={form.tipo === "empresa"}
            />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setFormOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button type="button" data-testid="save-novo-cliente" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Criar e associar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
