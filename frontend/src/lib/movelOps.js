/** Operações da app móvel e a permissão de módulo de que cada uma precisa. */
export const MOVEL_OPS = [
  { op: "rececoes", label: "Receções", modulo: "ordens_compra", acao: "edit" },
  { op: "inventario", label: "Inventário", modulo: "artigos", acao: "edit" },
  { op: "localizacoes", label: "Localizações", modulo: "artigos", acao: "view" },
  { op: "transferir", label: "Transferir", modulo: "artigos", acao: "edit" },
  { op: "movimento", label: "Entrada / saída", modulo: "artigos", acao: "edit" },
  { op: "acertar", label: "Acertar stock", modulo: "artigos", acao: "edit" },
  { op: "stock_baixo", label: "Stock baixo", modulo: "artigos", acao: "view" },
  { op: "movimentos", label: "Movimentos", modulo: "artigos", acao: "view" },
  { op: "consultar", label: "Consultar stock", modulo: "artigos", acao: "view" },
  { op: "oficina", label: "Oficina", modulo: "ordens_fabrico", acao: "view" },
];

/**
 * A operação está disponível para este utilizador? Precisa da permissão do módulo e, se o perfil tiver
 * uma lista de operações da app móvel, de estar nessa lista.
 */
export function podeMovel(user, can, op) {
  const def = MOVEL_OPS.find((x) => x.op === op);
  if (!def || !can(def.modulo, def.acao)) return false;
  const lista = user?.perfil?.app_movel;
  return user?.perfil?.admin || !Array.isArray(lista) || lista.includes(op);
}
