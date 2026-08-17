export const STATUS_META = {
  rascunho: { label: "Rascunho", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  criado: { label: "Criado", cls: "bg-slate-100 text-slate-800 border-slate-300" },
  finalizado: { label: "Criado", cls: "bg-slate-100 text-slate-800 border-slate-300" },
  enviado: { label: "Enviado", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  negociado: { label: "Negociação", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  ganho: { label: "Ganho", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  perdido: { label: "Perdido", cls: "bg-red-50 text-red-700 border-red-200" },
  aceite: { label: "Ganho", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejeitado: { label: "Perdido", cls: "bg-red-50 text-red-700 border-red-200" },
  pendente: { label: "Pendente", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  em_producao: { label: "Em Produção", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  concluido: { label: "Concluído", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Encomenda estados
  aberta: { label: "Aberta", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  concluida: { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  entregue: { label: "Entregue", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  cancelada: { label: "Cancelada", cls: "bg-red-50 text-red-700 border-red-200" },
  // Ordens de compra
  criada: { label: "Criada", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  recebida: { label: "Recebida", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Pedidos de cotação
  respondido: { label: "Respondido", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  adjudicado: { label: "Adjudicado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelado: { label: "Cancelado", cls: "bg-red-50 text-red-700 border-red-200" },
  em_analise: { label: "Em análise", cls: "bg-violet-50 text-violet-800 border-violet-200" },
  fechada: { label: "Fechada", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  parcial: { label: "Pago parcial", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  pago: { label: "Pago total", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Documentos financeiros
    emitida: { label: "Emitida", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    anulada: { label: "Anulada", cls: "bg-red-50 text-red-700 border-red-200" },
    liquidada: { label: "Liquidada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
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
