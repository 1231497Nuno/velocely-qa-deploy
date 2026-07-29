import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, fmtDate, eur, API, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import StatusBadge from "@/components/StatusBadge";
import { useSort, SortTh } from "@/components/table";
import { FileText, FileSpreadsheet, ScrollText, Trash2, ExternalLink, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";

/** Tipos emitíveis a partir da encomenda / filtros. */
export const DOC_TIPOS = [
  { id: "fatura", label: "Faturas", icon: FileText },
  { id: "proforma", label: "Faturas Pro Forma", icon: FileSpreadsheet },
  { id: "fatura_recibo", label: "Faturas-Recibo", icon: ScrollText },
];

export const DOC_TIPO_PT = {
  fatura: "Fatura",
  proforma: "Fatura Pro Forma",
  recibo: "Recibo",
  fatura_recibo: "Fatura-Recibo",
};

const FILTROS = [
  { id: "todas", label: "Todas" },
  ...DOC_TIPOS.map((t) => ({ id: t.id, label: t.label })),
];

function PayDot({ status }) {
  const cls =
    status === "pago" ? "bg-emerald-500" :
    status === "parcial" ? "bg-amber-400" :
    status === "recibo" ? "bg-gray-400" :
    status === "pendente" ? "bg-gray-300" :
    "bg-gray-300";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${cls}`} title={status || ""} />;
}

export default function Financeiro() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState({});
  const [searchParams, setSearchParams] = useSearchParams();
  const filtro = searchParams.get("tipo") || "todas";
  const nav = useNavigate();
  const { sort, toggle, apply } = useSort("data", "desc");

  const load = useCallback(async () => {
    const docs = await api.get("/financeiro/documentos");
    setItems(docs);
    setExpanded((prev) => {
      const next = { ...prev };
      docs.forEach((d) => {
        if ((d.recibos || []).length > 0 && next[d.id] === undefined) next[d.id] = true;
      });
      return next;
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const setFiltro = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === "todas") next.delete("tipo");
    else next.set("tipo", id);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!FILTROS.some((t) => t.id === filtro)) setFiltro("todas");
  }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Eliminar esta fatura e os recibos associados?")) return;
    await api.del(`/financeiro/documentos/${id}`);
    toast.success("Fatura eliminada");
    load();
  };

  const toggleExpand = (e, id) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const ql = q.trim().toLowerCase();
  const matchQ = (d) =>
    !ql ||
    [d.numero, d.cliente, d.encomenda_numero].some((v) => (v || "").toLowerCase().includes(ql)) ||
    (d.recibos || []).some((r) => (r.numero || "").toLowerCase().includes(ql));

  const filtered = useMemo(() => {
    const base = items.filter(matchQ);
    if (filtro === "todas") return base;
    return base.filter((d) => d.tipo === filtro);
  }, [items, q, filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    todas: items.filter(matchQ).length,
    ...Object.fromEntries(DOC_TIPOS.map((t) => [t.id, items.filter((d) => d.tipo === t.id && matchQ(d)).length])),
  }), [items, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = apply(filtered);

  return (
    <div>
      <PageHeader
        title="Faturas"
        subtitle="Lista de faturas. Expande cada linha para ver os recibos associados."
      />

      <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por número, cliente, encomenda ou recibo..." testid="financeiro-search" />

      <div className="flex items-center gap-2 mb-4 flex-wrap" data-testid="financeiro-tabs">
        {FILTROS.map((t) => {
          const active = filtro === t.id;
          return (
            <button
              key={t.id}
              data-testid={`fin-tab-${t.id}`}
              onClick={() => setFiltro(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-colors ${active ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}
            >
              {t.label}
              <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${active ? "bg-white/20" : "bg-gray-100 text-gray-500"}`}>{counts[t.id] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]" data-testid="financeiro-table">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-10 px-2 py-3" />
              <SortTh label="Nº" sortKey="numero" sort={sort} onSort={toggle} />
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
              <SortTh label="Cliente" sortKey="cliente" sort={sort} onSort={toggle} />
              <SortTh label="Data" sortKey="data" sort={sort} onSort={toggle} />
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pagamento</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pendente</th>
              <SortTh label="Total" sortKey="total" sort={sort} onSort={toggle} align="right" />
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d, idx) => {
              const recibos = d.recibos || [];
              const hasKids = recibos.length > 0;
              const open = !!expanded[d.id];
              const isProforma = d.tipo === "proforma";
              return (
                <FaturaGroup
                  key={d.id}
                  d={d}
                  idx={idx}
                  hasKids={hasKids}
                  open={open}
                  isProforma={isProforma}
                  recibos={recibos}
                  canDelete={can("financeiro", "delete")}
                  onToggle={(e) => toggleExpand(e, d.id)}
                  onOpen={() => nav(`/financeiro/${d.id}`)}
                  onOpenRecibo={(id) => nav(`/financeiro/${id}`)}
                  onRemove={remove}
                />
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                  Sem faturas. Emite a partir de uma encomenda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FaturaGroup({ d, idx, hasKids, open, isProforma, recibos, canDelete, onToggle, onOpen, onOpenRecibo, onRemove }) {
  return (
    <>
      <tr
        data-testid={`fin-row-${d.id}`}
        onClick={onOpen}
        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${open && hasKids ? "bg-sky-50/60" : ""}`}
      >
        <td className="px-2 py-3 text-center" onClick={(e) => hasKids && onToggle(e)}>
          <div className="flex items-center justify-center gap-1">
            {hasKids ? (
              <button
                type="button"
                data-testid={`fin-expand-${d.id}`}
                className="p-0.5 text-sky-600 hover:text-sky-800"
                aria-label={open ? "Fechar" : "Expandir"}
              >
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="text-xs text-gray-400 tabular-nums w-4">{idx + 1}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {!isProforma && <PayDot status={d.status_pagamento} />}
            <span className="font-medium mono text-teal-700 hover:underline">{d.numero}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs">{DOC_TIPO_PT[d.tipo] || d.tipo}</td>
        <td className="px-4 py-3 text-gray-700">{d.cliente || "—"}</td>
        <td className="px-4 py-3 text-gray-500 tabular-nums">{fmtDate(d.data)}</td>
        <td className="px-4 py-3">
          {isProforma ? <span className="text-xs text-gray-400">—</span> : <StatusBadge status={d.status_pagamento || "pendente"} />}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-600">
          {isProforma ? "—" : eur(d.valor_pendente || 0)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums font-medium">{eur(d.total)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <a
              href={`${API}/financeiro/documentos/${d.id}/pdf?auth=${getToken()}`}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-sm hover:bg-gray-100 text-gray-500"
              title="Abrir PDF"
            >
              <ExternalLink size={15} />
            </a>
            {canDelete && (
              <button onClick={(e) => onRemove(e, d.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600" title="Eliminar">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {open && recibos.map((r) => (
        <tr
          key={r.id}
          data-testid={`fin-recibo-row-${r.id}`}
          onClick={() => onOpenRecibo(r.id)}
          className="border-b border-gray-100 bg-white hover:bg-gray-50 cursor-pointer"
        >
          <td className="px-2 py-2.5" />
          <td className="px-4 py-2.5 pl-10">
            <div className="flex items-center gap-2">
              <PayDot status="recibo" />
              <span className="font-medium mono text-teal-700 text-sm hover:underline">{r.numero}</span>
              <span className="text-[10px] uppercase tracking-wide text-gray-400">Recibo</span>
            </div>
          </td>
          <td className="px-4 py-2.5 text-gray-400 text-xs">Recibo</td>
          <td className="px-4 py-2.5 text-gray-500 text-sm">{r.cliente || d.cliente || "—"}</td>
          <td className="px-4 py-2.5 text-gray-500 tabular-nums text-sm">{fmtDate(r.data)}</td>
          <td className="px-4 py-2.5" />
          <td className="px-4 py-2.5 text-right" />
          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-emerald-700">
            − {eur(r.valor_pago || r.total)}
          </td>
          <td className="px-4 py-2.5">
            <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
              <a
                href={`${API}/financeiro/documentos/${r.id}/pdf?auth=${getToken()}`}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-sm hover:bg-gray-100 text-gray-500"
                title="PDF do recibo"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
