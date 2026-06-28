import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";
import { ArrowLeft, Plus, Factory, User, Mail, Phone, MapPin, Hash } from "lucide-react";
import { toast } from "sonner";

export default function EncomendaDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [enc, setEnc] = useState(null);
  const [cliente, setCliente] = useState(null);

  const load = useCallback(async () => {
    const e = await api.get(`/encomendas/${id}`);
    setEnc(e);
    if (e.cliente_id) {
      const cs = await api.get("/clientes");
      setCliente(cs.find((c) => c.id === e.cliente_id) || null);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const criarOF = async () => {
    const of = await api.post(`/encomendas/${id}/ordens-fabrico`, { cliente: enc.cliente, itens: [] });
    toast.success("Ordem de fabrico criada");
    nav(`/ordens-fabrico/${of.id}`);
  };

  if (!enc) return <div className="text-sm text-gray-500">A carregar...</div>;

  return (
    <div>
      <button onClick={() => nav("/encomendas")} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1.5 mb-4"><ArrowLeft size={15} /> Voltar às encomendas</button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display mono">{enc.numero}</h1>
            <StatusBadge status={enc.estado} />
          </div>
          <p className="text-sm text-gray-500 mt-1">Encomenda · {enc.cliente}{enc.orcamento_numero ? ` · origem ${enc.orcamento_numero}` : ""}</p>
        </div>
        {can("ordens_fabrico", "create") && (
          <button data-testid="encomenda-criar-of-btn" onClick={criarOF} className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors shrink-0"><Plus size={16} /> Criar Ordem de Fabrico</button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-sm p-5" data-testid="encomenda-cliente-info">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><User size={15} /> Cliente</h3>
          <div className="space-y-2 text-sm">
            <div className="font-medium text-gray-900">{enc.cliente}</div>
            {cliente?.contacto && <div className="text-gray-600 flex items-center gap-2"><Phone size={13} /> {cliente.contacto}</div>}
            {cliente?.email && <div className="text-gray-600 flex items-center gap-2"><Mail size={13} /> {cliente.email}</div>}
            {cliente?.morada && <div className="text-gray-600 flex items-center gap-2"><MapPin size={13} /> {cliente.morada}</div>}
            {cliente?.nif && <div className="text-gray-600 flex items-center gap-2"><Hash size={13} /> {cliente.nif}</div>}
            <div className="text-gray-500 text-xs pt-2 border-t border-gray-100">Data: {fmtDate(enc.data)}</div>
            {enc.descricao && <div className="text-gray-600 text-sm">{enc.descricao}</div>}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Factory size={15} /> Ordens de Fabrico associadas</h3>
          {enc.ordens_fabrico.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Ainda sem ordens de fabrico nesta encomenda.</p>
          ) : (
            <div className="space-y-2" data-testid="encomenda-ofs">
              {enc.ordens_fabrico.map((o) => (
                <Link key={o.id} to={`/ordens-fabrico/${o.id}`} data-testid={`encomenda-of-${o.id}`} className="flex items-center justify-between gap-3 border border-gray-200 rounded-sm px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="mono tabular-nums font-medium text-gray-900">{o.numero}</span>
                    <span className="text-sm text-gray-500">{Math.round(o.progresso || 0)}% concluído</span>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
