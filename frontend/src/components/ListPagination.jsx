import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100];

/** Normaliza resposta: array legado → { items, total, ... } ou payload paginado. */
export function normalizePage(data, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  if (Array.isArray(data)) {
    return {
      items: data,
      total: data.length,
      page: 1,
      page_size: data.length || pageSize,
      pages: 1,
      legacy: true,
    };
  }
  return {
    items: data?.items || [],
    total: data?.total ?? 0,
    page: data?.page ?? page,
    page_size: data?.page_size ?? pageSize,
    pages: data?.pages ?? 1,
    legacy: false,
  };
}

export function buildListUrl(path, { page, pageSize, q, paginate = true, ...extra } = {}) {
  const params = new URLSearchParams();
  if (paginate && page != null) params.set("page", String(page));
  if (paginate && pageSize != null) params.set("page_size", String(pageSize));
  if (q && String(q).trim()) params.set("q", String(q).trim());
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (v != null && v !== "" && v !== false) params.set(k, String(v));
  });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Hook de listagem paginada no servidor.
 * - Envia page/page_size (salvo paginate=false para kanban/legado)
 * - Debounce na pesquisa `q`
 * - `extraParams` deve ser estável (useMemo no caller)
 */
export function useServerPagedList(
  path,
  {
    pageSize: initialSize = DEFAULT_PAGE_SIZE,
    extraParams = null,
    enabled = true,
    paginate = true,
  } = {},
) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [extra, setExtra] = useState({});
  const reqIdRef = useRef(0);

  const extraKey = JSON.stringify(extraParams || {});

  // Pesquisa em tempo real: debounce curto para não spammar a API a cada tecla
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [qDebounced, pageSize, extraKey, paginate]);

  useEffect(() => {
    setPageSize(initialSize);
  }, [initialSize]);

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const extra = extraParams ? { ...extraParams } : {};
      const url = buildListUrl(path, {
        page,
        pageSize,
        q: qDebounced,
        paginate,
        ...extra,
      });
      const data = await api.get(url);
      if (reqId !== reqIdRef.current) return; // resposta antiga — ignorar
      const norm = normalizePage(data, page, pageSize);
      setItems(norm.items);
      setTotal(norm.total);
      setPages(norm.pages);
      if (!Array.isArray(data) && data && typeof data === "object") {
        const { items: _i, total: _t, page: _p, page_size: _ps, pages: _pg, ...rest } = data;
        setExtra(rest);
      } else {
        setExtra({});
      }
      if (!norm.legacy && paginate && norm.page !== page) setPage(norm.page);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(e);
      setItems([]);
      setTotal(0);
      setPages(1);
      setExtra({});
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [path, page, pageSize, qDebounced, enabled, paginate, extraKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const rangeLabel = useMemo(() => {
    if (total === 0) return "0 resultados";
    if (!paginate) return `${total} resultados`;
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return `${from}–${to} de ${total}`;
  }, [page, pageSize, total, paginate]);

  return {
    items,
    total,
    pages,
    page,
    setPage,
    pageSize,
    setPageSize,
    q,
    setQ,
    loading,
    error,
    reload: load,
    rangeLabel,
    extra,
  };
}

export default function ListPagination({
  page,
  pages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  rangeLabel,
  testid = "list-pagination",
  compact = false,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}) {
  if (total === 0 && pages <= 1) return null;

  const canPrev = page > 1;
  const canNext = page < pages;

  return (
    <div
      data-testid={testid}
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1 text-sm text-gray-600 ${
        compact ? "py-1.5" : "py-3 gap-3"
      }`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`tabular-nums text-gray-500 ${compact ? "text-xs" : ""}`} data-testid={`${testid}-range`}>
          {rangeLabel || `${total} resultados`}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Por página
            <select
              data-testid={`${testid}-size`}
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className={`border border-gray-300 rounded-sm bg-white focus:outline-none focus:ring-1 focus:ring-black/20 ${
                compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"
              }`}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid={`${testid}-prev`}
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          className={`inline-flex items-center gap-1 border border-gray-300 rounded-sm hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none ${
            compact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5"
          }`}
        >
          <ChevronLeft size={14} /> Anterior
        </button>
        <span className={`px-2 tabular-nums text-gray-500 ${compact ? "text-xs" : ""}`} data-testid={`${testid}-page`}>
          {page} / {pages}
        </span>
        <button
          type="button"
          data-testid={`${testid}-next`}
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className={`inline-flex items-center gap-1 border border-gray-300 rounded-sm hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none ${
            compact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5"
          }`}
        >
          Seguinte <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
