import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import ListPagination, { DEFAULT_PAGE_SIZE } from "@/components/ListPagination";

export default function SeccaoPesquisavel({
  title,
  icon: Icon,
  rows,
  searchKeys = [],
  placeholder = "Pesquisar...",
  testid,
  children,
  className = "mb-6",
  pageSize: initialPageSize = DEFAULT_PAGE_SIZE,
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const ql = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const all = rows || [];
    if (!ql) return all;
    const prefixKeys = new Set(["nome", "cliente", "cliente_nome", "artigo_nome"]);
    return all.filter((r) =>
      searchKeys.some((k) => {
        const val = String(r[k] ?? "").toLowerCase();
        return prefixKeys.has(k) ? val.startsWith(ql) : val.includes(ql);
      }),
    );
  }, [rows, ql, searchKeys]);

  useEffect(() => {
    setPage(1);
  }, [q, pageSize, rows]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeLabel =
    total === 0
      ? "0 resultados"
      : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, total)} de ${total}`;

  return (
    <section className={className} data-testid={testid}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          {Icon && <Icon size={15} />} {title}
          <span className="text-gray-400 font-normal">({(rows || []).length})</span>
        </h2>
        {(rows || []).length > 0 && (
          <div className="relative sm:w-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid={testid ? `${testid}-search` : undefined}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-100 border border-transparent rounded-sm focus:bg-white focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
        )}
      </div>
      {children(pageRows)}
      <ListPagination
        page={safePage}
        pages={pages}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rangeLabel={rangeLabel}
        testid={testid ? `${testid}-pagination` : "seccao-pagination"}
      />
    </section>
  );
}
