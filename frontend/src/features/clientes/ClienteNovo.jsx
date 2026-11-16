import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import NovoRegisto from "@/components/NovoRegisto";
import ClienteForm, { emptyCliente, validarFormCliente, clientePayload } from "./ClienteForm";

const detalhe = (e) => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return typeof d === "string" ? d : null;
};

/** Novo cliente: mesma página de criação que artigos e fornecedores; ao guardar abre a ficha. */
export default function ClienteNovo() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [form, setForm] = useState(emptyCliente);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!can("clientes", "create")) { toast.error("Sem permissão para criar clientes"); nav("/clientes"); }
  }, [can, nav]);

  const set = (patch) => { setDirty(true); setForm((f) => ({ ...f, ...patch })); };

  const save = async () => {
    const err = validarFormCliente(form);
    if (err) { toast.error(err); return false; }
    setSaving(true);
    try {
      const c = await api.post("/clientes", clientePayload(form));
      toast.success("Cliente criado");
      setDirty(false);
      setTimeout(() => nav(`/clientes/${c.id}`, { replace: true }), 0);
      return true;
    } catch (e) {
      toast.error(detalhe(e) || "Erro ao criar o cliente");
      return false;
    } finally { setSaving(false); }
  };
  useUnsavedChanges({ dirty, onSave: save });

  return (
    <NovoRegisto titulo="Novo cliente" voltar="/clientes" voltarLabel="Voltar aos clientes" testid="cliente-novo" saving={saving} onGuardar={save}
      subtitulo={form.tipo === "empresa" ? "Empresa: nome, NIF, morada, código postal, cidade, contacto e email obrigatórios." : "Particular: só o nome é obrigatório."}>
      <ClienteForm form={form} set={set} />
    </NovoRegisto>
  );
}
