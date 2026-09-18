import { useEffect, useState, useRef } from "react";

const fieldCls = "w-full border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";

/** Largura em `ch` conforme o texto, com mínimo/máximo (inclui margem para padding). */
export function contentWidthCh(value, { min = 4, max = 16, pad = 2.5 } = {}) {
  const len = String(value ?? "").length + pad;
  return `${Math.min(max, Math.max(min, len))}ch`;
}

const fitInputCls = "border border-gray-300 rounded-sm px-2 py-1.5 text-sm bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const fitSelectCls = "border border-gray-300 rounded-sm pl-1.5 pr-1 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";

/** Clique → edita; blur/Enter → grava. */
export function InlineField({
  value,
  display,
  canEdit,
  onSave,
  type = "text",
  placeholder = "—",
  testid,
  mono = false,
  multiline = false,
  className = "",
  align = "right",
  fit = false,
  fitMin = 4,
  fitMax = 16,
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  const ref = useRef(null);
  const textAlign = align === "left" ? "text-left" : "text-right";
  const fitOpts = { min: fitMin, max: fitMax, pad: 2.5 };
  const widthStyle = fit
    ? { width: contentWidthCh(open ? local : (display ?? value ?? ""), fitOpts), maxWidth: `${fitMax}ch`, minWidth: `${fitMin}ch` }
    : undefined;
  const boxCls = fit ? `${fitInputCls} ${textAlign}` : fieldCls;

  useEffect(() => {
    if (!open) setLocal(value ?? "");
  }, [value, open]);

  useEffect(() => {
    if (open && ref.current) {
      ref.current.focus();
      if (ref.current.select) ref.current.select();
    }
  }, [open]);

  const commit = () => {
    setOpen(false);
    const next = type === "number" ? local : String(local ?? "");
    const prev = type === "number" ? value : String(value ?? "");
    if (String(next) !== String(prev ?? "")) onSave(next);
  };

  const shown = display ?? (value === 0 || value ? value : null);
  if (open) {
    return multiline ? (
      <textarea
        ref={ref}
        data-testid={testid ? `${testid}-input` : undefined}
        rows={3}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Escape") { setLocal(value ?? ""); setOpen(false); } }}
        className={`${boxCls} text-left ${fit ? "" : "w-full"}`}
        style={widthStyle}
      />
    ) : (
      <input
        ref={ref}
        data-testid={testid ? `${testid}-input` : undefined}
        type={type === "number" ? "number" : "text"}
        step={type === "number" ? "0.01" : undefined}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setLocal(value ?? ""); setOpen(false); }
        }}
        className={`${fit ? fitInputCls : fieldCls} ${textAlign} ${mono ? "tabular-nums" : ""} ${fit ? "" : "w-full"}`}
        style={widthStyle}
      />
    );
  }

  if (canEdit) {
    return (
      <button
        type="button"
        title="Clique para editar"
        data-testid={testid}
        onClick={() => setOpen(true)}
        style={widthStyle}
        className={`${textAlign} font-medium rounded-sm px-1 py-0.5 hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 cursor-text break-words ${fit ? "w-auto inline-block" : "w-full min-w-[2rem] -mx-1"} ${mono ? "tabular-nums" : ""} ${className || "text-gray-900"}`}
      >
        {shown == null || shown === "" ? <span className="opacity-50">{placeholder}</span> : shown}
      </button>
    );
  }

  return (
    <span
      data-testid={testid}
      style={widthStyle}
      className={`${textAlign} font-medium break-words ${fit ? "inline-block" : "block"} ${mono ? "tabular-nums" : ""} ${className || "text-gray-900"}`}
    >
      {shown == null || shown === "" ? placeholder : shown}
    </span>
  );
}

export function InlineSelect({
  value,
  display,
  options,
  canEdit,
  onSave,
  emptyLabel = "— Sem —",
  allowEmpty = true,
  disabled = false,
  testid,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (open && ref.current) ref.current.focus();
  }, [open]);

  const shown = display || null;

  if (!canEdit || disabled) {
    return <span data-testid={testid} className="text-right font-medium text-gray-900 block">{shown || "—"}</span>;
  }

  if (open) {
    return (
      <select
        ref={ref}
        data-testid={testid ? `${testid}-select` : undefined}
        value={value || ""}
        onChange={(e) => {
          const v = e.target.value;
          setOpen(false);
          if (v !== (value || "")) onSave(v);
        }}
        onBlur={() => setOpen(false)}
        className={`${fieldCls} text-right max-w-full`}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <button
      type="button"
      title="Clique para editar"
      data-testid={testid}
      onClick={() => setOpen(true)}
      className="text-right font-medium text-gray-900 rounded-sm px-1 -mx-1 py-0.5 hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 cursor-pointer min-w-[2rem] w-full"
    >
      {shown ? shown : <span className="text-gray-400">—</span>}
    </button>
  );
}

export { fieldCls, fitInputCls, fitSelectCls };
