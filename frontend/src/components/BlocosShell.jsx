import { useRef, useState } from "react";
import { ChevronDown, GripVertical } from "lucide-react";

/**
 * Contentor de blocos colapsáveis e reordenáveis (arrastar).
 * Preferência guardada em localStorage via storageKey.
 *
 * @param {{ id: string, label: string }[]} blocks
 * @param {(id: string) => React.ReactNode} renderBlock
 * @param {string} [storageKey]
 * @param {Set<string>|string[]} [visibleIds] — se definido, só estes blocos aparecem
 * @param {string} [testid]
 */
export default function BlocosShell({
  blocks,
  renderBlock,
  storageKey,
  visibleIds,
  testid = "blocos",
}) {
  const defaultOrder = blocks.map((b) => b.id);
  const labelOf = (id) => blocks.find((b) => b.id === id)?.label || id;

  const load = () => {
    const known = new Set(defaultOrder);
    try {
      if (!storageKey) return { order: [...defaultOrder], collapsed: {} };
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { order: [...defaultOrder], collapsed: {} };
      const parsed = JSON.parse(raw);
      const order = (parsed.order || []).filter((id) => known.has(id));
      for (const id of defaultOrder) {
        if (!order.includes(id)) order.push(id);
      }
      return { order, collapsed: parsed.collapsed || {} };
    } catch {
      return { order: [...defaultOrder], collapsed: {} };
    }
  };

  const [layout, setLayout] = useState(load);
  const dragId = useRef(null);
  const [overId, setOverId] = useState(null);

  const vis = visibleIds
    ? (visibleIds instanceof Set ? visibleIds : new Set(visibleIds))
    : null;
  const order = layout.order.filter((id) => !vis || vis.has(id));

  const persist = (next) => {
    setLayout(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const toggle = (id) => {
    persist({
      ...layout,
      collapsed: { ...layout.collapsed, [id]: !layout.collapsed[id] },
    });
  };

  const onDragStart = (id) => {
    dragId.current = id;
  };

  const onDragOver = (e, id) => {
    e.preventDefault();
    if (dragId.current && dragId.current !== id) setOverId(id);
  };

  const onDrop = (id) => {
    const from = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!from || from === id) return;
    const full = [...layout.order];
    const fi = full.indexOf(from);
    const ti = full.indexOf(id);
    if (fi < 0 || ti < 0) return;
    full.splice(fi, 1);
    full.splice(ti, 0, from);
    persist({ ...layout, order: full });
  };

  const onDragEnd = () => {
    dragId.current = null;
    setOverId(null);
  };

  return (
    <div className="space-y-3" data-testid={testid}>
      {order.map((id) => {
        const open = !layout.collapsed[id];
        return (
          <section
            key={id}
            data-testid={`${testid}-${id}`}
            onDragOver={(e) => onDragOver(e, id)}
            onDrop={() => onDrop(id)}
            onDragEnd={onDragEnd}
            className={`bg-white border rounded-sm overflow-hidden transition-shadow ${
              overId === id ? "border-black ring-1 ring-black" : "border-gray-200"
            }`}
          >
            <div className="flex items-stretch border-b border-gray-200 bg-gray-50">
              <button
                type="button"
                draggable
                onDragStart={() => onDragStart(id)}
                title="Arrastar para reordenar"
                className="px-2 text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing border-r border-gray-200"
                aria-label="Reordenar bloco"
              >
                <GripVertical size={16} />
              </button>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-100/80"
              >
                <ChevronDown
                  size={16}
                  className={`text-gray-500 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
                />
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-600">
                  {labelOf(id)}
                </span>
              </button>
            </div>
            {open && (
              <div className="min-w-0">
                {renderBlock(id)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Grelha 2 colunas — linha sob cada campo + divisória vertical limpa. */
export function FieldGrid({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2">
      {children}
    </div>
  );
}

export function FieldRow({ label, children, testid, full = false }) {
  return (
    <div
      data-testid={testid}
      className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b border-gray-100 ${
        full
          ? "md:col-span-2"
          : "md:odd:border-r md:odd:border-gray-100 md:odd:pr-5 md:even:pl-5"
      }`}
    >
      <span className="text-gray-500 shrink-0">{label}</span>
      <div className="min-w-0 flex-1 flex justify-end items-center text-right font-medium text-gray-900">{children}</div>
    </div>
  );
}
