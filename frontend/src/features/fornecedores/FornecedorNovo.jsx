import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import NovoRegisto from "@/components/NovoRegisto";
import FornecedorForm, { emptyFornecedor, validarFormFornecedor } from "./FornecedorForm";

const detalhe = (e) => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return typeof d === "string" ? d : null;
};

/** Novo fornecedor: mesma página de criação que artigos e fornecedores; ao guardar abre a ficha. */
export default function FornecedorNovo() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [form, setForm] = useState(emptyFornecedor);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!can("fornecedores", "create")) { toast.error("Sem permissão para criar fornecedores"); nav("/fornecedores"); }
  }, [can, nav]);

  const set = (patch) => { setDirty(true); setForm((f) => ({ ...f, ...patch })); };

  const save = async () => {
    const err = validarFormFornecedor(form);
    if (err) { toast.error(err); return false; }
    setSaving(true);
    try {
      const c = await api.post("/fornecedores", form);
      toast.success("Fornecedor criado");
      setDirty(false);
      setTimeout(() => nav(`/fornecedores/${c.id}`, { replace: true }), 0);
      return true;
    } catch (e) {
      toast.error(detalhe(e) || "Erro ao criar o fornecedor");
      return false;
    } finally { setSaving(false); }
  };
  useUnsavedChanges({ dirty, onSave: save });

  return (
    <NovoRegisto titulo="Novo fornecedor" voltar="/fornecedores" voltarLabel="Voltar aos fornecedores" testid="fornecedor-novo" saving={saving} onGuardar={save}
      subtitulo={form.tipo === "empresa" ? "Empresa: nome, NIF, morada, código postal, cidade, contacto e email obrigatórios." : "Particular: só o nome é obrigatório."}>
      <FornecedorForm form={form} set={set} />
    </NovoRegisto>
  );
}
