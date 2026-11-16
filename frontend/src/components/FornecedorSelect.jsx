import { Link } from "react-router-dom";
import { Mail, Phone, X } from "lucide-react";
import Combobox from "@/components/Combobox";

/** Opções de fornecedores para o Combobox (pesquisa por nome, código ou NIF). */
export function opcoesFornecedores(fornecedores) {
  return (fornecedores || []).map((f) => ({
    value: f.id,
    label: f.nome || "(sem nome)",
    hint: [f.codigo, f.nif].filter(Boolean).join(" · "),
  }));
}

/**
 * Seletor único de fornecedor (OC, pedidos de cotação…): escolhe-se da lista,
 * nunca texto livre. Mostra contactos e o atalho para a ficha.
 */
export default function FornecedorSelect({
  fornecedores,
  value,
  nomeAtual = "",
  onChange,
  editavel = true,
  testid = "fornecedor",
}) {
  const f = (fornecedores || []).find((x) => x.id === value);

  const info = f && (f.contacto || f.email) ? (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500" data-testid={`${testid}-info`}>
      {f.contacto && <span className="inline-flex items-center gap-1"><Phone size={11} /> {f.contacto}</span>}
      {f.email && (
        <a href={`mailto:${f.email}`} className="inline-flex items-center gap-1 hover:text-gray-900">
          <Mail size={11} /> {f.email}
        </a>
      )}
    </div>
  ) : null;

  if (!editavel) {
    return (
      <div className="text-sm min-h-[2.25rem] py-2">
        {value ? (
          <Link to={`/fornecedores/${value}`} className="hover:underline text-gray-900">
            {f?.nome || nomeAtual || "Fornecedor"}
          </Link>
        ) : (
          <span className={nomeAtual ? "text-gray-900" : "text-gray-400"}>{nomeAtual || "—"}</span>
        )}
        {info}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <Combobox
            options={opcoesFornecedores(fornecedores)}
            value={value || ""}
            onChange={(id) => onChange(id, (fornecedores || []).find((x) => x.id === id) || null)}
            placeholder="Escolher fornecedor..."
            searchPlaceholder="Pesquisar nome, código ou NIF..."
            emptyText="Nenhum fornecedor encontrado."
            matchPrefix={false}
            testid={testid}
            optionTestidPrefix={`${testid}-opt`}
          />
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            title="Tirar fornecedor"
            aria-label="Tirar fornecedor"
            className="p-2 rounded-sm text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
            data-testid={`${testid}-limpar`}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {!value && nomeAtual && (
        <p className="text-xs text-amber-700 mt-1">
          Importado como «{nomeAtual}» — escolha o fornecedor da lista para ligar à ficha.
        </p>
      )}
      {info}
      {value && (
        <Link to={`/fornecedores/${value}`} className="text-xs text-gray-500 hover:text-gray-900 mt-1 inline-block">
          Ver ficha do fornecedor →
        </Link>
      )}
    </div>
  );
}
