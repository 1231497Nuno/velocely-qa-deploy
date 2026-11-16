import Combobox from "@/components/Combobox";

/**
 * Seleção com pesquisa para listas da base de dados (máquinas, mão de obra, fornecedores, categorias, materiais…).
 * Pesquisa em qualquer parte do nome e do código. `onChange(id, item)`.
 */
export default function EntitySelect({
  items = [], value, onChange, placeholder = "Selecionar…", clearLabel, size = "md", testid, disabled = false,
  label = (x) => x.nome || x.label || "", hint = (x) => x.codigo || "", className = "",
}) {
  const options = items.map((x) => ({ value: x.id, label: label(x), hint: hint(x) || "", item: x }));
  return (
    <Combobox
      options={options}
      value={value || ""}
      onChange={(v, o) => onChange(v, o?.item || null)}
      placeholder={placeholder}
      searchPlaceholder="Pesquisar…"
      matchPrefix={false}
      clearLabel={clearLabel}
      size={size}
      testid={testid}
      disabled={disabled}
      className={className}
    />
  );
}
