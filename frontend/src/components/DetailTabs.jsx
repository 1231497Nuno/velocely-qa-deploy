import { useSearchParams } from "react-router-dom";

export function useDetailTab(allowed, defaultTab) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const tab = allowed.includes(raw) ? raw : defaultTab;
  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (!next || next === defaultTab) params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };
  return [tab, setTab];
}

export default function DetailTabs({ tabs, value, onChange, testid = "detail-tabs" }) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 mb-4 overflow-x-auto" data-testid={testid}>
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            data-testid={t.testid || `detail-tab-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap ${
              active ? "border-black text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
