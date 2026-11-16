import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Info, ShoppingBag } from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import StatusBadge from "@/components/StatusBadge";

/**
 * Quadro kanban das encomendas, por estado.
 * O estado de produção (Aberta → Em produção → Concluída) segue as ordens de fabrico;
 * arrastar para/da coluna "Entregue" marca/desmarca a entrega.
 */
const COLUNAS = [
  { id: "aberta", nome: "Aberta", cor: "#64748b", ajuda: "Sem produção iniciada" },
  { id: "em_producao", nome: "Em produção", cor: "#2563eb", ajuda: "Pelo menos uma OF em curso" },
  { id: "concluida", nome: "Concluída", cor: "#d97706", ajuda: "Produção pronta — por entregar" },
  { id: "entregue", nome: "Entregue", cor: "#059669", ajuda: "Material entregue ao cliente" },
];

function colunaDe(e) {
  if (e.entregue) return "entregue";
  return COLUNAS.some((c) => c.id === e.estado) ? e.estado : "aberta";
}

const hoje = () => new Date().toISOString().slice(0, 10);

function Cartao({ e, onOpen, onDragStart, onDragEnd, arrastavel, aArrastar }) {
  const atrasada = e.prazo_entrega && e.prazo_entrega < hoje() && !e.entregue;
  const prog = Math.min(100, e.progresso_producao || 0);
  return (
    <article
      draggable={arrastavel}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      data-testid={`enc-card-${e.id}`}
      className={`group rounded-sm border bg-white p-2.5 text-sm shadow-[0_1px_0_rgba(0,0,0,0.03)] cursor-pointer hover:border-gray-400 transition ${aArrastar ? "opacity-40" : ""} ${atrasada ? "border-red-200" : "border-gray-200"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mono font-semibold text-gray-900 inline-flex items-center gap-1.5">
            {e.numero}
            {e.tem_artigos_sem_of && <AlertTriangle size={13} className="text-red-500" title="Artigos sem ordem de fabrico" />}
            {e.origem_externa?.canal === "woocommerce" && <ShoppingBag size={12} className="text-violet-600" title={`Loja online #${e.origem_externa.numero}`} />}
          </div>
          <div className="text-gray-700 truncate" title={e.cliente}>{e.cliente}</div>
        </div>
        <span className="tabular-nums font-semibold text-gray-900 whitespace-nowrap">{eur(e.valor_total)}</span>
      </div>
      {e.descricao && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{e.descricao}</div>}
      {e.num_ofs > 0 && !e.entregue && (
        <div className="mt-2 flex items-center gap-2" title={`${e.num_ofs} OF · ${prog}% em produção`}>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${prog >= 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${prog}%` }} />
          </div>
          <span className="text-[11px] tabular-nums text-gray-500">{prog}%</span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusBadge status={{ pendente: "pendente", parcial: "parcial", pago: "pago" }[e.status_pagamento]} />
        {e.entregue ? (
          <span className="text-[11px] text-emerald-700">{e.data_entrega ? `Entregue ${fmtDate(e.data_entrega)}` : "Entregue"}</span>
        ) : e.prazo_entrega ? (
          <span className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${atrasada ? "text-red-600 font-semibold" : "text-gray-500"}`}>
            <CalendarClock size={11} /> {fmtDate(e.prazo_entrega)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export default function EncomendasQuadro({ q, soLoja }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const confirmAction = useConfirm();
  const [lista, setLista] = useState(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const [dias, setDias] = useState(30);
  const podeEditar = can("encomendas", "edit");

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ quadro: "true", entregues_dias: String(dias) });
    if (q) params.set("q", q);
    if (soLoja) params.set("origem", "loja");
    setLista(await api.get(`/encomendas?${params}`));
  }, [q, soLoja, dias]);

  useEffect(() => {
    const t = setTimeout(() => { carregar().catch(() => setLista([])); }, 150);
    return () => clearTimeout(t);
  }, [carregar]);

  const porColuna = useMemo(() => {
    const out = Object.fromEntries(COLUNAS.map((c) => [c.id, []]));
    (lista || []).forEach((e) => out[colunaDe(e)].push(e));
    // Mais urgentes primeiro (prazo), entregues mais recentes primeiro
    Object.entries(out).forEach(([k, v]) => v.sort((a, b) => (k === "entregue"
      ? String(b.data_entrega || "").localeCompare(String(a.data_entrega || ""))
      : String(a.prazo_entrega || "9999").localeCompare(String(b.prazo_entrega || "9999")))));
    return out;
  }, [lista]);

  const mover = async (e, destino) => {
    const origem = colunaDe(e);
    if (origem === destino) return;
    if (destino === "entregue") {
      if (e.estado !== "concluida" && !await confirmAction({
        title: "Marcar como entregue?",
        description: `A produção da ${e.numero} ainda não está concluída. Marcar o material como entregue na mesma?`,
        confirmLabel: "Marcar entregue",
      })) return;
    } else if (origem === "entregue") {
      if (!await confirmAction({
        title: "Desfazer entrega?",
        description: `A ${e.numero} deixa de estar marcada como entregue.`,
        confirmLabel: "Desfazer entrega",
      })) return;
      if (destino !== colunaDe({ ...e, entregue: false })) {
        toast.message("A entrega foi desfeita; a coluna segue o estado das ordens de fabrico.");
      }
    } else {
      toast.message("Este estado muda sozinho com as ordens de fabrico", {
        description: "Abra a encomenda para criar ou iniciar as OF.",
        action: { label: "Abrir", onClick: () => nav(`/encomendas/${e.id}?tab=producao`) },
      });
      return;
    }
    const entregue = destino === "entregue";
    setLista((l) => l.map((x) => (x.id === e.id ? { ...x, entregue, data_entrega: entregue ? (x.data_entrega || hoje()) : null } : x)));
    try {
      await api.post(`/encomendas/${e.id}/entrega`, { entregue });
      toast.success(entregue ? `${e.numero} entregue` : `Entrega da ${e.numero} desfeita`);
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível mudar");
      carregar().catch(() => {});
    }
  };

  if (!lista) return <div className="text-sm text-gray-500 py-6">A carregar...</div>;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-x-auto pb-2" data-testid="encomendas-quadro">
        <div className="flex gap-3 min-w-max h-full">
          {COLUNAS.map((col) => {
            const itens = porColuna[col.id];
            const total = itens.reduce((s, e) => s + (Number(e.valor_total) || 0), 0);
            const ativa = hover === col.id && drag;
            return (
              <section
                key={col.id}
                data-testid={`enc-col-${col.id}`}
                className={`w-[18rem] shrink-0 flex flex-col min-h-[60vh] max-h-[calc(100vh-15rem)] rounded-sm border bg-gray-50 transition-colors ${ativa ? "border-gray-500 bg-gray-100" : "border-gray-200"}`}
                style={{ borderTop: `3px solid ${col.cor}` }}
                onDragOver={(ev) => { if (drag) { ev.preventDefault(); if (hover !== col.id) setHover(col.id); } }}
                onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) setHover(null); }}
                onDrop={(ev) => { ev.preventDefault(); const e = drag; setDrag(null); setHover(null); if (e) mover(e, col.id); }}
              >
                <header className="px-3 pt-2.5 pb-2 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.cor }} />
                      <h3 className="text-sm font-semibold text-gray-900">{col.nome}</h3>
                      <span className="text-xs text-gray-500 tabular-nums">{itens.length}</span>
                    </div>
                    <span className="text-xs tabular-nums text-gray-600">{eur(total)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                    {col.ajuda}
                    {col.id === "entregue" && (
                      <select value={dias} onChange={(ev) => setDias(Number(ev.target.value))} className="ml-auto text-[11px] border border-gray-200 rounded-sm bg-white px-1 py-0.5">
                        <option value={7}>7 dias</option>
                        <option value={30}>30 dias</option>
                        <option value={90}>90 dias</option>
                        <option value={365}>1 ano</option>
                      </select>
                    )}
                  </div>
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2">
                  {itens.map((e) => (
                    <Cartao
                      key={e.id}
                      e={e}
                      arrastavel={podeEditar}
                      aArrastar={drag?.id === e.id}
                      onOpen={() => nav(`/encomendas/${e.id}`)}
                      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); setDrag(e); }}
                      onDragEnd={() => { setDrag(null); setHover(null); }}
                    />
                  ))}
                  {itens.length === 0 && <div className="text-xs text-gray-400 text-center py-6">Sem encomendas</div>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
        <Info size={13} /> Aberta, Em produção e Concluída seguem as ordens de fabrico. Arraste para «Entregue» para marcar a entrega (ou de volta para a desfazer).
      </p>
    </div>
  );
}
