import { ArrowLeft } from "lucide-react";

/**
 * Barra sticky de detalhe: identificação + ações ficam visíveis ao fazer scroll.
 * Alinha sob a top-bar da app (top-14).
 */
export function StickyDetailHeader({
  back,
  title,
  badges,
  subtitle,
  meta,
  actions,
  children,
  className = "",
}) {
  return (
    <div
      className={`sticky top-14 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2.5 mb-4 bg-white/95 backdrop-blur border-b border-gray-200 ${className}`}
      data-testid="sticky-detail-header"
    >
      <div className="max-w-[1400px] mx-auto flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2 sm:gap-3">
            {back}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {typeof title === "string" ? (
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight font-display mono">{title}</h1>
                ) : (
                  title
                )}
                {badges}
              </div>
              {subtitle ? (
                typeof subtitle === "string" ? (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>
                ) : (
                  <div className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</div>
                )
              ) : null}
            </div>
          </div>
          {actions ? (
            <div className="flex items-center gap-2 shrink-0 flex-wrap sm:justify-end">{actions}</div>
          ) : null}
        </div>
        {meta}
        {children}
      </div>
    </div>
  );
}

export function StickyBackButton({ onClick, testid, label = "Voltar" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="shrink-0 p-1.5 rounded-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100"
      title={label}
      aria-label={label}
    >
      <ArrowLeft size={16} />
    </button>
  );
}
