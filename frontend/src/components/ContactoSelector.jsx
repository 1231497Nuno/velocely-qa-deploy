import { useMemo } from "react";
import Combobox from "@/components/Combobox";

/** Select «À atenção de» — contactos activos da empresa. */
export default function ContactoSelector({
  contactos = [],
  value,
  onChange,
  disabled = false,
  testid = "contacto-select",
  placeholder = "Sem contacto específico…",
}) {
  const activos = useMemo(
    () => (contactos || []).filter((c) => c && c.ativo !== false && (c.nome || "").trim()),
    [contactos],
  );

  const options = useMemo(
    () => [
      { value: "", label: placeholder },
      ...activos.map((c) => {
        const extra = [c.cargo, c.departamento].filter(Boolean).join(" · ");
        return {
          value: c.id,
          label: extra ? `${c.nome} (${extra})` : c.nome,
        };
      }),
    ],
    [activos, placeholder],
  );

  return (
    <Combobox
      options={options}
      value={value || ""}
      onChange={(v) => {
        const id = v || null;
        const c = id ? activos.find((x) => x.id === id) : null;
        onChange?.(id, c || null);
      }}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder="Pesquisar contacto…"
      emptyText="Sem contactos nesta empresa."
      testid={testid}
      optionTestidPrefix={`${testid}-opt`}
    />
  );
}
