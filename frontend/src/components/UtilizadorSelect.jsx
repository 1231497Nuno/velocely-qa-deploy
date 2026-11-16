import { useEffect, useState } from "react";
import Combobox from "@/components/Combobox";
import { api } from "@/lib/api";

let cache = null;

/** Responsável escolhido da lista de utilizadores (com pesquisa). Guarda o nome, como antes. */
export default function UtilizadorSelect({ value, onChange, testid, placeholder = "Escolher responsável…", size = "md" }) {
  const [users, setUsers] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    api.get("/utilizadores-lista").then((r) => { cache = Array.isArray(r) ? r : []; setUsers(cache); }).catch(() => {});
  }, []);
  const ops = users.map((u) => ({ value: u.nome, label: u.nome, hint: u.login || "" }));
  if (value && !ops.some((o) => o.value === value)) ops.unshift({ value, label: value });
  return (
    <Combobox options={ops} value={value || ""} onChange={(v) => onChange(v || "")} placeholder={placeholder}
      matchPrefix={false} clearLabel="— Sem responsável —" size={size} testid={testid} />
  );
}
