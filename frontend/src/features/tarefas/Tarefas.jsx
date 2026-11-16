import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Bell, CheckCheck, CheckCircle2, Clock, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { FiltroChip } from "@/components/Filtros";

const ESTADO = {
  pendente: { label: "Pendente", cls: "text-amber-800 bg-amber-50 border-amber-200", Icon: Clock },
  aprovado: { label: "Aprovado", cls: "text-emerald-800 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
  rejeitado: { label: "Rejeitado", cls: "text-red-800 bg-red-50 border-red-200", Icon: XCircle },
  substituido: { label: "Substituído", cls: "text-gray-600 bg-gray-50 border-gray-200", Icon: Clock },
};

function quando(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return fmtDate(iso);
}

function Item({ t, onDecidir, onLida }) {
  const nav = useNavigate();
  const [rejeitar, setRejeitar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const aprov = t.tipo === "aprovacao";
  const est = ESTADO[t.estado];
  const abrir = () => {
    if (!aprov && !t.lida) onLida(t);
    if (t.link) nav(t.link);
  };
  return (
    <li className={`bg-white border rounded-sm p-3 ${!aprov && !t.lida ? "border-gray-300" : "border-gray-200"}`} data-testid={`tarefa-${t.id}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${aprov ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
          {aprov ? <ShieldCheck size={16} /> : <Bell size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={abrir} className={`text-left text-sm hover:underline ${!aprov && !t.lida ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
              {t.titulo}
            </button>
            {aprov && est && <span className={`inline-flex items-center gap-1 text-[11px] border rounded-full px-2 py-0.5 ${est.cls}`}><est.Icon size={11} /> {est.label}</span>}
          </div>
          {t.texto && <div className="text-xs text-gray-600 mt-0.5">{t.texto}</div>}
          <div className="text-[11px] text-gray-400 mt-1">
            {quando(t.created_at)}
            {aprov && t.pedido_por?.nome && ` · pedido por ${t.pedido_por.nome}`}
            {t.decidido_por && ` · ${t.estado} por ${t.decidido_por.nome}`}
            {t.motivo && ` · «${t.motivo}»`}
          </div>
          {rejeitar && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da rejeição" className="flex-1 min-w-[14rem] border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm" />
              <button type="button" disabled={!motivo.trim()} onClick={() => onDecidir(t, false, motivo)} className="btn btn-perigo btn-sm">Rejeitar</button>
              <button type="button" onClick={() => setRejeitar(false)} className="btn btn-secundario btn-sm">Cancelar</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {aprov && t.estado === "pendente" && t.para_mim && !rejeitar && (
            <>
              <button type="button" onClick={() => onDecidir(t, true, "")} className="btn btn-sucesso btn-sm" data-testid={`tarefa-aprovar-${t.id}`}><CheckCircle2 size={14} /> Aprovar</button>
              <button type="button" onClick={() => setRejeitar(true)} className="btn btn-perigo-contorno btn-sm"><XCircle size={14} /> Rejeitar</button>
            </>
          )}
          {!aprov && !t.lida && (
            <button type="button" onClick={() => onLida(t)} className="btn btn-secundario btn-sm" title="Marcar como lida"><CheckCheck size={14} /></button>
          )}
          {t.link && <button type="button" onClick={abrir} className="p-1.5 text-gray-400 hover:text-gray-800" title="Abrir"><ExternalLink size={15} /></button>}
        </div>
      </div>
    </li>
  );
}

/** Tarefas: aprovações a decidir, alertas por ler e os meus pedidos de aprovação. */
export default function Tarefas() {
  const { isAdmin } = useAuth();
  const [filtro, setFiltro] = useState("pendentes");
  const [todas, setTodas] = useState(false);
  const [dados, setDados] = useState(null);

  const carregar = useCallback(async () => {
    setDados(await api.get(`/tarefas?filtro=${filtro}&todas=${todas}`));
  }, [filtro, todas]);
  useEffect(() => { carregar().catch(() => setDados({ items: [], meus_pedidos: [], contagem: {} })); }, [carregar]);

  const atualizar = async () => {
    await carregar();
    window.dispatchEvent(new Event("velocely:tarefas"));
  };
  const decidir = async (t, aprovar, motivo) => {
    try {
      await api.post(`/tarefas/${t.id}/decidir`, { aprovar, motivo });
      toast.success(aprovar ? "Aprovado — quem pediu foi avisado" : "Rejeitado — quem pediu foi avisado");
      await atualizar();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível decidir");
    }
  };
  const lida = async (t) => {
    await api.post(`/tarefas/${t.id}/lida`).catch(() => {});
    await atualizar();
  };
  const todasLidas = async () => {
    await api.post("/tarefas/lidas").catch(() => {});
    await atualizar();
  };

  const c = dados?.contagem || {};
  const items = dados?.items || [];
  return (
    <div data-testid="tarefas">
      <PageHeader
        title="Tarefas"
        subtitle="Aprovações para decidir e alertas (encomendas pagas, prazos, pedidos do site…). Configure em Definições → Aprovações e alertas."
        actions={c.alertas > 0 && <button type="button" onClick={todasLidas} className="btn btn-secundario"><CheckCheck size={15} /> Marcar alertas como lidos</button>}
      />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {[["pendentes", `Por tratar (${c.total || 0})`], ["aprovacoes", "Aprovações"], ["alertas", "Alertas"], ["todos", "Tudo"]].map(([id, l]) => (
          <FiltroChip key={id} active={filtro === id} onClick={() => setFiltro(id)} testid={`tarefas-filtro-${id}`}>{l}</FiltroChip>
        ))}
        {isAdmin && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Ver de todos os utilizadores
          </label>
        )}
      </div>
      {!dados && <div className="text-sm text-gray-500">A carregar...</div>}
      {dados && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-5">
          <ul className="space-y-2">
            {items.map((t) => <Item key={t.id} t={t} onDecidir={decidir} onLida={lida} />)}
            {items.length === 0 && <li className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-sm text-gray-400">Nada por tratar.</li>}
          </ul>
          {dados.meus_pedidos?.length > 0 && (
            <aside className="bg-white border border-gray-200 rounded-sm p-4 h-fit">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">Os meus pedidos de aprovação</h3>
              <ul className="space-y-2">
                {dados.meus_pedidos.map((t) => {
                  const est = ESTADO[t.estado] || ESTADO.pendente;
                  return (
                    <li key={t.id} className="text-sm">
                      <Link to={t.link || "/tarefas"} className="hover:underline text-gray-800">{t.titulo.replace("Aprovar: ", "")}</Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center gap-1 text-[11px] border rounded-full px-2 py-0.5 ${est.cls}`}><est.Icon size={11} /> {est.label}</span>
                        <span className="text-[11px] text-gray-400">{quando(t.created_at)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
