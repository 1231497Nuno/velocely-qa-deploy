import { useNavigate } from "react-router-dom";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import SearchBar from "@/components/SearchBar";
import ExportExcelButton from "@/components/ExportExcelButton";
import ListPagination, { useServerPagedList } from "@/components/ListPagination";
import { ListPage, ScrollableTable, TABLE_HEAD_STICKY } from "@/components/ListPage";
import { useSort, SortTh } from "@/components/table";
import { Plus, Pencil, Trash2, Copy, Settings, Eye } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import ImagemUpload from "@/components/ImagemUpload";
import ArtigosDiversosConfig from "@/components/ArtigosDiversosConfig";
import UtilizacoesDialog from "@/components/UtilizacoesDialog";
import Combobox from "@/components/Combobox";
import { TIPOS_ARTIGO, TIPO_ARTIGO_PT, normalizarTipo, isProduzido, isMateriaPrima } from "@/features/artigos/artigoTipos";
import { unidadeMedida } from "@/features/artigos/artigoCustoPlaca";

const filtroCls = "w-[11.5rem] sm:w-[13rem]";

export default function Artigos() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroSubcategoria, setFiltroSubcategoria] = useState("");
  const [filtroProduzido, setFiltroProduzido] = useState("");
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);

  const extraParams = useMemo(() => {
    const p = {};
    if (filtroTipo) p.tipo = filtroTipo;
    if (filtroCategoria) p.categoria_id = filtroCategoria;
    if (filtroSubcategoria) p.subcategoria_id = filtroSubcategoria;
    if (filtroProduzido) p.produzido = filtroProduzido;
    return p;
  }, [filtroTipo, filtroCategoria, filtroSubcategoria, filtroProduzido]);

  const {
    items, total, pages, page, setPage, pageSize, setPageSize,
    q, setQ, reload, rangeLabel, loading,
  } = useServerPagedList("/artigos", { extraParams });
  const [diversosOpen, setDiversosOpen] = useState(false);
  const [uso, setUso] = useState(null);
  const { sort, toggle, apply } = useSort();

  useEffect(() => {
    (async () => {
      try {
        const [cats, subs] = await Promise.all([
          api.get("/categorias"),
          api.get("/subcategorias"),
        ]);
        setCategorias(Array.isArray(cats) ? cats : cats?.items || []);
        setSubcategorias(Array.isArray(subs) ? subs : subs?.items || []);
      } catch {
        /* filtros opcionais */
      }
    })();
  }, []);

  const subsFiltradas = useMemo(
    () => (filtroCategoria
      ? subcategorias.filter((s) => s.categoria_id === filtroCategoria)
      : subcategorias),
    [subcategorias, filtroCategoria],
  );

  const tipoOptions = useMemo(
    () => [
      { value: "", label: "Todos os tipos" },
      ...TIPOS_ARTIGO.map((t) => ({ value: t.id, label: t.label })),
    ],
    [],
  );
  const categoriaOptions = useMemo(
    () => [
      { value: "", label: "Todas as categorias" },
      ...categorias.map((c) => ({ value: c.id, label: c.nome })),
    ],
    [categorias],
  );
  const subcategoriaOptions = useMemo(
    () => [
      { value: "", label: "Todas as subcategorias" },
      ...subsFiltradas.map((s) => ({ value: s.id, label: s.nome })),
    ],
    [subsFiltradas],
  );
  const produzidoOptions = useMemo(
    () => [
      { value: "", label: "Produzido / compra" },
      { value: "sim", label: "Só produzidos" },
      { value: "nao", label: "Só compra / sem receita" },
    ],
    [],
  );

  const temFiltros = !!(filtroTipo || filtroCategoria || filtroSubcategoria || filtroProduzido);

  const limparFiltros = () => {
    setFiltroTipo("");
    setFiltroCategoria("");
    setFiltroSubcategoria("");
    setFiltroProduzido("");
  };

  const onCategoriaChange = (id) => {
    setFiltroCategoria(id || "");
    if (filtroSubcategoria) {
      if (!id) return;
      const ok = subcategorias.some((s) => s.id === filtroSubcategoria && s.categoria_id === id);
      if (!ok) setFiltroSubcategoria("");
    }
  };

  const remove = async (id) => {
    await api.del(`/artigos/${id}`);
    toast.success("Artigo eliminado");
    reload();
  };

  const duplicar = async (id) => {
    const novo = await api.post(`/artigos/${id}/duplicar`);
    toast.success("Artigo duplicado");
    if (novo?.id) nav(`/artigos/${novo.id}`);
    else reload();
  };

  const rows = apply(items);

  return (
    <>
    <ListPage
      header={
        <PageHeader
          title="Artigos"
          subtitle="Tipos de artigo com regras próprias — venda, produção, matéria-prima e serviços"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              {can("artigos", "edit") && (
                <button
                  type="button"
                  data-testid="artigos-diversos-config-btn"
                  onClick={() => setDiversosOpen(true)}
                  className="inline-flex items-center gap-1.5 bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-2 text-sm font-medium"
                >
                  <Settings size={16} /> Diversos
                </button>
              )}
              <ExportExcelButton path="/export/artigos" filename="artigos.xlsx" />
              {can("artigos", "create") && (
                <button
                  data-testid="add-artigo-btn"
                  onClick={() => nav("/artigos/novo")}
                  className="inline-flex items-center gap-1.5 bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-2 text-sm font-medium"
                >
                  <Plus size={16} /> Novo Artigo
                </button>
              )}
            </div>
          }
        />
      }
      toolbar={
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <SearchBar
              value={q}
              onChange={setQ}
              placeholder="Pesquisar por código ou nome (qualquer parte)…"
              testid="search-artigos"
            />
            <div className="text-xs text-gray-500 sm:ml-auto">{loading ? "A carregar…" : rangeLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              testid="artigos-filtro-tipo"
              optionTestidPrefix="artigos-filtro-tipo"
              options={tipoOptions}
              value={filtroTipo}
              onChange={(v) => setFiltroTipo(v || "")}
              placeholder="Todos os tipos"
              searchPlaceholder="Escrever para filtrar tipo…"
              matchPrefix={false}
              className={filtroCls}
            />
            <Combobox
              testid="artigos-filtro-categoria"
              optionTestidPrefix="artigos-filtro-categoria"
              options={categoriaOptions}
              value={filtroCategoria}
              onChange={onCategoriaChange}
              placeholder="Todas as categorias"
              searchPlaceholder="Escrever para filtrar categoria…"
              matchPrefix={false}
              className={filtroCls}
            />
            <Combobox
              testid="artigos-filtro-subcategoria"
              optionTestidPrefix="artigos-filtro-subcategoria"
              options={subcategoriaOptions}
              value={filtroSubcategoria}
              onChange={(v) => setFiltroSubcategoria(v || "")}
              placeholder="Todas as subcategorias"
              searchPlaceholder="Escrever para filtrar subcategoria…"
              matchPrefix={false}
              className={filtroCls}
            />
            <Combobox
              testid="artigos-filtro-produzido"
              optionTestidPrefix="artigos-filtro-produzido"
              options={produzidoOptions}
              value={filtroProduzido}
              onChange={(v) => setFiltroProduzido(v || "")}
              placeholder="Produzido / compra"
              searchPlaceholder="Escrever para filtrar…"
              matchPrefix={false}
              className={filtroCls}
            />
            {temFiltros && (
              <button
                type="button"
                data-testid="artigos-limpar-filtros"
                onClick={limparFiltros}
                className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-sm hover:bg-gray-50"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      }
      footer={
        <ListPagination
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          testid="artigos"
        />
      }
    >
      <ScrollableTable>
        <table className="w-full text-sm min-w-[960px]">
          <thead className={TABLE_HEAD_STICKY}>
            <tr className="border-b border-gray-200 bg-gray-50">
              <SortTh label="Código" sortKey="codigo" sort={sort} onSort={toggle} />
              <SortTh label="Nome" sortKey="nome" sort={sort} onSort={toggle} />
              <SortTh label="Tipo" sortKey="tipo_artigo" sort={sort} onSort={toggle} />
              <SortTh label="Categoria" sortKey="categoria_nome" sort={sort} onSort={toggle} />
              <SortTh label="Subcategoria" sortKey="subcategoria_nome" sort={sort} onSort={toggle} />
              <SortTh label="Custo" sortKey="custo_producao_total" sort={sort} onSort={toggle} align="right" />
              <SortTh label="Preço" sortKey="preco_venda" sort={sort} onSort={toggle} align="right" />
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const tipo = normalizarTipo(a);
              const prod = tipo === "ativo" && isProduzido(a);
              const un = unidadeMedida(a);
              return (
                <tr
                  key={a.id}
                  data-testid={`artigo-row-${a.id}`}
                  onClick={() => nav(`/artigos/${a.id}`)}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 mono tabular-nums text-gray-600">{a.codigo}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <ImagemUpload value={a.imagem} editable={false} size={40} testid={`artigo-row-imagem-${a.id}`} />
                      <span data-testid={`artigo-nome-link-${a.id}`} className="font-medium text-gray-900 truncate">{a.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {TIPO_ARTIGO_PT[tipo] || tipo}
                    {prod ? <span className="text-gray-400"> · produzido</span> : null}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{a.categoria_nome || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{a.subcategoria_nome || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {eur(a.custo_producao_total ?? a.custo_artigo)}
                    <span className="text-gray-400 text-xs ml-1">/ {un}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-700">
                    {eur(a.preco_venda)}
                    <span className="text-gray-400 font-normal text-xs ml-1">/ {un}</span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      {isMateriaPrima(a) && (
                        <button
                          data-testid={`uso-artigo-${a.id}`}
                          onClick={() => setUso({
                            endpoint: `/artigos/${a.id}/utilizacoes`,
                            titulo: `Onde é usado: ${a.nome}`,
                            subtitulo: "Artigos produzidos que usam esta matéria-prima na receita.",
                          })}
                          title="Onde é usado"
                          className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500"
                        >
                          <Eye size={15} />
                        </button>
                      )}
                      {can("artigos", "create") && (
                        <button data-testid={`dup-artigo-${a.id}`} onClick={() => duplicar(a.id)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600" title="Duplicar">
                          <Copy size={15} />
                        </button>
                      )}
                      {can("artigos", "edit") && (
                        <button data-testid={`edit-artigo-${a.id}`} onClick={() => nav(`/artigos/${a.id}`)} className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-600" title="Abrir">
                          <Pencil size={15} />
                        </button>
                      )}
                      {can("artigos", "delete") && (
                        <button data-testid={`delete-artigo-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">{loading ? "A carregar…" : "Sem artigos."}</td></tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </ListPage>

    <ArtigosDiversosConfig open={diversosOpen} onOpenChange={setDiversosOpen} onSaved={reload} />
    <UtilizacoesDialog
      open={!!uso}
      onOpenChange={(v) => !v && setUso(null)}
      endpoint={uso?.endpoint}
      titulo={uso?.titulo}
      subtitulo={uso?.subtitulo}
    />
    </>
  );
}
