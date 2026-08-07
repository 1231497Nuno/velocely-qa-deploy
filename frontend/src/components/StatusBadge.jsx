export const STATUS_META = {
  rascunho: { label: "Rascunho", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  enviado: { label: "Enviado", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  aceite: { label: "Aceite", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejeitado: { label: "Rejeitado", cls: "bg-red-50 text-red-700 border-red-200" },
  pendente: { label: "Pendente", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  em_producao: { label: "Em Produção", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  concluido: { label: "Concluído", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Encomenda estados
  aberta: { label: "Aberta", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  concluida: { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelada: { label: "Cancelada", cls: "bg-red-50 text-red-700 border-red-200" },
  // Ordens de compra
  criada: { label: "Criada", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  recebida: { label: "Recebida", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Pedidos de cotação
  respondido: { label: "Respondido", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  adjudicado: { label: "Adjudicado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelado: { label: "Cancelado", cls: "bg-red-50 text-red-700 border-red-200" },
  // Pagamento
  parcial: { label: "Pago parcial", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  pago: { label: "Pago total", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Documentos financeiros
  emitida: { label: "Emitida", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  anulada: { label: "Anulada", cls: "bg-red-50 text-red-700 border-red-200" },
};

export default function StatusBadge({ status, testid }) {
  const m = STATUS_META[status] || STATUS_META.rascunho;
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
