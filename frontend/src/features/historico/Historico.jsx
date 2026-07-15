import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import {
  Plus, Pencil, Trash2, ArrowRightLeft, Wallet, ShieldCheck, Star,
  CheckCircle2, GitFork, Copy, History, StickyNote, Clock, User, Search,
} from "lucide-react";

const ICONS = {
  criado: Plus, editado: Pencil, eliminado: Trash2, estado_alterado: ArrowRightLeft,
  pagamento: Wallet, producao_autorizada: ShieldCheck, prioridade: Star,
  concluido: CheckCircle2, convertido: GitFork, duplicado: Copy, nota: StickyNote, operacao: CheckCircle2,
};
const COLORS = {
  criado: "bg-emerald-100 text-emerald-700", editado: "bg-blue-100 text-blue-700",
  eliminado: "bg-red-100 text-red-700", estado_alterado: "bg-violet-100 text-violet-700",
  pagamento: "bg-amber-100 text-amber-700", producao_autorizada: "bg-teal-100 text-teal-700",
  prioridade: "bg-orange-100 text-orange-700", concluido: "bg-emerald-100 text-emerald-700",
  convertido: "bg-indigo-100 text-indigo-700", duplicado: "bg-gray-100 text-gray-700",
  nota: "bg-yellow-100 text-yellow-700",
};

const TIPOS = [
  { key: "", label: "Todos os módulos" },
  { key: "orcamento", label: "Orçamentos" },
  { key: "encomenda", label: "Encomendas" },
  { key: "ordem_fabrico", label: "Ordens de Fabrico" },
  { key: "cliente", label: "Clientes" },
  { key: "artigo", label: "Artigos" },
  { key: "consumivel", label: "Materiais" },
  { key: "maquina", label: "Máquinas" },
  { key: "mao_obra", label: "Mão de obra" },
  { key: "tipo_personalizacao", label: "Tipos de personalização" },
];

const LINKS = {
  orcamento: (id) => `/orcamentos/${id}`,
  encomenda: (id) => `/encomendas/${id}`,
  ordem_fabrico: (id) => `/ordens-fabrico/${id}`,
  cliente: (id) => `/clientes/${id}`,
};

const fmtDT = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return d; }
};

export default function Historico() {
  const [eventos, setEventos] = useState([]);
  const [tipo, setTipo] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = tipo ? `?tipo=${tipo}&limit=500` : "?limit=500";
      setEventos(await api.get(`/historico${params}`));
    } finally {
      setLoading(false);
    }
  }, [tipo]);
  useEffect(() => { load(); }, [load]);

  const filtered = eventos.filter((e) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [e.descricao, e.entidade_numero, e.utilizador_nome, e.tipo_label]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
  });

  return (
    <div>
      <PageHeader title="Histórico" subtitle="Registo de todas as alterações no sistema (auditoria)" />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="historico-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar por descrição, número, utilizador..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>
        <select
          data-testid="historico-filter-tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="border border-gray-300 rounded-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-900"
        >
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm p-5">
        {loading ? (
          <div className="text-sm text-gray-400">A carregar...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-gray-400" data-testid="historico-empty">Sem registos.</div>
        ) : (
          <ol data-testid="historico-list">
            {filtered.map((ev, idx) => {
              const Icon = ICONS[ev.acao] || History;
              const color = COLORS[ev.acao] || "bg-gray-100 text-gray-700";
              const last = idx === filtered.length - 1;
              const href = LINKS[ev.entidade_tipo]?.(ev.entidade_id);
              return (
                <li key={ev.id} data-testid={`historico-row-${ev.id}`} className="flex gap-3 pb-4 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${color}`}>
                      <Icon size={15} />
                    </span>
                    {!last && <span className="flex-1 w-px bg-gray-200 mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-sm">{ev.tipo_label}</span>
                      {href ? (
                        <Link to={href} className="text-sm text-gray-900 hover:underline">{ev.descricao || ev.acao_label}</Link>
                      ) : (
                        <span className="text-sm text-gray-900">{ev.descricao || ev.acao_label}</span>
                      )}
                    </div>
                    {ev.alteracoes && ev.alteracoes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {ev.alteracoes.map((a, i) => (
                          <li key={i} className="text-xs text-gray-500">
                            <span className="font-medium text-gray-600">{a.label}:</span>{" "}
                            <span className="line-through text-gray-400">{a.de}</span>{" → "}
                            <span className="text-gray-700">{a.para}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><User size={11} /> {ev.utilizador_nome}</span>
                      <span className="flex items-center gap-1"><Clock size={11} /> {fmtDT(ev.timestamp)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
