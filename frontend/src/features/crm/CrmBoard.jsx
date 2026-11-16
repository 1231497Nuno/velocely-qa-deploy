import { useRef, useState } from "react";
import { Plus, CalendarClock, FileText, UserCheck } from "lucide-react";
import { eur, fmtDate } from "@/lib/api";
import { acaoAtrasada, iniciais, tituloLead } from "./crmShared";

/**
 * Quadro kanban do CRM. Arrastar um cartão muda o estado e/ou a posição na coluna.
 * onMove(leadId, estadoId, antesDeId|null) — o pai faz a atualização otimista e chama a API.
 */
export default function CrmBoard({ estados, leads, onOpen, onNew, onMove, canEdit, canCreate }) {
  const [drag, setDrag] = useState(null); // { id, estadoId }
  const [hover, setHover] = useState(null); // { estadoId, antesDeId }
  const colRefs = useRef({});

  const porEstado = {};
  estados.forEach((e) => { porEstado[e.id] = []; });
  leads.forEach((l) => { (porEstado[l.estado_id] ||= []).push(l); });

  function alvoNaColuna(estadoId, clientY) {
    const col = colRefs.current[estadoId];
    if (!col) return null;
    const cards = [...col.querySelectorAll("[data-lead-card]")].filter((c) => c.dataset.leadId !== drag?.id);
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return c.dataset.leadId;
    }
    return null;
  }

  function onDragOver(e, estadoId) {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const antesDeId = alvoNaColuna(estadoId, e.clientY);
    if (!hover || hover.estadoId !== estadoId || hover.antesDeId !== antesDeId) {
      setHover({ estadoId, antesDeId });
    }
  }

  function onDrop(e, estadoId) {
    e.preventDefault();
    if (!drag) return;
    const antesDeId = alvoNaColuna(estadoId, e.clientY);
    const lista = porEstado[estadoId] || [];
    const idx = lista.findIndex((l) => l.id === drag.id);
    const proximo = idx >= 0 ? lista[idx + 1]?.id || null : undefined;
    const semMudanca = drag.estadoId === estadoId && (antesDeId === proximo || (antesDeId === null && idx === lista.length - 1));
    if (!semMudanca) onMove(drag.id, estadoId, antesDeId);
    setDrag(null);
    setHover(null);
  }

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-2" data-testid="crm-board">
      <div className="flex gap-3 h-full min-w-max">
        {estados.map((est) => {
          const lista = porEstado[est.id] || [];
          const total = lista.reduce((s, l) => s + (Number(l.valor_estimado) || 0), 0);
          const ativa = hover?.estadoId === est.id;
          return (
            <section
              key={est.id}
              data-testid={`crm-col-${est.id}`}
              className={`w-[17.5rem] shrink-0 flex flex-col min-h-0 rounded-sm border bg-gray-50 transition-colors ${
                ativa ? "border-gray-500 bg-gray-100" : "border-gray-200"
              }`}
              style={{ borderTop: `3px solid ${est.cor}` }}
              onDragOver={(e) => onDragOver(e, est.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setHover(null);
              }}
              onDrop={(e) => onDrop(e, est.id)}
            >
              <header className="px-3 pt-2.5 pb-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: est.cor }} />
                    <h3 className="text-sm font-semibold text-gray-900 truncate" title={est.nome}>{est.nome}</h3>
                    <span className="text-xs text-gray-500 tabular-nums">{lista.length}</span>
                  </div>
                  {canCreate && (
                    <button
                      type="button"
                      onClick={() => onNew(est.id)}
                      className="p-1 rounded-sm text-gray-500 hover:text-gray-900 hover:bg-gray-200"
                      title={`Novo lead em «${est.nome}»`}
                      data-testid={`crm-col-add-${est.id}`}
                    >
                      <Plus size={15} />
                    </button>
                  )}
                </div>
                {total > 0 && <div className="text-xs text-gray-500 mt-0.5 tabular-nums">{eur(total)}</div>}
              </header>
              <div ref={(el) => { colRefs.current[est.id] = el; }} className="flex-1 min-h-[4rem] overflow-y-auto px-2 pb-2 space-y-2">
                {lista.map((l) => (
                  <div key={l.id}>
                    {ativa && hover?.antesDeId === l.id && <DropLine />}
                    <LeadCard
                      lead={l}
                      draggable={canEdit}
                      arrastando={drag?.id === l.id}
                      onOpen={() => onOpen(l.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", l.id);
                        setDrag({ id: l.id, estadoId: l.estado_id });
                      }}
                      onDragEnd={() => { setDrag(null); setHover(null); }}
                    />
                  </div>
                ))}
                {ativa && hover?.antesDeId === null && <DropLine />}
                {lista.length === 0 && !ativa && (
                  <p className="text-xs text-gray-400 text-center py-4">Sem leads</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DropLine() {
  return <div className="h-1 rounded-full bg-gray-800 my-1" />;
}

function LeadCard({ lead, draggable, arrastando, onOpen, onDragStart, onDragEnd }) {
  const cliente = lead.is_cliente;
  const atrasada = acaoAtrasada(lead);
  return (
    <article
      data-lead-card
      data-lead-id={lead.id}
      data-testid={`crm-card-${lead.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      role="button"
      tabIndex={0}
      className={`group rounded-sm border p-2.5 text-left cursor-pointer select-none transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-black/20 ${
        cliente ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"
      } ${arrastando ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 leading-snug truncate">{tituloLead(lead)}</div>
          {lead.empresa && lead.nome && <div className="text-xs text-gray-600 truncate">{lead.nome}</div>}
        </div>
        <span
          className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${
            cliente ? "bg-emerald-600 text-white" : "bg-blue-100 text-blue-700"
          }`}
        >
          {cliente ? "Cliente" : "Lead"}
        </span>
      </div>
      {lead.descricao && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{lead.descricao}</p>}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {lead.origem && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-sm bg-gray-100 text-gray-700 border border-gray-200">{lead.origem}</span>
        )}
        {lead.valor_estimado ? (
          <span className="text-[11px] font-semibold text-gray-900 tabular-nums">{eur(lead.valor_estimado)}</span>
        ) : null}
      </div>
      {(lead.proxima_acao_at || lead.num_orcamentos > 0 || lead.responsavel_nome) && (
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-200/70 text-[11px] text-gray-500">
          <div className="flex items-center gap-2.5 min-w-0">
            {lead.proxima_acao_at && (
              <span className={`inline-flex items-center gap-1 ${atrasada ? "text-red-600 font-semibold" : ""}`} title={lead.proxima_acao_nota || "Próxima ação"}>
                <CalendarClock size={12} /> {fmtDate(lead.proxima_acao_at)}
              </span>
            )}
            {lead.num_orcamentos > 0 && (
              <span className="inline-flex items-center gap-1" title="Orçamentos associados">
                <FileText size={12} /> {lead.num_orcamentos}
              </span>
            )}
            {cliente && lead.cliente_nome && lead.cliente_nome !== tituloLead(lead) && (
              <span className="inline-flex items-center gap-1 truncate" title="Cliente associado">
                <UserCheck size={12} /> <span className="truncate">{lead.cliente_nome}</span>
              </span>
            )}
          </div>
          {lead.responsavel_nome && (
            <span
              className="w-5 h-5 shrink-0 rounded-full bg-gray-800 text-white text-[9px] font-semibold flex items-center justify-center"
              title={`Responsável: ${lead.responsavel_nome}`}
            >
              {iniciais(lead.responsavel_nome)}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
