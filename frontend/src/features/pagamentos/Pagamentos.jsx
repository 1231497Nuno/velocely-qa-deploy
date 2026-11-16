import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, MobileCards, MobileCard, TABLE_HEAD_STICKY } from "@/components/ListPage";
import MobileFiltersButton from "@/components/MobileFiltersButton";
import { FiltroChip, FiltroGrupo, FiltroSelect } from "@/components/Filtros";
import { FileText, Lock, Pencil, Undo2 } from "lucide-react";
import PagamentoDialog, { METODOS_PAGAMENTO } from "@/features/pagamentos/PagamentoDialog";

/** Situação de faturação de um pagamento (coluna "Fatura"). */
export function FaturaPagamento({ p }) {
  if (p.tipo === "devolucao") return <span className="text-xs text-gray-400">—</span>;
  if (p.faturado === "sim") {
    const conteudo = (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Lock size={11} /> {p.documento_numero || p.recibo_numero || "Faturado"}
      </span>
    );
    return p.documento_id ? <Link to={`/financeiro/${p.documento_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{conteudo}</Link> : conteudo;
  }
  if (p.faturado === "rascunho") {
    return (
      <Link to={`/financeiro/${p.documento_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline">
        <FileText size={11} /> Rascunho
      </Link>
    );
  }
  return <span className="text-xs font-medium text-gray-500">Por faturar</span>;
}

function Kpi({ label, valor, destaque = false, testid }) {
  return (
    <div className="bg-white border border-gray-200 rounded-sm px-4 py-3 min-w-0" data-testid={testid}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${destaque ? "text-amber-700" : "text-gray-900"}`}>{valor}</div>
    </div>
  );
}

export default function Pagamentos() {
  const { can } = useAuth();
  const [faturado, setFaturado] = useState("");
  const [metodo, setMetodo] = useState("");
  const [tipo, setTipo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [aberto, setAberto] = useState(null);

  const extraParams = useMemo(() => {
    const p = {};
    if (faturado) p.faturado = faturado;
    if (metodo) p.metodo = metodo;
    if (tipo) p.tipo = tipo;
    if (de) p.de = de;
    if (ate) p.ate = ate;
    return p;
  }, [faturado, metodo, tipo, de, ate]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, extra,
  } = useServerPagedList("/pagamentos", { extraParams });
  const resumo = extra?.resumo || {};
  const nFiltros = (faturado ? 1 : 0) + (metodo ? 1 : 0) + (tipo ? 1 : 0) + (de ? 1 : 0) + (ate ? 1 : 0);
  const limpar = () => { setFaturado(""); setMetodo(""); setTipo(""); setDe(""); setAte(""); };

  const linhaValor = (p) => (
    <span className={`tabular-nums font-semibold ${p.tipo === "devolucao" ? "text-red-600" : "text-gray-900"}`}>
      {p.tipo === "devolucao" ? "−" : ""}{eur(p.valor)}
    </span>
  );

  return (
    <ListPage
      header={
        <PageHeader
          title="Pagamentos"
          subtitle="Todos os pagamentos das encomendas — editar, faturar e acompanhar o que falta faturar"
        />
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi label="Recebido" valor={eur(resumo.recebido || 0)} testid="pag-kpi-recebido" />
            <Kpi label="Devolvido" valor={eur(resumo.devolvido || 0)} testid="pag-kpi-devolvido" />
            <Kpi label="Líquido" valor={eur(resumo.liquido || 0)} testid="pag-kpi-liquido" />
            <Kpi label={`Por faturar (${resumo.n_por_faturar || 0})`} valor={eur(resumo.por_faturar || 0)} destaque={(resumo.por_faturar || 0) > 0} testid="pag-kpi-por-faturar" />
          </div>
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar cliente, encomenda, recibo ou fatura..." testid="pagamentos-search" />
          <MobileFiltersButton
            testid="pagamentos-filtros"
            activeCount={nFiltros}
            onClear={limpar}
            title="Filtrar pagamentos"
            description="Faturação, método, tipo e período."
          >
            {({ mobile }) => (
              <div className={mobile ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2 w-full"}>
                <FiltroGrupo mobile={mobile}>
                  {[["", "Todos"], ["nao", "Por faturar"], ["rascunho", "Em rascunho"], ["sim", "Faturados"]].map(([id, label]) => (
                    <FiltroChip key={id || "todos"} active={faturado === id} onClick={() => setFaturado(id)} count={total} testid={`pag-filtro-${id || "todos"}`}>
                      {label}
                    </FiltroChip>
                  ))}
                </FiltroGrupo>
                <FiltroSelect mobile={mobile} value={metodo} onChange={setMetodo} testid="pag-filtro-metodo" className={mobile ? "" : "ml-auto"}>
                  <option value="">Todos os métodos</option>
                  {METODOS_PAGAMENTO.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </FiltroSelect>
                <FiltroSelect mobile={mobile} value={tipo} onChange={setTipo} testid="pag-filtro-tipo">
                  <option value="">Pagamentos e devoluções</option>
                  <option value="pagamento">Só pagamentos</option>
                  <option value="devolucao">Só devoluções</option>
                </FiltroSelect>
                <label className={`${mobile ? "w-full" : ""} inline-flex items-center gap-1.5 text-xs text-gray-500`}>
                  De
                  <input type="date" value={de} onChange={(e) => setDe(e.target.value)} data-testid="pag-filtro-de" className="text-sm border border-gray-300 rounded-sm px-2 py-1.5 min-h-9 bg-white text-gray-700 flex-1" />
                </label>
                <label className={`${mobile ? "w-full" : ""} inline-flex items-center gap-1.5 text-xs text-gray-500`}>
                  até
                  <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} data-testid="pag-filtro-ate" className="text-sm border border-gray-300 rounded-sm px-2 py-1.5 min-h-9 bg-white text-gray-700 flex-1" />
                </label>
              </div>
            )}
          </MobileFiltersButton>
        </div>
      }
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rangeLabel={rangeLabel}
          testid="pagamentos-pagination"
        />
      }
    >
      <ScrollableTable className="hidden md:flex md:flex-col">
        <table className="w-full text-sm min-w-[860px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              {["Data", "Recibo", "Encomenda", "Cliente", "Método"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">{h}</th>
              ))}
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Valor</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-gray-50">Fatura</th>
              <th className="px-4 py-3 w-12 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody data-testid="pagamentos-table">
            {items.map((p) => (
              <tr key={`${p.encomenda_id}-${p.id}`} data-testid={`pagamento-row-${p.id}`} onClick={() => setAberto(p)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3 tabular-nums text-gray-700">{p.data ? fmtDate(p.data) : "—"}</td>
                <td className="px-4 py-3 mono text-gray-900">
                  <span className="inline-flex items-center gap-1.5">
                    {p.tipo === "devolucao" && <Undo2 size={13} className="text-red-500" title="Devolução" />}
                    {p.recibo_numero || "—"}
                  </span>
                </td>
                <td className="px-4 py-3 mono">
                  <Link to={`/encomendas/${p.encomenda_id}`} onClick={(e) => e.stopPropagation()} className="text-gray-900 hover:underline">{p.encomenda_numero}</Link>
                </td>
                <td className="px-4 py-3 text-gray-700 max-w-[16rem] truncate">{p.cliente}</td>
                <td className="px-4 py-3 text-gray-600">{p.metodo_label}</td>
                <td className="px-4 py-3 text-right">{linhaValor(p)}</td>
                <td className="px-4 py-3"><FaturaPagamento p={p} /></td>
                <td className="px-4 py-3 text-right">
                  {p.bloqueado ? (
                    <Lock size={14} className="text-gray-300 inline" title={p.motivo_bloqueio} />
                  ) : can("encomendas", "edit") ? (
                    <Pencil size={14} className="text-gray-400 inline" />
                  ) : null}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Sem pagamentos.</td></tr>}
          </tbody>
        </table>
      </ScrollableTable>

      <MobileCards testid="pagamentos-cards">
        {items.map((p) => (
          <MobileCard key={`${p.encomenda_id}-${p.id}`} testid={`pagamento-card-${p.id}`} onClick={() => setAberto(p)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{p.cliente}</div>
                <div className="text-xs text-gray-500 mono mt-0.5">{p.encomenda_numero} · {p.recibo_numero || "—"}</div>
              </div>
              {linhaValor(p)}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
              <span>{p.data ? fmtDate(p.data) : "—"} · {p.metodo_label}</span>
              <FaturaPagamento p={p} />
            </div>
          </MobileCard>
        ))}
        {items.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">Sem pagamentos.</div>
        )}
      </MobileCards>

      <PagamentoDialog
        pagamento={aberto}
        onClose={() => setAberto(null)}
        onChanged={async (atualizado) => {
          if (atualizado) setAberto(atualizado);
          await reload();
        }}
      />
    </ListPage>
  );
}

