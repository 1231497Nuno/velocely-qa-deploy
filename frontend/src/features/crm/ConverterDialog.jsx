import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import ClienteSelector from "@/components/ClienteSelector";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { apiError, btnPrimary, btnSecondary, inputCls, labelCls } from "./crmShared";

function novoClienteDoLead(lead) {
  return {
    tipo: lead?.empresa ? "empresa" : "particular",
    nome: lead?.empresa || lead?.nome || "",
    responsavel: lead?.empresa ? lead?.nome || "" : "",
    contacto: lead?.telefone || "",
    email: lead?.email || "",
    nif: "",
    morada: "",
    codigo_postal: "",
    cidade: "",
    pais: "Portugal",
  };
}

/** Converter lead em cliente: associar a um existente ou criar novo com os dados do lead. */
export default function ConverterDialog({ open, onOpenChange, lead, canCreateCliente, onDone }) {
  const [modo, setModo] = useState("novo");
  const [clienteId, setClienteId] = useState("");
  const [form, setForm] = useState(novoClienteDoLead(lead));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setModo(canCreateCliente ? "novo" : "existente");
      setClienteId("");
      setForm(novoClienteDoLead(lead));
    }
  }, [open, lead, canCreateCliente]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (modo === "existente" && !clienteId) {
      toast.error("Escolha o cliente");
      return;
    }
    setBusy(true);
    try {
      const body = modo === "existente" ? { cliente_id: clienteId } : { cliente: form };
      const atualizado = await api.post(`/crm/leads/${lead.id}/converter`, body);
      toast.success(modo === "existente" ? "Lead associado ao cliente" : "Cliente criado");
      onDone(atualizado);
    } catch (e) {
      toast.error(apiError(e, "Não foi possível converter"));
    } finally {
      setBusy(false);
    }
  }

  const empresa = form.tipo === "empresa";
  const tab = (key, label, disabled) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setModo(key)}
      data-testid={`crm-converter-tab-${key}`}
      className={`flex-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors disabled:opacity-40 ${
        modo === key ? "border-black text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="crm-converter-dialog">
        <DialogHeader>
          <DialogTitle>Converter em cliente</DialogTitle>
          <DialogDescription>Associe este lead a um cliente que já existe ou crie um cliente novo.</DialogDescription>
        </DialogHeader>
        <div className="flex border-b border-gray-200">
          {tab("novo", "Novo cliente", !canCreateCliente)}
          {tab("existente", "Cliente existente", false)}
        </div>
        {modo === "existente" ? (
          <div className="py-2">
            <label className={labelCls}>Cliente</label>
            <ClienteSelector value={clienteId} onChange={(id) => setClienteId(id || "")} testid="crm-converter-cliente" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="sm:col-span-2 flex gap-2">
              {["empresa", "particular"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, tipo: t }))}
                  className={`px-3 py-1.5 text-sm rounded-sm border ${form.tipo === t ? "bg-black text-white border-black" : "bg-white border-gray-300"}`}
                >
                  {t === "empresa" ? "Empresa" : "Particular"}
                </button>
              ))}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Nome *</label>
              <input className={inputCls} value={form.nome} onChange={set("nome")} data-testid="crm-converter-nome" />
            </div>
            {empresa && (
              <div className="sm:col-span-2">
                <label className={labelCls}>Pessoa responsável</label>
                <input className={inputCls} value={form.responsavel} onChange={set("responsavel")} />
              </div>
            )}
            <div>
              <label className={labelCls}>NIF {empresa && "*"}</label>
              <input className={inputCls} value={form.nif} onChange={set("nif")} data-testid="crm-converter-nif" />
            </div>
            <div>
              <label className={labelCls}>Telefone {empresa && "*"}</label>
              <input className={inputCls} value={form.contacto} onChange={set("contacto")} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Email {empresa && "*"}</label>
              <input className={inputCls} type="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Morada {empresa && "*"}</label>
              <input className={inputCls} value={form.morada} onChange={set("morada")} />
            </div>
            <div>
              <label className={labelCls}>Código postal {empresa && "*"}</label>
              <input className={inputCls} value={form.codigo_postal} onChange={set("codigo_postal")} placeholder="0000-000" />
            </div>
            <div>
              <label className={labelCls}>Cidade {empresa && "*"}</label>
              <input className={inputCls} value={form.cidade} onChange={set("cidade")} />
            </div>
            {empresa && (
              <p className="sm:col-span-2 text-xs text-gray-500">
                Para empresas o ERP exige NIF, morada, código postal, cidade, telefone e email.
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <button type="button" className={btnSecondary} onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={busy} data-testid="crm-converter-submit">
            {busy ? "A guardar..." : modo === "existente" ? "Associar" : "Criar cliente"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
