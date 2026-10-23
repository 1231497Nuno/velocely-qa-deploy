/** Badge compacto para ícones do header (cap 99+). */
export function formatHeaderBadge(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v <= 0) return null;
  if (v > 99) return "99+";
  return String(v);
}

export default function HeaderIconBadge({ count, critical = false, testid }) {
  const label = formatHeaderBadge(count);
  if (!label) return null;
  return (
    <span
      data-testid={testid}
      className={`absolute top-0.5 right-0.5 text-[9px] leading-none font-bold tabular-nums rounded-full min-w-[1.05rem] h-[1.05rem] px-0.5 inline-flex items-center justify-center ring-2 ring-white ${
        critical ? "bg-red-500 text-white" : "bg-amber-400 text-gray-900"
      }`}
    >
      {label}
    </span>
  );
}

export const HEADER_ICON_BTN =
  "relative inline-flex items-center justify-center h-10 w-10 rounded-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 shrink-0";
