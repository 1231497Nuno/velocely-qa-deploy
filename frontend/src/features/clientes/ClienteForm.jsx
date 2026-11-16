import BlocosShell, { FieldGrid, FieldRow } from "@/components/BlocosShell";
import CamposPersonalizados from "@/components/CamposPersonalizados";
import UtilizadorSelect from "@/components/UtilizadorSelect";
import { useListas, opcoesLista } from "@/lib/listas";

export const emptyCliente = {
  nome: "", tipo: "empresa", morada: "", codigo_postal: "", cidade: "", pais: "Portugal",
  contacto: "", email: "", nif: "", notas: "", responsavel: "",
  condicoes_pagamento: "", desconto_comercial_pct: "", limite_credito: "",
  contactos: [],
  campos_extra: {},
};

const FORM_BLOCOS = [
  { id: "tipo", label: "Tipo" },
  { id: "identificacao", label: "Identificação" },
  { id: "morada", label: "Morada" },
  { id: "contacto", label: "Contacto geral" },
  { id: "financeiro", label: "Dados financeiros" },
];

const inputCls = "w-full max-w-[16rem] border border-gray-300 rounded-sm px-2 py-1 text-sm text-right bg-white focus:outline-none focus:ring-1 focus:ring-black/20";

export function validarFormCliente(form) {
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

export function clientePayload(form) {
  return {
    ...form,
    desconto_comercial_pct: form.desconto_comercial_pct === "" ? null : Number(form.desconto_comercial_pct),
    limite_credito: form.limite_credito === "" ? null : Number(form.limite_credito),
    contactos: form.contactos || [],
  };
}

/** Formulário do cliente em blocos (o mesmo na criação e no padrão das fichas). */
export default function ClienteForm({ form, set }) {
  const listas = useListas();
  const emp = form.tipo === "empresa";
  return (
    <>
    <BlocosShell
      testid="cliente-form-blocos"
      storageKey="cliente-form-blocos-v1"
      blocks={FORM_BLOCOS}
      visibleIds={emp ? ["tipo", "identificacao", "morada", "contacto", "financeiro"] : ["tipo", "identificacao", "morada", "contacto"]}
      renderBlock={(id) => {
        if (id === "tipo") {
          return (
            <div className="px-4 py-3" data-testid="cliente-tipo-group">
              <div className="grid grid-cols-2 gap-2 max-w-sm ml-auto">
                {[
                  { value: "empresa", label: "Empresa" },
                  { value: "particular", label: "Particular" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`cliente-tipo-${opt.value}`}
                    onClick={() => set({ tipo: opt.value })}
                    className={`rounded-sm px-3 py-2 text-sm font-medium border transition-colors ${
                      form.tipo === opt.value
                        ? "bg-brand text-brand-fg border-brand"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
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
              <FieldRow label={emp ? "Razão social *" : "Nome *"} testid="cliente-campo-nome" full>
                <input data-testid="cliente-nome-input" value={form.nome} onChange={(e) => set({ nome: e.target.value })} className={inputCls + " max-w-sm"} />
              </FieldRow>
              <FieldRow label={emp ? "NIF *" : "NIF"} testid="cliente-campo-nif">
                <input data-testid="cliente-nif-input" value={form.nif} onChange={(e) => set({ nif: e.target.value })} placeholder={emp ? "" : "Opcional"} className={inputCls + " tabular-nums"} />
              </FieldRow>
              <FieldRow label="Responsável" testid="cliente-campo-responsavel">
                <UtilizadorSelect testid="cliente-responsavel-input" value={form.responsavel} onChange={(v) => set({ responsavel: v })} />
              </FieldRow>
              <FieldRow label="Notas" testid="cliente-campo-notas" full>
                <textarea data-testid="cliente-notas-input" value={form.notas} onChange={(e) => set({ notas: e.target.value })} rows={2} className="w-full max-w-sm border border-gray-300 rounded-sm px-2 py-1 text-sm text-left bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
              </FieldRow>
            </FieldGrid>
          );
        }
        if (id === "morada") {
          return (
            <FieldGrid>
              <FieldRow label={emp ? "Morada *" : "Morada"} testid="cliente-campo-morada" full>
                <input data-testid="cliente-morada-input" value={form.morada} onChange={(e) => set({ morada: e.target.value })} className={inputCls + " max-w-sm"} />
              </FieldRow>
              <FieldRow label={emp ? "Código postal *" : "Código postal"} testid="cliente-campo-cp">
                <input data-testid="cliente-cp-input" value={form.codigo_postal} onChange={(e) => set({ codigo_postal: e.target.value })} className={inputCls} />
              </FieldRow>
              <FieldRow label={emp ? "Cidade *" : "Cidade"} testid="cliente-campo-cidade">
                <input data-testid="cliente-cidade-input" value={form.cidade} onChange={(e) => set({ cidade: e.target.value })} className={inputCls} />
              </FieldRow>
              <FieldRow label="País" testid="cliente-campo-pais" full>
                <input data-testid="cliente-pais-input" value={form.pais} onChange={(e) => set({ pais: e.target.value })} className={inputCls} />
              </FieldRow>
            </FieldGrid>
          );
        }
        if (id === "contacto") {
          return (
            <FieldGrid>
              <FieldRow label={emp ? "Telefone / contacto *" : "Telefone / contacto"} testid="cliente-campo-contacto">
                <input data-testid="cliente-contacto-input" value={form.contacto} onChange={(e) => set({ contacto: e.target.value })} className={inputCls} />
              </FieldRow>
              <FieldRow label={emp ? "Email *" : "Email"} testid="cliente-campo-email">
                <input data-testid="cliente-email-input" value={form.email} onChange={(e) => set({ email: e.target.value })} className={inputCls} />
              </FieldRow>
            </FieldGrid>
          );
        }
        if (id === "financeiro") {
          return (
            <FieldGrid>
              <FieldRow label="Condições pagamento" testid="cliente-campo-condicoes">
                <select data-testid="cliente-condicoes-input" value={form.condicoes_pagamento} onChange={(e) => set({ condicoes_pagamento: e.target.value })} className={inputCls}>
                  {opcoesLista(listas, "condicoes_pagamento", form.condicoes_pagamento).map((opt) => (
                    <option key={opt || "vazio"} value={opt}>{opt || "—"}</option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label="Desconto comercial %" testid="cliente-campo-desconto">
                <input data-testid="cliente-desconto-input" type="number" min="0" step="0.01" value={form.desconto_comercial_pct} onChange={(e) => set({ desconto_comercial_pct: e.target.value })} className={inputCls + " tabular-nums"} />
              </FieldRow>
              <FieldRow label="Limite crédito €" testid="cliente-campo-credito" full>
                <input data-testid="cliente-credito-input" type="number" min="0" step="0.01" value={form.limite_credito} onChange={(e) => set({ limite_credito: e.target.value })} placeholder="Sem limite" className={inputCls + " tabular-nums"} />
              </FieldRow>
            </FieldGrid>
          );
        }
        return null;
      }}
    />

    <CamposPersonalizados modulo="clientes" className="mt-3" value={form.campos_extra} onChange={(vals) => set({ campos_extra: vals })} />
    </>
  );
}
