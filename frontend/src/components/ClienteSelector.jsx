import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import Combobox from "./Combobox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";

const emptyCliente = { nome: "", morada: "", codigo_postal: "", cidade: "", pais: "Portugal", contacto: "", email: "", nif: "", notas: "" };

const Field = ({ label, tid, value, onChange }) => (
  <div>
    <label className="text-sm font-medium text-gray-700 mb-1.5 block">{label}</label>
    <input data-testid={tid} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
  </div>
);

export default function ClienteSelector({ value, onChange, testid = "cliente-select", canCreate = true }) {
  const [clientes, setClientes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyCliente);

  const load = async () => setClientes(await api.get("/clientes"));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    try {
      const c = await api.post("/clientes", form);
      await load();
      onChange(c.id, c.nome);
      setOpen(false);
      setForm(emptyCliente);
      toast.success("Cliente criado");
    } catch (e) { toast.error(e?.response?.data?.detail || "Erro ao criar cliente"); }
  };

  const options = clientes.map((c) => ({ value: c.id, label: c.nome, hint: c.cidade || c.nif || "" }));

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <Combobox
          options={options}
          value={value || ""}
          onChange={(id) => { const c = clientes.find((x) => x.id === id); onChange(id, c ? c.nome : ""); }}
          placeholder="— Selecionar cliente —"
          searchPlaceholder="Pesquisar cliente..."
          emptyText="Nenhum cliente encontrado."
          testid={testid}
          optionTestidPrefix="cliente-option"
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
            <DialogDescription>Crie um cliente para associar ao registo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Field label="Nome" tid="novo-cliente-nome" value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Contacto" tid="novo-cliente-contacto" value={form.contacto} onChange={(v) => setForm({ ...form, contacto: v })} />
              <Field label="Email" tid="novo-cliente-email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </div>
            <Field label="Morada" tid="novo-cliente-morada" value={form.morada} onChange={(v) => setForm({ ...form, morada: v })} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Código Postal" tid="novo-cliente-cp" value={form.codigo_postal} onChange={(v) => setForm({ ...form, codigo_postal: v })} />
              <Field label="Cidade" tid="novo-cliente-cidade" value={form.cidade} onChange={(v) => setForm({ ...form, cidade: v })} />
              <Field label="País" tid="novo-cliente-pais" value={form.pais} onChange={(v) => setForm({ ...form, pais: v })} />
            </div>
            <Field label="NIF" tid="novo-cliente-nif" value={form.nif} onChange={(v) => setForm({ ...form, nif: v })} />
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
