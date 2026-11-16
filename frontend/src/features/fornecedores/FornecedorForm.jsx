import BlocosShell, { FieldGrid, FieldRow } from "@/components/BlocosShell";
import CamposPersonalizados from "@/components/CamposPersonalizados";
import UtilizadorSelect from "@/components/UtilizadorSelect";

export const emptyFornecedor = {
  nome: "", tipo: "empresa", morada: "", codigo_postal: "", cidade: "", pais: "Portugal",
  contacto: "", email: "", nif: "", website: "", categoria: "", notas: "", responsavel: "",
  campos_extra: {},
};

const FORM_BLOCOS = [
  { id: "tipo", label: "Tipo" },
  { id: "identificacao", label: "Identificação" },
  { id: "morada", label: "Morada" },
  { id: "contacto", label: "Contacto geral" },
];

const inputCls = "w-full max-w-[16rem] border border-gray-300 rounded-sm px-2 py-1 text-sm text-right bg-white focus:outline-none focus:ring-1 focus:ring-black/20";

export function validarFormFornecedor(form) {
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

/** Formulário do fornecedor em blocos — o mesmo padrão do cliente e do artigo. */
export default function FornecedorForm({ form, set }) {
  const emp = form.tipo === "empresa";
  return (
    <>
      <BlocosShell
        testid="fornecedor-form-blocos"
        storageKey="fornecedor-form-blocos-v1"
        blocks={FORM_BLOCOS}
        visibleIds={FORM_BLOCOS.map((b) => b.id)}
        renderBlock={(id) => {
          if (id === "tipo") {
            return (
              <div className="px-4 py-3" data-testid="fornecedor-tipo-group">
                <div className="grid grid-cols-2 gap-2 max-w-sm ml-auto">
                  {[{ value: "empresa", label: "Empresa" }, { value: "particular", label: "Particular" }].map((opt) => (
                    <button key={opt.value} type="button" data-testid={`fornecedor-tipo-${opt.value}`} onClick={() => set({ tipo: opt.value })}
                      className={`rounded-sm px-3 py-2 text-sm font-medium border transition-colors ${form.tipo === opt.value ? "bg-brand text-brand-fg border-brand" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (id === "identificacao") {
            return (
              <FieldGrid>
                <FieldRow label={emp ? "Razão social *" : "Nome *"} testid="fornecedor-campo-nome" full>
                  <input data-testid="fornecedor-nome-input" value={form.nome} onChange={(e) => set({ nome: e.target.value })} className={inputCls + " max-w-sm"} />
                </FieldRow>
                <FieldRow label={emp ? "NIF *" : "NIF"} testid="fornecedor-campo-nif">
                  <input data-testid="fornecedor-nif-input" value={form.nif} onChange={(e) => set({ nif: e.target.value })} placeholder={emp ? "" : "Opcional"} className={inputCls + " tabular-nums"} />
                </FieldRow>
                <FieldRow label="Categoria" testid="fornecedor-campo-categoria">
                  <input data-testid="fornecedor-categoria-input" value={form.categoria} onChange={(e) => set({ categoria: e.target.value })} placeholder="Ex.: têxtil, brindes" className={inputCls} />
                </FieldRow>
                <FieldRow label="Responsável" testid="fornecedor-campo-responsavel">
                  <UtilizadorSelect testid="fornecedor-responsavel-input" value={form.responsavel} onChange={(v) => set({ responsavel: v })} />
                </FieldRow>
                <FieldRow label="Notas" testid="fornecedor-campo-notas" full>
                  <textarea data-testid="fornecedor-notas-input" value={form.notas} onChange={(e) => set({ notas: e.target.value })} rows={2} className="w-full max-w-sm border border-gray-300 rounded-sm px-2 py-1 text-sm text-left bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                </FieldRow>
              </FieldGrid>
            );
          }
          if (id === "morada") {
            return (
              <FieldGrid>
                <FieldRow label={emp ? "Morada *" : "Morada"} testid="fornecedor-campo-morada" full>
                  <input data-testid="fornecedor-morada-input" value={form.morada} onChange={(e) => set({ morada: e.target.value })} className={inputCls + " max-w-sm"} />
                </FieldRow>
                <FieldRow label={emp ? "Código postal *" : "Código postal"} testid="fornecedor-campo-cp">
                  <input data-testid="fornecedor-cp-input" value={form.codigo_postal} onChange={(e) => set({ codigo_postal: e.target.value })} className={inputCls} />
                </FieldRow>
                <FieldRow label={emp ? "Cidade *" : "Cidade"} testid="fornecedor-campo-cidade">
                  <input data-testid="fornecedor-cidade-input" value={form.cidade} onChange={(e) => set({ cidade: e.target.value })} className={inputCls} />
                </FieldRow>
                <FieldRow label="País" testid="fornecedor-campo-pais" full>
                  <input data-testid="fornecedor-pais-input" value={form.pais} onChange={(e) => set({ pais: e.target.value })} className={inputCls} />
                </FieldRow>
              </FieldGrid>
            );
          }
          if (id === "contacto") {
            return (
              <FieldGrid>
                <FieldRow label={emp ? "Telefone / contacto *" : "Telefone / contacto"} testid="fornecedor-campo-contacto">
                  <input data-testid="fornecedor-contacto-input" value={form.contacto} onChange={(e) => set({ contacto: e.target.value })} className={inputCls} />
                </FieldRow>
                <FieldRow label={emp ? "Email *" : "Email"} testid="fornecedor-campo-email">
                  <input data-testid="fornecedor-email-input" value={form.email} onChange={(e) => set({ email: e.target.value })} className={inputCls} />
                </FieldRow>
                <FieldRow label="Website" testid="fornecedor-campo-website" full>
                  <input data-testid="fornecedor-website-input" value={form.website} onChange={(e) => set({ website: e.target.value })} className={inputCls} />
                </FieldRow>
              </FieldGrid>
            );
          }
          return null;
        }}
      />
      <CamposPersonalizados modulo="fornecedores" className="mt-3" value={form.campos_extra} onChange={(vals) => set({ campos_extra: vals })} />
    </>
  );
}
