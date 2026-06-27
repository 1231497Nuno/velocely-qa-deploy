import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, eur } from "../lib/api";
import { PageHeader } from "../components/Layout";
import {
  Boxes,
  Cog,
  Palette,
  FileText,
  Factory,
  TrendingUp,
  CheckCircle2,
  Hammer,
} from "lucide-react";

const Stat = ({ icon: Icon, label, value, sub, tid }) => (
  <div
    data-testid={tid}
    className="bg-white border border-gray-200 rounded-sm p-5 flex flex-col gap-3"
  >
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">
        {label}
      </span>
      <Icon size={18} className="text-gray-400" strokeWidth={1.8} />
    </div>
    <div className="text-3xl font-bold tracking-tight tabular-nums font-display text-gray-900">
      {value}
    </div>
    {sub && <div className="text-xs text-gray-500">{sub}</div>}
  </div>
);

export default function Dashboard() {
  const [d, setD] = useState(null);

  const load = async () => setD(await api.get("/dashboard"));

  useEffect(() => {
    load();
  }, []);

  const seed = async () => {
    await api.post("/seed");
    load();
  };

  if (!d) return <div className="text-sm text-gray-500">A carregar...</div>;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral de orçamentos, ordens de fabrico e custos"
        actions={
          d.total_artigos === 0 ? (
            <button
              data-testid="seed-btn"
              onClick={seed}
              className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium transition-colors"
            >
              Criar dados demo
            </button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat icon={Boxes} label="Artigos" value={d.total_artigos} sub={`Custo médio ${eur(d.custo_medio)}`} tid="stat-artigos" />
        <Stat icon={Cog} label="Máquinas" value={d.total_maquinas} tid="stat-maquinas" />
        <Stat icon={Palette} label="Tipos Pers." value={d.total_tipos} tid="stat-tipos" />
        <Stat icon={TrendingUp} label="Valor Orçamentos" value={eur(d.valor_orcamentos)} tid="stat-valor" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-gray-700" />
            <h2 className="text-xl font-semibold tracking-tight font-display">Orçamentos</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-3xl font-bold tabular-nums font-display">{d.total_orcamentos}</div>
              <div className="text-xs text-gray-500 mt-1">Total emitidos</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums font-display text-emerald-600">{d.orcamentos_aceites}</div>
              <div className="text-xs text-gray-500 mt-1">Aceites</div>
            </div>
          </div>
          <Link to="/orcamentos" data-testid="goto-orcamentos" className="inline-block mt-5 text-sm font-medium text-gray-900 underline underline-offset-4">
            Ver orçamentos →
          </Link>
        </div>

        <div className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Factory size={18} className="text-gray-700" />
            <h2 className="text-xl font-semibold tracking-tight font-display">Ordens de Fabrico</h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-3xl font-bold tabular-nums font-display">{d.total_ofs}</div>
              <div className="text-xs text-gray-500 mt-1">Total</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums font-display text-blue-600 flex items-center gap-1">
                <Hammer size={20} /> {d.ofs_em_producao}
              </div>
              <div className="text-xs text-gray-500 mt-1">Em produção</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums font-display text-emerald-600 flex items-center gap-1">
                <CheckCircle2 size={20} /> {d.ofs_concluidas}
              </div>
              <div className="text-xs text-gray-500 mt-1">Concluídas</div>
            </div>
          </div>
          <Link to="/ordens-fabrico" data-testid="goto-ofs" className="inline-block mt-5 text-sm font-medium text-gray-900 underline underline-offset-4">
            Ver ordens de fabrico →
          </Link>
        </div>
      </div>
    </div>
  );
}
