import { Search } from "lucide-react";

export default function SearchBar({ value, onChange, placeholder = "Pesquisar...", testid = "search-input" }) {
  return (
    <div className="relative mb-4">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full sm:max-w-md border border-gray-300 rounded-sm pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
      />
    </div>
  );
}
