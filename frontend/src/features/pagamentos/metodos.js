/** Métodos de pagamento (iguais aos do backend: services/financeiro.PAG_METODO_PT). */
export const METODOS_PAGAMENTO = [
  { id: "transferencia", label: "Transferência bancária" },
  { id: "numerario", label: "Numerário" },
  { id: "mbway", label: "MB WAY" },
  { id: "multibanco", label: "Multibanco" },
  { id: "cheque", label: "Cheque" },
  { id: "cartao", label: "Cartão" },
  { id: "outro", label: "Outro" },
];

export const METODO_LABEL = Object.fromEntries(METODOS_PAGAMENTO.map((m) => [m.id, m.label]));
