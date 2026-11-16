import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, FileSignature, FileText, Lock, Receipt, Trash2, Undo2 } from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { useModoEdicao } from "@/hooks/useModoEdicao";
import BotoesEdicao from "@/components/BotoesEdicao";
import StatusBadge from "@/components/StatusBadge";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { METODOS_PAGAMENTO, METODO_LABEL } from "@/features/pagamentos/metodos";
import { FaturaPagamento } from "@/features/pagamentos/Pagamentos";

const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50 disabled:text-gray-700";
const cardCls = "bg-white border border-gray-200 rounded-sm p-5";
const h3Cls = "text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-3";
const DOC_TIPO = { fatura: "Fatura", fatura_recibo: "Fatura-recibo", recibo: "Recibo", proforma: "Proforma" };

function erro(e, msg) {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : msg);
}

function Linha({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{children}</span>
    </div>
  );
}

/** Ficha de um pagamento: dados (editáveis até ser faturado), encomenda, documento fiscal e outros pagamentos. */
export default function PagamentoDetail() {
  const { eid, pid } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const confirmAction = useConfirm();
  const [dados, setDados] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tipoDoc, setTipoDoc] = useState("fatura_recibo");
  const [cert, setCert] = useState(null);

  const carregar = useCallback(async () => {
    const r = await api.get(`/pagamentos/${eid}/${pid}`);
    setDados(r);
    const p = r.pagamento;
    setForm({ data: p.data || "", valor: p.valor, metodo: p.metodo, nota: p.nota || "" });
  }, [eid, pid]);
  useEffect(() => { carregar().catch((e) => erro(e, "Pagamento não encontrado")); }, [carregar]);
  useEffect(() => { api.get("/faturacao/estado").then(setCert).catch(() => setCert(null)); }, []);

  const p = dados?.pagamento;
  const modo = useModoEdicao({
    permitido: can("encomendas", "edit"),
    bloqueio: p?.bloqueado ? "Faturado" : "",
  });

  if (!dados || !form) return <div className="text-sm text-gray-500">A carregar...</div>;
  const enc = dados.encomenda;
  const doc = dados.documento;
  const devolucao = p.tipo === "devolucao";
  const podeFaturar = can("financeiro", "create") && !devolucao && p.faturado === "nao";
  const podeEliminar = can("encomendas", "edit") && p.origem !== "fatura" && !p.documento_id;
  const titulo = `${devolucao ? "Devolução" : "Pagamento"} ${p.recibo_numero || ""}`.trim();

  const cancelar = () => {
    setForm({ data: p.data || "", valor: p.valor, metodo: p.metodo, nota: p.nota || "" });
    modo.terminar();
  };
  const guardar = async () => {
    setBusy(true);
    try {
      await api.put(`/encomendas/${eid}/pagamentos/${pid}`, {
        data: form.data, valor: Number(form.valor), metodo: form.metodo, nota: form.nota,
      });
      toast.success("Pagamento guardado");
      modo.terminar();
      await carregar();
    } catch (e) {
      erro(e, "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  };
  const faturar = async (assinar) => {
    if (modo.editando) return toast.error("Guarde ou cancele as alterações primeiro");
    if (assinar && !await confirmAction({
      title: cert?.ativo ? `Emitir no ${cert.fornecedor_nome}` : `Emitir e assinar ${tipoDoc === "fatura" ? "fatura" : "fatura-recibo"}`,
      description: cert?.ativo
        ? `Emitida no ${cert.fornecedor_nome} com número oficial e ATCUD (${eur(p.valor)}). Depois disso já não pode ser editada — só anulada.`
        : `Fica com número e assinada (${eur(p.valor)}). Depois de assinada já não pode ser editada — só anulada.`,
      confirmLabel: cert?.ativo ? "Emitir" : "Emitir e assinar",
    })) return;
    setBusy(true);
    try {
      const d = await api.post(`/encomendas/${eid}/pagamentos/${pid}/documento`, { tipo: tipoDoc, assinar });
      if (d.aviso_faturacao) toast.error(d.aviso_faturacao, { duration: 10000 });
      else toast.success(assinar ? `${d.numero} emitida${d.faturacao?.fornecedor_nome ? ` no ${d.faturacao.fornecedor_nome}` : ""}` : "Rascunho criado — reveja e assine");
      nav(`/financeiro/${d.id}`);
    } catch (e) {
      erro(e, "Não foi possível emitir");
    } finally {
      setBusy(false);
    }
  };
  const eliminar = async () => {
    if (!await confirmAction({
      title: `Eliminar ${devolucao ? "devolução" : "pagamento"}`,
      description: `${eur(p.valor)} sai da encomenda ${enc.numero}.`,
      confirmLabel: "Eliminar", tone: "danger",
    })) return;
    try {
      await api.del(`/encomendas/${eid}/pagamentos/${pid}`);
      toast.success("Eliminado");
      nav("/pagamentos");
    } catch (e) {
      erro(e, "Não foi possível eliminar");
    }
  };

  const pct = Math.min(100, Math.max(0, Number(enc.percentual_pago) || 0));
  const dis = !modo.ativo;

  return (
    <div data-testid="pagamento-detail">
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav(-1)} testid="pagamento-voltar" />}
        title={titulo}
        badges={
          <>
            {devolucao && <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><Undo2 size={12} /> Devolução</span>}
            <FaturaPagamento p={p} />
          </>
        }
        subtitle={<><Link to={`/encomendas/${eid}`} className="mono hover:underline">{enc.numero}</Link> · {enc.cliente}</>}
        actions={
          <>
            {podeEliminar && !modo.editando && (
              <button type="button" onClick={eliminar} className="btn btn-secundario" data-testid="pagamento-eliminar"><Trash2 size={15} /> Eliminar</button>
            )}
            {doc && (
              <Link to={`/financeiro/${doc.id}`} className="btn btn-secundario" data-testid="pagamento-abrir-doc"><Receipt size={15} /> {doc.numero || "Rascunho"}</Link>
            )}
            <BotoesEdicao modo={modo} onGuardar={guardar} onCancelar={cancelar} guardando={busy} testid="pagamento" />
          </>
        }
      />

      {p.bloqueado && (
        <div className="flex items-start gap-2 rounded-sm border border-gray-200 bg-gray-50 px-4 py-2.5 mb-4 text-sm text-gray-700" data-testid="pagamento-bloqueado">
          <Lock size={15} className="shrink-0 mt-0.5 text-gray-500" />
          <span>{p.motivo_bloqueio}. Já não pode ser alterado — para corrigir, anule o documento fiscal.</span>
        </div>
      )}
      {p.faturado === "rascunho" && (
        <div className="flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-4 py-2.5 mb-4 text-sm text-amber-900">
          <FileText size={15} className="shrink-0 mt-0.5" />
          <span>Tem uma fatura em rascunho. <Link to={`/financeiro/${p.documento_id}`} className="underline font-medium">Rever e assinar</Link></span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <section className={cardCls} data-testid="pagamento-dados">
            <h3 className={h3Cls}>Dados do {devolucao ? "reembolso" : "pagamento"}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Data</label>
                <input type="date" className={inputCls} value={form.data} disabled={dis} onChange={(e) => setForm({ ...form, data: e.target.value })} data-testid="pagamento-data" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Valor (€)</label>
                <input type="number" step="0.01" min="0" className={`${inputCls} tabular-nums`} value={form.valor} disabled={dis} onChange={(e) => setForm({ ...form, valor: e.target.value })} data-testid="pagamento-valor" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Método</label>
                <select className={inputCls} value={form.metodo} disabled={dis} onChange={(e) => setForm({ ...form, metodo: e.target.value })} data-testid="pagamento-metodo">
                  {METODOS_PAGAMENTO.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Nota</label>
                <input className={inputCls} value={form.nota} disabled={dis} placeholder="Referência da transferência, observações…" onChange={(e) => setForm({ ...form, nota: e.target.value })} data-testid="pagamento-nota" />
              </div>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Registado {p.created_at ? `em ${fmtDate(p.created_at)}` : ""}{p.origem === "fatura" ? " por um recibo fiscal" : p.origem === "loja" ? " pela loja online" : ""}.
            </div>
          </section>

          {podeFaturar && (
            <section className={cardCls} data-testid="pagamento-faturar">
              <h3 className={h3Cls}>Emitir documento fiscal</h3>
              <div className="flex flex-wrap gap-2 text-sm">
                {[["fatura_recibo", "Fatura-recibo"], ["fatura", "Fatura (+ recibo)"]].map(([id, label]) => (
                  <label key={id} className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 cursor-pointer ${tipoDoc === id ? "border-brand bg-brand-soft text-gray-900" : "border-gray-300 text-gray-600"}`}>
                    <input type="radio" name="tipo-doc" className="accent-current" checked={tipoDoc === id} onChange={() => setTipoDoc(id)} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                O documento fica com o valor deste pagamento ({eur(p.valor)}). Em rascunho ainda pode rever linhas e notas; depois de emitido fica fixo.
                {cert?.ativo && tipoDoc === "fatura" && cert.fornecedor === "toconline" && " No TOConline o recibo da fatura emite-se no próprio programa — para pagamentos já recebidos prefira a fatura-recibo."}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" disabled={busy} onClick={() => faturar(false)} className="btn btn-secundario" data-testid="pagamento-criar-rascunho"><FileText size={15} /> Criar rascunho</button>
                <button type="button" disabled={busy} onClick={() => faturar(true)} className="btn btn-primario" data-testid="pagamento-emitir-assinar">
                  <FileSignature size={15} /> {cert?.ativo ? `Emitir no ${cert.fornecedor_nome}` : "Emitir e assinar"}
                </button>
              </div>
            </section>
          )}

          <section className={cardCls} data-testid="pagamento-outros">
            <h3 className={h3Cls}>Outros pagamentos da encomenda</h3>
            {dados.outros.length === 0 ? (
              <p className="text-sm text-gray-400">É o único pagamento desta encomenda.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {dados.outros.map((o) => (
                    <tr key={o.id} onClick={() => nav(`/pagamentos/${eid}/${o.id}`)} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer">
                      <td className="py-2 pr-3 mono text-gray-900">{o.recibo_numero || "—"}</td>
                      <td className="py-2 pr-3 tabular-nums text-gray-600">{o.data ? fmtDate(o.data) : "—"}</td>
                      <td className="py-2 pr-3 text-gray-600">{o.metodo_label}</td>
                      <td className="py-2 pr-3"><FaturaPagamento p={o} /></td>
                      <td className={`py-2 text-right tabular-nums font-medium ${o.tipo === "devolucao" ? "text-red-600" : "text-gray-900"}`}>{o.tipo === "devolucao" ? "−" : ""}{eur(o.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className={cardCls} data-testid="pagamento-encomenda">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className={`${h3Cls} !mb-0`}>Encomenda</h3>
              <StatusBadge status={enc.estado} />
            </div>
            <Link to={`/encomendas/${eid}`} className="mono font-semibold text-gray-900 hover:underline inline-flex items-center gap-1">{enc.numero} <ExternalLink size={13} /></Link>
            <div className="text-sm text-gray-600 mt-0.5">
              {enc.cliente_id ? <Link to={`/clientes/${enc.cliente_id}`} className="hover:underline">{enc.cliente}</Link> : enc.cliente}
            </div>
            {enc.descricao && <div className="text-xs text-gray-500 mt-1">{enc.descricao}</div>}
            <div className="mt-4">
              <Linha label="Total c/ IVA"><span className="tabular-nums font-medium">{eur(enc.total)}</span></Linha>
              <Linha label="Recebido"><span className="tabular-nums text-emerald-700 font-medium">{eur(enc.pago)}</span></Linha>
              {enc.devolvido > 0.009 && <Linha label="Devolvido"><span className="tabular-nums text-red-600">{eur(enc.devolvido)}</span></Linha>}
              <Linha label="Em falta"><span className={`tabular-nums font-semibold ${enc.em_falta > 0.009 ? "text-amber-700" : "text-emerald-700"}`}>{eur(enc.em_falta)}</span></Linha>
            </div>
            <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${pct >= 99.9 ? "bg-emerald-600" : pct > 0 ? "bg-amber-500" : "bg-gray-300"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[11px] text-gray-500 mt-1 text-right tabular-nums">{pct.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}% pago</div>
          </section>

          <section className={cardCls} data-testid="pagamento-documento">
            <h3 className={h3Cls}>Documento fiscal</h3>
            {devolucao ? (
              <p className="text-sm text-gray-500">Uma devolução não tem fatura (seria uma nota de crédito).</p>
            ) : doc ? (
              <>
                <Link to={`/financeiro/${doc.id}`} className="font-semibold text-gray-900 hover:underline mono">{doc.numero || "Rascunho"}</Link>
                <div className="mt-2">
                  <Linha label="Tipo">{DOC_TIPO[doc.tipo] || doc.tipo}</Linha>
                  <Linha label="Estado"><StatusBadge status={doc.estado} /></Linha>
                  {doc.data && <Linha label="Data">{fmtDate(doc.data)}</Linha>}
                  <Linha label="Total"><span className="tabular-nums">{eur(doc.total)}</span></Linha>
                  {doc.faturacao?.fornecedor_nome && doc.faturacao.estado === "emitido" && (
                    <Linha label="Emitido no">{doc.faturacao.fornecedor_nome}{doc.faturacao.atcud ? ` · ${doc.faturacao.atcud}` : ""}</Linha>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Ainda sem fatura.{podeFaturar ? " Emita-a no bloco ao lado." : ""}</p>
            )}
          </section>

          <section className={cardCls}>
            <h3 className={h3Cls}>Resumo</h3>
            <Linha label="Método">{METODO_LABEL[p.metodo] || p.metodo}</Linha>
            <Linha label="Valor"><span className={`tabular-nums font-semibold ${devolucao ? "text-red-600" : ""}`}>{devolucao ? "−" : ""}{eur(p.valor)}</span></Linha>
            <Linha label="Data">{p.data ? fmtDate(p.data) : "—"}</Linha>
          </section>
        </div>
      </div>
    </div>
  );
}
