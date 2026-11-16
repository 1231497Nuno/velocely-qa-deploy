import { useEffect, useState } from "react";
import ZonaArrastar from "@/components/ZonaArrastar";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, FileUp, Loader2, Save } from "lucide-react";
import { API, api, eur, fmtDate, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import DetailTabs from "@/components/DetailTabs";

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white";

function Previsao({ podeEditar }) {
  const [d, setD] = useState(null);
  const [saldo, setSaldo] = useState("");
  const [cobDias, setCobDias] = useState("");
  const carregar = () => api.get("/tesouraria/previsao?semanas=12").then((r) => { setD(r); setSaldo(r.saldo_inicial); }).catch(() => toast.error("Não foi possível calcular"));
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = async () => {
    const body = { saldo_banco: Number(saldo) || 0 };
    if (cobDias) body.cobranca_dias = Number(cobDias);
    await api.put("/tesouraria/config", body); toast.success("Guardado"); carregar();
  };
  if (!d) return null;
  const max = Math.max(1, ...d.semanas.map((s) => Math.max(s.entradas, s.saidas)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-sm p-3">
        <label className="text-xs text-gray-600">Saldo atual no banco (€)<input type="number" step="0.01" className={`${inputCls} block w-40`} value={saldo} onChange={(e) => setSaldo(e.target.value)} disabled={!podeEditar} data-testid="tes-saldo" /></label>
        <label className="text-xs text-gray-600">Lembrar cobrança após (dias da entrega)<input type="number" min="1" className={`${inputCls} block w-28`} placeholder="15" value={cobDias} onChange={(e) => setCobDias(e.target.value)} disabled={!podeEditar} /></label>
        {podeEditar && <button type="button" className="btn btn-secundario" onClick={guardar}><Save size={15} /> Guardar</button>}
        <span className="text-xs text-gray-500">{d.saldo_data ? `Saldo indicado em ${fmtDate(d.saldo_data)}` : "Indique o saldo para ver a previsão real"}</span>
      </div>
      {(d.atraso_entradas > 0 || d.atraso_saidas > 0) && (
        <div className="text-sm rounded-sm border border-amber-200 bg-amber-50 p-3">Em atraso: a receber <b>{eur(d.atraso_entradas)}</b> · a pagar <b>{eur(d.atraso_saidas)}</b> (contados nesta semana)</div>
      )}
      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="tes-semanas">
          <thead className="text-xs text-gray-500 bg-gray-50"><tr><th className="text-left px-3 py-2">Semana</th><th className="text-right px-3">Entradas</th><th className="text-right px-3">Saídas</th><th className="px-3 w-1/3" /><th className="text-right px-3">Saldo previsto</th></tr></thead>
          <tbody>
            {d.semanas.map((s) => (
              <tr key={s.semana} className="border-t border-gray-100">
                <td className="px-3 py-1.5">{fmtDate(s.semana)}</td>
                <td className="px-3 text-right tabular-nums text-emerald-700">{s.entradas ? eur(s.entradas) : "—"}</td>
                <td className="px-3 text-right tabular-nums text-red-700">{s.saidas ? eur(s.saidas) : "—"}</td>
                <td className="px-3"><div className="flex flex-col gap-0.5">
                  <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(s.entradas / max) * 100}%` }} />
                  <div className="h-1.5 rounded-full bg-red-400" style={{ width: `${(s.saidas / max) * 100}%` }} />
                </div></td>
                <td className={`px-3 text-right tabular-nums font-semibold ${s.saldo < 0 ? "text-red-700" : ""}`}>{eur(s.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="bg-white border border-gray-200 rounded-sm">
        <summary className="px-3 py-2 text-sm cursor-pointer">Ver detalhe ({d.detalhe.length} movimentos previstos)</summary>
        <div className="divide-y divide-gray-100 text-sm">
          {d.detalhe.map((x, i) => (
            <div key={i} className="flex gap-3 px-3 py-1.5">
              <span className="w-24 shrink-0">{fmtDate(x.data)}</span>
              <Link to={x.link} className="flex-1 hover:underline">{x.descricao}</Link>
              <span className={`tabular-nums ${x.tipo === "entrada" ? "text-emerald-700" : "text-red-700"}`}>{x.tipo === "entrada" ? "+" : "−"}{eur(x.valor)}</span>
              {x.atraso && <span className="text-xs text-amber-700">em atraso</span>}
            </div>
          ))}
        </div>
      </details>
      <p className="text-xs text-gray-500">Entradas: o que falta receber das encomendas (data de entrega ou prazo + condições de pagamento do cliente) e contas a receber. Saídas: ordens de compra por pagar (vencimento) e contas a pagar.</p>
    </div>
  );
}

function Extrato({ podeEditar }) {
  const [movs, setMovs] = useState(null);
  const [busy, setBusy] = useState(false);
  const carregar = () => api.get("/extrato-bancario").then(setMovs).catch(() => toast.error("Não foi possível carregar"));
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const importar = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("ficheiro", file);
      const res = await fetch(`${API}/extrato-bancario/importar`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${getToken()}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Não foi possível ler o extrato");
      toast.success(`${j.novos} movimento(s) novos${j.repetidos ? ` · ${j.repetidos} já importados` : ""}`);
      carregar();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const conciliar = async (m, tipo, id) => {
    try { await api.post(`/extrato-bancario/${m.id}/conciliar`, { tipo, id }); setMovs((x) => x.filter((y) => y.id !== m.id)); toast.success(tipo === "ignorar" ? "Ignorado" : "Conciliado"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Não foi possível"); }
  };
  return (
    <div className="space-y-3">
      {podeEditar && (
        <ZonaArrastar onFicheiros={(f) => importar(f[0])} accept=".csv,.txt,.xlsx" disabled={busy} texto="Largue o extrato aqui"
          className="border-2 border-dashed border-gray-300 rounded-sm p-4 flex flex-wrap items-center gap-3">
          <label className="btn btn-secundario cursor-pointer w-fit">{busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Importar extrato do banco (CSV/Excel)
            <input type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={(e) => importar(e.target.files?.[0])} data-testid="extrato-ficheiro" /></label>
          <span className="text-sm text-gray-500">ou arraste o ficheiro para aqui</span>
        </ZonaArrastar>
      )}
      <p className="text-xs text-gray-500">Para cada movimento são sugeridas as encomendas (entradas) ou ordens de compra (saídas) com o mesmo valor, número ou nome. Ao conciliar, o pagamento fica registado.</p>
      <div className="bg-white border border-gray-200 rounded-sm divide-y divide-gray-100">
        {(movs || []).map((m) => (
          <div key={m.id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0">{fmtDate(m.data)}</span>
            <span className="flex-1 min-w-[12rem] text-gray-700">{m.descricao}</span>
            <span className={`tabular-nums font-semibold w-24 text-right ${m.valor > 0 ? "text-emerald-700" : "text-red-700"}`}>{eur(m.valor)}</span>
            {podeEditar && <div className="basis-full flex flex-wrap gap-1.5 pl-24">
              {m.candidatos.map((c) => <button key={c.id} type="button" className="btn btn-secundario btn-sm" onClick={() => conciliar(m, c.tipo, c.id)}>{c.numero} · {c.nome} ({eur(c.pendente)})</button>)}
              {!m.candidatos.length && <span className="text-xs text-gray-400">Sem sugestões</span>}
              <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => conciliar(m, "ignorar", "")}>Ignorar</button>
            </div>}
          </div>
        ))}
        {movs && !movs.length && <div className="px-3 py-8 text-center text-sm text-gray-400">Nada por conciliar</div>}
      </div>
    </div>
  );
}

function Contabilista() {
  const h = new Date();
  const m0 = new Date(h.getFullYear(), h.getMonth() - 1, 1);
  const m1 = new Date(h.getFullYear(), h.getMonth(), 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [de, setDe] = useState(iso(m0));
  const [ate, setAte] = useState(iso(m1));
  const baixar = async () => {
    const res = await fetch(`${API}/contabilidade/exportar?de=${de}&ate=${ate}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { toast.error("Não foi possível exportar"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `contabilidade-${de}-a-${ate}.xlsx`; a.click();
  };
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 space-y-3 max-w-2xl">
      <p className="text-sm text-gray-600">Excel com os documentos de venda (com nº oficial e ATCUD quando emitidos no programa certificado), recebimentos, compras e despesas (com fatura do fornecedor) e contas a pagar/receber do período. O SAF-T de faturação é emitido pelo programa certificado (FIZ/TOConline/Moloni).</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">De<input type="date" className={`${inputCls} block`} value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="text-xs text-gray-600">Até<input type="date" className={`${inputCls} block`} value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <button type="button" className="btn btn-primario" onClick={baixar} data-testid="contab-exportar"><Download size={15} /> Exportar para o contabilista</button>
      </div>
    </div>
  );
}

export default function Tesouraria() {
  const { can } = useAuth();
  const [tab, setTab] = useState("previsao");
  const podeEditar = can("contas", "edit");
  return (
    <div>
      <PageHeader title="Tesouraria" subtitle="Previsão de entradas e saídas, conciliação do extrato bancário e exportação para o contabilista." />
      <DetailTabs testid="tes-tabs" value={tab} onChange={setTab} tabs={[
        { id: "previsao", label: "Previsão", testid: "tes-tab-previsao" },
        { id: "extrato", label: "Extrato bancário", testid: "tes-tab-extrato" },
        ...(can("financeiro", "view") ? [{ id: "contabilista", label: "Contabilista", testid: "tes-tab-contab" }] : []),
      ]} />
      {tab === "previsao" && <Previsao podeEditar={podeEditar} />}
      {tab === "extrato" && <Extrato podeEditar={podeEditar} />}
      {tab === "contabilista" && <Contabilista />}
    </div>
  );
}
