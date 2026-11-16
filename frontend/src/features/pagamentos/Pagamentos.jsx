import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, MobileCards, MobileCard, TABLE_HEAD_STICKY } from "@/components/ListPage";
import MobileFiltersButton from "@/components/MobileFiltersButton";
import { FiltroChip, FiltroGrupo, FiltroSelect } from "@/components/Filtros";
import StatusBadge from "@/components/StatusBadge";
import { useSort, SortTh } from "@/components/table";
import { BarChart3, ChevronDown, ChevronRight, FileText, List, Lock, Undo2, Users } from "lucide-react";
import { METODOS_PAGAMENTO } from "@/features/pagamentos/metodos";

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

function Kpi({ label, valor, destaque = false, cor = "", testid }) {
  return (
    <div className="bg-white border border-gray-200 rounded-sm px-4 py-3 min-w-0" data-testid={testid}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${cor || (destaque ? "text-amber-700" : "text-gray-900")}`}>{valor}</div>
    </div>
  );
}

function VistaToggle({ vista, setVista }) {
  const b = (id, label, Icon) => (
    <button type="button" onClick={() => setVista(id)} data-testid={`pag-vista-${id}`}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-sm ${vista === id ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-900"}`}>
      <Icon size={15} /> {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 rounded-sm bg-gray-100 p-0.5">
      {b("lista", "Pagamentos", List)}
      {b("clientes", "Por cliente", Users)}
    </div>
  );
}

export default function Pagamentos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const vista = searchParams.get("vista") === "clientes" ? "clientes" : "lista";
  const setVista = (v) => setSearchParams(v === "clientes" ? { vista: v } : {}, { replace: true });
  return (
    <>
      {vista === "clientes" ? <PorCliente vista={vista} setVista={setVista} /> : <ListaPagamentos vista={vista} setVista={setVista} />}
    </>
  );
}

function Acoes({ vista, setVista }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <VistaToggle vista={vista} setVista={setVista} />
      <Link to="/relatorios?r=recebimentos_metodo" className="btn btn-secundario" data-testid="pag-relatorios"><BarChart3 size={15} /> Relatórios</Link>
    </div>
  );
}

