import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Download, FileSpreadsheet, ChevronLeft, ChevronRight } from "lucide-react";
import { API, api, eur } from "@/lib/api";
import { openAuthenticated } from "@/lib/openAuthenticated";
import { PageHeader } from "@/components/Layout";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function somarMes(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const rotulo = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

function Kpi({ label, valor, nota, tom = "", testid }) {
  return (
    <div className="bg-white border border-gray-200 rounded-sm px-4 py-3" data-testid={testid}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${tom}`}>{valor}</div>
      {nota && <div className="text-xs text-gray-500 mt-0.5">{nota}</div>}
    </div>
  );
}

function Lista({ titulo, linhas, campo }) {
  return (
    <div className="bg-white border border-gray-200 rounded-sm">
      <div className="px-4 py-2 border-b border-gray-100 font-semibold text-sm">{titulo}</div>
      {!linhas.length ? <div className="px-4 py-4 text-sm text-gray-400">Nada a mostrar.</div> : (
        <ul className="divide-y divide-gray-100">
          {linhas.map((l, i) => (
            <li key={i} className="px-4 py-2 flex items-center justify-between text-sm">
              {l._link ? <Link to={l._link} className="text-gray-800 hover:underline truncate">{l[campo]}</Link> : <span className="truncate">{l[campo]}</span>}
              <span className="tabular-nums font-medium">{eur(l.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Fecho do mês: o essencial do mês num ecrã, o que falta tratar e a exportação para o contabilista. */
export default function FechoMes() {
  const [mes, setMes] = useState(mesAnterior());
  const [r, setR] = useState(null);
  useEffect(() => {
    setR(null);
    api.get(`/fecho-mes?mes=${mes}`).then(setR).catch((e) => { toast.error(e?.response?.data?.detail || "Não foi possível calcular o fecho"); setR({ erro: true }); });
  }, [mes]);
  const exportar = () => openAuthenticated(`${API}/contabilidade/exportar?de=${r.de}&ate=${r.ate}`, { filename: `contabilidade-${mes}.xlsx` })
    .catch((e) => toast.error(e.message || "Não foi possível exportar"));
  const resumoXlsx = () => openAuthenticated(`${API}/relatorios/gerar/faturacao_documentos?de=${r.de}&ate=${r.ate}&formato=xlsx`, { filename: `faturacao-${mes}.xlsx` })
    .catch((e) => toast.error(e.message || "Não foi possível exportar"));

  return (
    <div>
      <PageHeader title="Fecho do mês" subtitle="Faturado, recebido, a receber, compras e margem do mês — e o que falta tratar antes de enviar ao contabilista."
        actions={(
          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-secundario px-2" onClick={() => setMes(somarMes(mes, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
            <input type="month" className="border border-gray-300 rounded-sm px-2 py-1.5 text-sm" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} data-testid="fecho-mes-input" />
            <button type="button" className="btn btn-secundario px-2" onClick={() => setMes(somarMes(mes, 1))} aria-label="Mês seguinte"><ChevronRight size={16} /></button>
          </div>
        )} />
      {!r ? <div className="text-sm text-gray-400 py-10 text-center">A calcular {rotulo(mes)}…</div> : r.erro ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi testid="fecho-faturado" label="Faturado (c/ IVA)" valor={eur(r.faturado)} nota={`${r.n_faturas} fatura(s)${r.anulado ? ` · ${eur(r.anulado)} anulado` : ""}`} />
            <Kpi testid="fecho-recebido" label="Recebido" valor={eur(r.recebido)} />
            <Kpi testid="fecho-areceber" label="A receber (fim do mês)" valor={eur(r.a_receber)} tom={r.a_receber_90 > 0 ? "text-amber-700" : ""}
              nota={r.a_receber_90 > 0 ? `${eur(r.a_receber_90)} há mais de 90 dias` : null} />
            <Kpi testid="fecho-compras" label="Compras e despesas" valor={eur(r.compras)} nota={r.compras_em_divida ? `${eur(r.compras_em_divida)} por pagar` : null} />
            <Kpi label="Vendas s/ IVA (encomendas)" valor={eur(r.vendas)}
              nota={r.objetivo?.vendas ? `Objetivo ${eur(r.objetivo.vendas)} · ${r.objetivo.pct ?? 0}%` : null}
              tom={r.objetivo?.vendas ? (r.vendas >= r.objetivo.vendas ? "text-emerald-700" : "text-amber-700") : ""} />
            {"resultado" in r && <Kpi label="Custo de produção (OF)" valor={eur(r.custo_producao)} />}
            {"resultado" in r && <Kpi testid="fecho-resultado" label="Resultado indicativo" valor={eur(r.resultado)} tom={r.resultado < 0 ? "text-red-700" : "text-emerald-700"} />}
            {"resultado" in r && <Kpi label="Margem real" valor={r.margem == null ? "—" : `${String(r.margem).replace(".", ",")}%`} />}
          </div>

          <div className="bg-white border border-gray-200 rounded-sm" data-testid="fecho-pendentes">
            <div className="px-4 py-2 border-b border-gray-100 font-semibold text-sm">Antes de fechar</div>
            {!r.pendentes.length ? (
              <div className="px-4 py-3 text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 size={16} /> Está tudo tratado neste mês.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {r.pendentes.map((p) => (
                  <li key={p.chave} className="px-4 py-2 text-sm flex items-center gap-2">
                    <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                    <Link to={p.link} className="hover:underline">{p.texto}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Lista titulo="Quem mais deve" linhas={r.top_devedores} campo="cliente" />
            <Lista titulo="Maiores compras do mês" linhas={r.top_fornecedores} campo="fornecedor" />
          </div>

          <div className="bg-white border border-gray-200 rounded-sm px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="font-semibold text-sm">Enviar ao contabilista</div>
              <div className="text-xs text-gray-500">Excel com faturas, recibos e compras de {rotulo(mes)}.</div>
            </div>
            <button type="button" className="btn btn-secundario" onClick={resumoXlsx}><FileSpreadsheet size={15} /> Faturação do mês</button>
            <button type="button" className="btn btn-primario" onClick={exportar} data-testid="fecho-exportar"><Download size={15} /> Exportar para o contabilista</button>
          </div>
        </div>
      )}
    </div>
  );
}
