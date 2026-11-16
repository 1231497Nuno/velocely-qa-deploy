import { eur, fmtDate } from "@/lib/api";
import { ScrollableTable, MobileCards, MobileCard, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { acaoAtrasada, tituloLead } from "./crmShared";

function EstadoBadge({ lead }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-800">
      <span className="w-2 h-2 rounded-full" style={{ background: lead.estado_cor || "#64748b" }} />
      {lead.estado_nome || "—"}
    </span>
  );
}

function TipoBadge({ lead }) {
  return lead.is_cliente ? (
    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-emerald-600 text-white">Cliente</span>
  ) : (
    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-blue-100 text-blue-700">Lead</span>
  );
}

export default function CrmLista({ estados, leads, onOpen }) {
  const ordemEstado = Object.fromEntries(estados.map((e, i) => [e.id, i]));
  const linhas = [...leads].sort(
    (a, b) => (ordemEstado[a.estado_id] ?? 99) - (ordemEstado[b.estado_id] ?? 99) || (a.ordem || 0) - (b.ordem || 0)
  );
  const th = "text-left px-4 py-2.5 bg-gray-50 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500";

  if (!linhas.length) {
    return (
      <div className="flex-1 bg-white border border-gray-200 rounded-sm flex items-center justify-center text-sm text-gray-500 py-12">
        Nenhum lead encontrado.
      </div>
    );
  }

  return (
    <>
      <ScrollableTable className="hidden md:flex md:flex-col" testid="crm-list">
        <table className="w-full text-sm">
          <thead>
            <tr className={TABLE_HEAD_STICKY}>
              <th className={th}>Lead</th>
              <th className={th}>Estado</th>
              <th className={th}>Origem</th>
              <th className={`${th} text-right`}>Valor</th>
              <th className={th}>Próxima ação</th>
              <th className={th}>Responsável</th>
              <th className={th}>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr
                key={l.id}
                data-testid={`crm-row-${l.id}`}
                onClick={() => onOpen(l.id)}
                className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${l.is_cliente ? "bg-emerald-50/50" : ""}`}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <TipoBadge lead={l} />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{tituloLead(l)}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {[l.empresa ? l.nome : "", l.telefone, l.email].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5"><EstadoBadge lead={l} /></td>
                <td className="px-4 py-2.5 text-gray-700">{l.origem || "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{l.valor_estimado ? eur(l.valor_estimado) : "—"}</td>
                <td className={`px-4 py-2.5 ${acaoAtrasada(l) ? "text-red-600 font-semibold" : "text-gray-700"}`}>
                  {l.proxima_acao_at ? fmtDate(l.proxima_acao_at) : "—"}
                  {l.proxima_acao_nota && <div className="text-xs font-normal text-gray-500 truncate max-w-[14rem]">{l.proxima_acao_nota}</div>}
                </td>
                <td className="px-4 py-2.5 text-gray-700">{l.responsavel_nome || "—"}</td>
                <td className="px-4 py-2.5 text-gray-500">{fmtDate(l.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <MobileCards testid="crm-list-cards">
        {linhas.map((l) => (
          <MobileCard key={l.id} onClick={() => onOpen(l.id)} testid={`crm-mcard-${l.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{tituloLead(l)}</div>
                <div className="text-xs text-gray-500 truncate">{[l.origem, l.telefone].filter(Boolean).join(" · ")}</div>
              </div>
              <TipoBadge lead={l} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <EstadoBadge lead={l} />
              <span className="tabular-nums">{l.valor_estimado ? eur(l.valor_estimado) : ""}</span>
            </div>
          </MobileCard>
        ))}
      </MobileCards>
    </>
  );
}