function ListaPagamentos({ vista, setVista }) {
  const nav = useNavigate();
  const [faturado, setFaturado] = useState("");
  const [metodo, setMetodo] = useState("");
  const [tipo, setTipo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const { sort, toggle, apply } = useSort();

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
    q, setQ, rangeLabel, extra,
  } = useServerPagedList("/pagamentos", { extraParams });
  const rows = apply(items);
  const resumo = extra?.resumo || {};
  const nFiltros = (faturado ? 1 : 0) + (metodo ? 1 : 0) + (tipo ? 1 : 0) + (de ? 1 : 0) + (ate ? 1 : 0);
  const limpar = () => { setFaturado(""); setMetodo(""); setTipo(""); setDe(""); setAte(""); };
  const abrir = (p) => nav(`/pagamentos/${p.encomenda_id}/${p.id}`);

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
          subtitle="Todos os pagamentos das encomendas. Abra um pagamento para o editar ou emitir a fatura."
          actions={<Acoes vista={vista} setVista={setVista} />}
        />
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi label="Recebido" valor={eur(resumo.recebido || 0)} cor="text-emerald-700" testid="pag-kpi-recebido" />
            <Kpi label="Devolvido" valor={eur(resumo.devolvido || 0)} cor={(resumo.devolvido || 0) > 0 ? "text-red-600" : ""} testid="pag-kpi-devolvido" />
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
        <ListPagination page={page} pages={pages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} rangeLabel={rangeLabel} testid="pagamentos-pagination" />
      }
    >
      <ScrollableTable className="hidden md:flex md:flex-col">
        <table className="w-full text-sm min-w-[900px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <SortTh label="Recibo" sortKey="recibo_numero" sort={sort} onSort={toggle} />
              <SortTh label="Data" sortKey="data" sort={sort} onSort={toggle} />
              <SortTh label="Cliente" sortKey="cliente" sort={sort} onSort={toggle} />
              <SortTh label="Encomenda" sortKey="encomenda_numero" sort={sort} onSort={toggle} />
              <SortTh label="Método" sortKey="metodo_label" sort={sort} onSort={toggle} />
              <SortTh label="Valor" sortKey="valor" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Fatura" sortKey="faturado" sort={sort} onSort={toggle} />
              <SortTh label="Encomenda" sortKey="encomenda_estado" sort={sort} onSort={toggle} align="center" />
            </tr>
          </thead>
          <tbody data-testid="pagamentos-table">
            {rows.map((p) => (
              <tr key={`${p.encomenda_id}-${p.id}`} data-testid={`pagamento-row-${p.id}`} onClick={() => abrir(p)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">
                  <span className="inline-flex items-center gap-1.5">
                    {p.tipo === "devolucao" && <Undo2 size={13} className="text-red-500" title="Devolução" />}
                    {p.recibo_numero || "—"}
                    {p.bloqueado && <Lock size={12} className="text-gray-300" title={p.motivo_bloqueio} />}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{p.data ? fmtDate(p.data) : "—"}</td>
                <td className="px-4 py-3 text-gray-700 max-w-[16rem] truncate">{p.cliente}</td>
                <td className="px-4 py-3 mono">
                  <Link to={`/encomendas/${p.encomenda_id}`} onClick={(e) => e.stopPropagation()} className="text-gray-900 hover:underline">{p.encomenda_numero}</Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{p.metodo_label}</td>
                <td className="px-4 py-3 text-right">{linhaValor(p)}</td>
                <td className="px-4 py-3"><FaturaPagamento p={p} /></td>
                <td className="px-4 py-3 text-center">{p.encomenda_estado ? <StatusBadge status={p.encomenda_estado} /> : null}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Sem pagamentos.</td></tr>}
          </tbody>
        </table>
      </ScrollableTable>

      <MobileCards testid="pagamentos-cards">
        {rows.map((p) => (
          <MobileCard key={`${p.encomenda_id}-${p.id}`} testid={`pagamento-card-${p.id}`} onClick={() => abrir(p)}>
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
        {rows.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-gray-400 text-sm">Sem pagamentos.</div>
        )}
      </MobileCards>
    </ListPage>
  );
}

function PorCliente({ vista, setVista }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [situacao, setSituacao] = useState("em_falta");
  const [dados, setDados] = useState(null);
  const [abertos, setAbertos] = useState({});
  const { sort, toggle, apply } = useSort();

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      api.get(`/pagamentos/clientes?${new URLSearchParams({ q, situacao })}`).then((r) => vivo && setDados(r)).catch(() => vivo && setDados({ items: [], resumo: {} }));
    }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, situacao]);

  const items = apply(dados?.items || []);
  const resumo = dados?.resumo || {};
  const chave = (g) => g.cliente_id || g.cliente;
  const alternar = (g) => setAbertos((a) => ({ ...a, [chave(g)]: !a[chave(g)] }));

  return (
    <ListPage
      header={
        <PageHeader
          title="Pagamentos"
          subtitle="Por cliente: total das encomendas, o que já foi pago, o que falta receber e o que está por faturar."
          actions={<Acoes vista={vista} setVista={setVista} />}
        />
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi label={`Encomendas (${resumo.n_clientes || 0} clientes)`} valor={eur(resumo.total || 0)} testid="pagc-kpi-total" />
            <Kpi label="Recebido" valor={eur(resumo.pago || 0)} cor="text-emerald-700" testid="pagc-kpi-pago" />
            <Kpi label="Em falta" valor={eur(resumo.em_falta || 0)} destaque={(resumo.em_falta || 0) > 0} testid="pagc-kpi-falta" />
            <Kpi label="Por faturar" valor={eur(resumo.por_faturar || 0)} destaque={(resumo.por_faturar || 0) > 0} testid="pagc-kpi-faturar" />
          </div>
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar cliente..." testid="pagc-search" />
          <div className="flex flex-wrap gap-2">
            {[["em_falta", "Com valor em falta"], ["por_faturar", "Com pagamentos por faturar"], ["", "Todos"]].map(([id, label]) => (
              <FiltroChip key={id || "todos"} active={situacao === id} onClick={() => setSituacao(id)} count={dados?.total} testid={`pagc-filtro-${id || "todos"}`}>{label}</FiltroChip>
            ))}
          </div>
        </div>
      }
    >
      <ScrollableTable className="hidden md:flex md:flex-col">
        <table className="w-full text-sm min-w-[860px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr>
              <th className="w-8 bg-gray-50" />
              <SortTh label="Cliente" sortKey="cliente" sort={sort} onSort={toggle} />
              <SortTh label="Encomendas" sortKey="n_encomendas" sort={sort} onSort={toggle} align="center" />
              <SortTh label="Total" sortKey="total" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Recebido" sortKey="pago" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Em falta" sortKey="em_falta" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Por faturar" sortKey="por_faturar" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Último pagamento" sortKey="ultimo_pagamento" sort={sort} onSort={toggle} />
            </tr>
          </thead>
          <tbody data-testid="pagc-table">
            {items.map((g) => {
              const aberto = !!abertos[chave(g)];
              return (
                <Fragment key={chave(g)}>
                  <tr onClick={() => alternar(g)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" data-testid={`pagc-row-${chave(g)}`}>
                    <td className="pl-4 py-3 text-gray-400">{aberto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {g.cliente_id ? <Link to={`/clientes/${g.cliente_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{g.cliente}</Link> : g.cliente}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-gray-700">{g.n_encomendas}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">{eur(g.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{eur(g.pago)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${g.em_falta > 0.009 ? "text-amber-700" : "text-gray-400"}`}>{eur(g.em_falta)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${g.por_faturar > 0.009 ? "text-amber-700" : "text-gray-400"}`}>{eur(g.por_faturar)}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{g.ultimo_pagamento ? fmtDate(g.ultimo_pagamento) : "—"}</td>
                  </tr>
                  {aberto && g.encomendas.map((e) => (
                    <tr key={e.id} onClick={() => nav(`/encomendas/${e.id}?tab=pagamentos`)} className="border-b border-gray-100 bg-gray-50/70 hover:bg-gray-100 cursor-pointer text-[13px]">
                      <td />
                      <td className="px-4 py-2 pl-8">
                        <span className="mono text-gray-900">{e.numero}</span>
                        <span className="ml-2"><StatusBadge status={e.estado} /></span>
                      </td>
                      <td className="px-4 py-2 text-center"><StatusBadge status={e.status_pagamento} /></td>
                      <td className="px-4 py-2 text-right tabular-nums">{eur(e.total)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{eur(e.pago)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${e.em_falta > 0.009 ? "text-amber-700 font-medium" : "text-gray-400"}`}>{eur(e.em_falta)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${e.por_faturar > 0.009 ? "text-amber-700" : "text-gray-400"}`}>{eur(e.por_faturar)}</td>
                      <td className="px-4 py-2 tabular-nums text-gray-600">{e.ultimo_pagamento ? fmtDate(e.ultimo_pagamento) : <span className="text-gray-400">sem pagamentos</span>}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {dados && items.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Sem clientes nesta situação.</td></tr>}
            {!dados && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">A carregar...</td></tr>}
          </tbody>
        </table>
      </ScrollableTable>

      <MobileCards testid="pagc-cards">
        {items.map((g) => (
          <MobileCard key={chave(g)} onClick={() => alternar(g)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{g.cliente}</div>
                <div className="text-xs text-gray-500">{g.n_encomendas} encomenda(s) · {eur(g.total)}</div>
              </div>
              <div className="text-right">
                <div className={`tabular-nums font-semibold ${g.em_falta > 0.009 ? "text-amber-700" : "text-emerald-700"}`}>{eur(g.em_falta)}</div>
                <div className="text-[11px] text-gray-500">em falta</div>
              </div>
            </div>
            {abertos[chave(g)] && (
              <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                {g.encomendas.map((e) => (
                  <button key={e.id} type="button" onClick={(ev) => { ev.stopPropagation(); nav(`/encomendas/${e.id}?tab=pagamentos`); }} className="w-full flex items-center justify-between text-xs py-1">
                    <span className="mono">{e.numero}</span>
                    <span className="tabular-nums">{eur(e.pago)} / {eur(e.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </MobileCard>
        ))}
      </MobileCards>
    </ListPage>
  );
}
