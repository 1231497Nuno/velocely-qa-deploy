import { useState } from "react";
import { Search } from "lucide-react";

export default function SeccaoPesquisavel({ title, icon: Icon, rows, searchKeys = [], placeholder = "Pesquisar...", testid, children, className = "mb-6" }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? (rows || []).filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(ql)))
    : (rows || []);
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
      {children(filtered)}
    </section>
  );
}
