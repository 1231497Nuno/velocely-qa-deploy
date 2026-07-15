import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export function useSort(defaultKey = null, defaultDir = "asc") {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const apply = (arr) => {
    if (!sort.key) return arr;
    const sorted = [...arr].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), "pt", { numeric: true });
    });
    return sort.dir === "asc" ? sorted : sorted.reverse();
  };
  return { sort, toggle, apply };
}

export function SortTh({ label, sortKey, sort, onSort, align = "left", className = "" }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 text-${align} ${className}`}>
      <button
        data-testid={`sort-${sortKey}`}
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 transition-colors ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon size={12} className={active ? "text-gray-900" : "text-gray-300"} />
      </button>
    </th>
  );
}
