import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";

const emptyCliente = { nome: "", morada: "", contacto: "", email: "", nif: "", notas: "" };

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

  return (
    <div className="flex items-center gap-2">
      <select
        data-testid={testid}
        value={value || ""}
        onChange={(e) => {
          const c = clientes.find((x) => x.id === e.target.value);
          onChange(e.target.value, c ? c.nome : "");
        }}
        className="flex-1 border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
      >
        <option value="">— Selecionar cliente —</option>
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
      </select>
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
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nome</label>
              <input data-testid="novo-cliente-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Contacto</label>
                <input data-testid="novo-cliente-contacto" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Email</label>
                <input data-testid="novo-cliente-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Morada</label>
                <input data-testid="novo-cliente-morada" value={form.morada} onChange={(e) => setForm({ ...form, morada: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">NIF</label>
                <input data-testid="novo-cliente-nif" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
              </div>
            </div>
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
