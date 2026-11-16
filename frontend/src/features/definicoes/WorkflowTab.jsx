import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, Mail, Save, ShieldCheck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50";
const sectionCls = "bg-white border border-gray-200 rounded-sm p-5 space-y-3";
const h2Cls = "text-sm font-semibold uppercase tracking-[0.08em] text-gray-700 flex items-center gap-2";

function Pessoas({ utilizadores, valor, onChange, disabled, vazio }) {
  const sel = valor || [];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {utilizadores.map((u) => {
        const on = sel.includes(u.id);
        return (
          <button key={u.id} type="button" disabled={disabled} onClick={() => onChange(on ? sel.filter((x) => x !== u.id) : [...sel, u.id])}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-brand bg-brand-soft text-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {u.nome}
          </button>
        );
      })}
      {!sel.length && <span className="text-xs text-gray-400 ml-1">{vazio}</span>}
    </div>
  );
}

/** Definições → Aprovações e alertas. */
export default function WorkflowTab() {
  const { isAdmin } = useAuth();
  const [dados, setDados] = useState(null);
  const [form, setForm] = useState(null);
  const [utilizadores, setUtilizadores] = useState([]);
  const [busy, setBusy] = useState(false);

  const aplicar = (r) => { setDados(r); setForm(JSON.parse(JSON.stringify(r.config))); };
  useEffect(() => {
    api.get("/definicoes/workflow").then(aplicar).catch(() => toast.error("Não foi possível carregar"));
    api.get("/utilizadores-lista").then(setUtilizadores).catch(() => {});
  }, []);
  const sujo = useMemo(() => form && dados && JSON.stringify(form) !== JSON.stringify(dados.config), [form, dados]);
  if (!form) return <div className="text-sm text-gray-500">A carregar...</div>;
  const dis = !isAdmin;

  const setAp = (k, patch) => setForm((f) => ({ ...f, aprovacoes: { ...f.aprovacoes, [k]: { ...f.aprovacoes[k], ...patch } } }));
  const setAl = (k, patch) => setForm((f) => ({ ...f, alertas: { ...f.alertas, [k]: { ...f.alertas[k], ...patch } } }));
  const guardar = async () => {
    setBusy(true);
    try {
      aplicar(await api.put("/definicoes/workflow", { aprovacoes: form.aprovacoes, alertas: form.alertas, credito_modo: form.credito_modo }));
      toast.success("Aprovações e alertas guardados");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  };

  const grupos = {};
  dados.eventos.forEach((ev) => { (grupos[ev.grupo] ||= []).push(ev); });

  return (
    <div className="space-y-5 max-w-5xl" data-testid="workflow-tab">
      <section className={sectionCls}>
        <div>
          <h2 className={h2Cls}><ShieldCheck size={16} /> Aprovações</h2>
          <p className="text-xs text-gray-500 mt-0.5">Quando um documento passa o limite, o ERP pede aprovação e só deixa avançar depois de aprovado. A aprovação vale enquanto os valores não piorarem. Sem aprovadores escolhidos, aprovam os administradores.</p>
        </div>
        <div className="divide-y divide-gray-100">
          {dados.regras.map((r) => {
            const a = form.aprovacoes[r.id];
            return (
              <div key={r.id} className="py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 items-start" data-testid={`ap-${r.id}`}>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={!!a.ativo} disabled={dis} onChange={(e) => setAp(r.id, { ativo: e.target.checked })} />
                  {r.label}
                  <input type="number" min="0" step={r.unidade === "%" ? "1" : "10"} className={`${inputCls} w-24 tabular-nums`} value={a.limite} disabled={dis || !a.ativo}
                    onChange={(e) => setAp(r.id, { limite: e.target.value })} />
                  <span className="text-gray-500">{r.unidade}</span>
                </label>
                <div className={a.ativo ? "" : "opacity-50"}>
                  <div className="text-[11px] text-gray-500 mb-1">Quem aprova</div>
                  <Pessoas utilizadores={utilizadores} valor={a.aprovadores} disabled={dis || !a.ativo} onChange={(v) => setAp(r.id, { aprovadores: v })} vazio="Administradores" />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">Orçamentos: é verificado ao criar (atribuir número) e ao enviar ao cliente. Ordens de compra: ao dar como recebida. Também pode pedir a aprovação antes, na própria ficha.</p>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className={h2Cls}><Bell size={16} /> Alertas</h2>
          <p className="text-xs text-gray-500 mt-0.5">Aparecem em Tarefas (ícone no topo) e, se quiser, também por email. Sem destinatários escolhidos, vão para os administradores.</p>
        </div>
        {Object.entries(grupos).map(([g, evs]) => (
          <div key={g}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mt-2 mb-1">{g}</div>
            <div className="divide-y divide-gray-100">
              {evs.map((ev) => {
                const a = form.alertas[ev.id];
                return (
                  <div key={ev.id} className="py-2.5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 items-start" data-testid={`al-${ev.id}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={!!a.ativo} disabled={dis} onChange={(e) => setAl(ev.id, { ativo: e.target.checked })} />
                        {ev.label}
                      </label>
                      {ev.dias && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          com <input type="number" min="1" max="60" className={`${inputCls} w-16 !py-0.5`} value={a.dias} disabled={dis || !a.ativo} onChange={(e) => setAl(ev.id, { dias: e.target.value })} /> dias de antecedência
                        </span>
                      )}
                    </div>
                    <div className={`flex flex-wrap items-center gap-3 ${a.ativo ? "" : "opacity-50"}`}>
                      {ev.fixo ? <span className="text-xs text-gray-500">Vai para quem pediu a aprovação</span> : (
                        <Pessoas utilizadores={utilizadores} valor={a.destinatarios} disabled={dis || !a.ativo} onChange={(v) => setAl(ev.id, { destinatarios: v })} vazio="Administradores" />
                      )}
                      <label className="inline-flex items-center gap-1 text-xs text-gray-600 ml-auto">
                        <input type="checkbox" checked={!!a.email} disabled={dis || !a.ativo} onChange={(e) => setAl(ev.id, { email: e.target.checked })} /> <Mail size={12} /> Email
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className={sectionCls}>
        <h2 className={h2Cls}><Wallet size={16} /> Limite de crédito dos clientes</h2>
        <p className="text-xs text-gray-500">Quando uma encomenda nova ultrapassa o limite de crédito definido na ficha do cliente:</p>
        <div className="flex flex-wrap gap-2">
          {[["bloqueio", "Não deixa criar a encomenda"], ["aviso", "Só avisa (deixa criar)"]].map(([id, l]) => (
            <label key={id} className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm cursor-pointer ${form.credito_modo === id ? "border-brand bg-brand-soft" : "border-gray-300 text-gray-600"}`}>
              <input type="radio" checked={form.credito_modo === id} disabled={dis} onChange={() => setForm({ ...form, credito_modo: id })} /> {l}
            </label>
          ))}
        </div>
      </section>

      {isAdmin && (
        <div className="flex justify-end sticky bottom-3">
          <button type="button" onClick={guardar} disabled={busy || !sujo} className="btn btn-primario" data-testid="workflow-guardar"><Save size={15} /> Guardar</button>
        </div>
      )}
    </div>
  );
}
