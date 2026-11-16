import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Maximize2, X } from "lucide-react";

const hojeIso = () => new Date().toISOString().slice(0, 10);
const fmt = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");

function Cartao({ op, destaque }) {
  return (
    <div className={`rounded-md px-4 py-3 ${destaque || "bg-slate-800"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-bold tabular-nums">{op.of_numero}</span>
        <span className="text-lg tabular-nums text-slate-300">{fmt(op.prazo)}</span>
      </div>
      <div className="text-lg font-medium truncate">{op.nome}</div>
      <div className="text-base text-slate-300 truncate">{op.artigo_nome} · {op.quantidade} un · {op.cliente}</div>
    </div>
  );
}

/** Ecrã de oficina para TV: o que está em curso por máquina, atrasos e entregas próximas. Atualiza sozinho. */
export default function OficinaTV() {
  const [d, setD] = useState(null);
  const [hora, setHora] = useState(new Date());
  useEffect(() => {
    const carregar = () => api.get(`/producao/planeamento?inicio=${hojeIso()}&dias=1`).then(setD).catch(() => {});
    carregar();
    const t1 = setInterval(carregar, 60_000);
    const t2 = setInterval(() => setHora(new Date()), 15_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);
  const hoje = hojeIso();
  const ops = d?.operacoes || [];
  const ofsUnicas = (lista) => Object.values(lista.reduce((m, o) => { (m[o.of_id] = m[o.of_id] || o); return m; }, {}));
  const atrasadas = ofsUnicas(ops.filter((o) => o.prazo && o.prazo < hoje));
  const entregas = ofsUnicas(ops.filter((o) => o.prazo && o.prazo >= hoje)).sort((a, b) => a.prazo.localeCompare(b.prazo)).slice(0, 8);
  const maquinas = (d?.maquinas || []).map((m) => ({
    ...m,
    curso: ops.filter((o) => o.maquina_id === m.id && o.em_curso),
    fila: ops.filter((o) => o.maquina_id === m.id && !o.em_curso && (o.data === hoje || o.prioritaria)),
  })).filter((m) => m.curso.length || m.fila.length);
  const ecraInteiro = () => document.documentElement.requestFullscreen?.().catch(() => {});

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6" data-testid="oficina-tv">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-3xl font-bold">Oficina</h1>
        <div className="flex items-center gap-4">
          <span className="text-3xl tabular-nums">{hora.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</span>
          <button type="button" onClick={ecraInteiro} className="text-slate-400 hover:text-white" aria-label="Ecrã inteiro"><Maximize2 size={22} /></button>
          <Link to="/oficina" className="text-slate-400 hover:text-white" aria-label="Sair"><X size={24} /></Link>
        </div>
      </div>
      {!d ? <div className="text-xl text-slate-400">A carregar…</div> : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="xl:col-span-2">
            <h2 className="text-xl font-semibold text-slate-300 mb-3">Por máquina</h2>
            {!maquinas.length && <div className="text-xl text-slate-500">Nada em curso nem planeado para hoje.</div>}
            <div className="grid md:grid-cols-2 gap-4">
              {maquinas.map((m) => (
                <div key={m.id} className="bg-slate-800/60 rounded-lg p-4">
                  <div className="text-2xl font-bold mb-2">{m.nome}</div>
                  <div className="space-y-2">
                    {m.curso.map((o) => <Cartao key={o.operacao_id} op={o} destaque="bg-emerald-700" />)}
                    {m.fila.slice(0, 3).map((o) => <Cartao key={o.operacao_id} op={o} destaque={o.prioritaria ? "bg-amber-700" : ""} />)}
                    {m.fila.length > 3 && <div className="text-slate-400 text-lg">+ {m.fila.length - 3} na fila</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-red-400 mb-3">Atrasadas ({atrasadas.length})</h2>
              <div className="space-y-2">{atrasadas.slice(0, 6).map((o) => <Cartao key={o.of_id} op={o} destaque="bg-red-800" />)}</div>
              {!atrasadas.length && <div className="text-lg text-emerald-400">Nenhuma OF atrasada.</div>}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-300 mb-3">Próximas entregas</h2>
              <div className="space-y-2">{entregas.map((o) => <Cartao key={o.of_id} op={o} destaque={o.prazo === hoje ? "bg-amber-700" : ""} />)}</div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
