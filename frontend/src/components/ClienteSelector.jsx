import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import Combobox from "./Combobox";
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

export default function ClienteSelector({ value, onChange, testid = "cliente-select", canCreate = true }) {
  const [clientes, setClientes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyCliente);

  const load = async () => {
    try {
      // Sem page → lista completa (selectors); page_size>100 dá 422 na API
      const data = await api.get("/clientes");
      setClientes(Array.isArray(data) ? data : (data.items || []));
    } catch (e) {
      console.error("Falha ao carregar clientes", e);
      setClientes([]);
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const err = validarFormCliente(form);
    if (err) return toast.error(err);
    try {
      const c = await api.post("/clientes", form);
      await load();
      onChange(c.id, c.nome, c);
      setOpen(false);
      setForm(emptyCliente);
      toast.success("Cliente criado");
    } catch (e) { toast.error(apiDetail(e) || "Erro ao criar cliente"); }
  };

  const options = clientes.map((c) => ({ value: c.id, label: c.nome, hint: c.cidade || c.nif || "" }));

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <Combobox
          options={options}
          value={value || ""}
          onChange={(id) => { const c = clientes.find((x) => x.id === id); onChange(id, c ? c.nome : "", c || null); }}
          placeholder="— Selecionar cliente —"
          searchPlaceholder="Pesquisar cliente..."
          emptyText="Nenhum cliente encontrado."
          testid={testid}
          optionTestidPrefix="cliente-option"
          matchPrefix
        />
      </div>
      {canCreate && (
        <button type="button" data-testid="cliente-novo-btn" onClick={() => { setForm(emptyCliente); setOpen(true); }} title="Novo cliente" className="shrink-0 border border-gray-300 rounded-sm px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
          <UserPlus size={15} /> Novo
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Novo Cliente</DialogTitle>
            <DialogDescription>Empresa exige NIF; particular pode ficar sem NIF.</DialogDescription>
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
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-novo-cliente" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Criar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
