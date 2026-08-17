import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, eur, fmtDate, API, getToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import ClienteSelector from "@/components/ClienteSelector";
import Combobox from "@/components/Combobox";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { toast } from "sonner";
import { Save, Trash2, Paperclip, X, Loader2, FileText } from "lucide-react";
import { CONTA_TIPO_PT } from "@/features/contas/Contas";

const METODOS = [
  { id: "", label: "—" },
  { id: "transferencia", label: "Transferência" },
  { id: "numerario", label: "Numerário" },
  { id: "mbway", label: "MB WAY" },
  { id: "cheque", label: "Cheque" },
  { id: "cartao", label: "Cartão" },
  { id: "outro", label: "Outro" },
];

function fileUrl(path) {
  return path ? `${API}/files/${path}?auth=${getToken()}` : null;
}

function fmtSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ContaDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useDetailTab(["conta", "historico"], "conta");
  const [conta, setConta] = useState(null);
  const [fornecedores, setFornecedores] = useState([]);
  const [busyFile, setBusyFile] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setConta(await api.get(`/contas/${id}`));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!can("fornecedores", "view")) return;
    api.get("/fornecedores").then((all) => {
      const list = Array.isArray(all) ? all : (all.items || []);
      setFornecedores(list);
    }).catch(() => setFornecedores([]));
  }, [can]);

  if (!conta) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setConta({ ...conta, ...patch });
  const anulada = conta.estado === "anulada";
  const backTipo = conta.tipo === "pagar" ? "pagar" : "receber";

  const save = async () => {
    try {
      const updated = await api.put(`/contas/${id}`, {
        tipo: conta.tipo,
        entidade: conta.entidade,
        entidade_tipo: conta.entidade_tipo || "",
        entidade_id: conta.entidade_id || null,
        descricao: conta.descricao || "",
        referencia: conta.referencia || "",
        data: conta.data || null,
        vencimento: conta.vencimento || null,
        valor: Number(conta.valor) || 0,
        valor_pago: Number(conta.valor_pago) || 0,
        metodo: conta.metodo || "",
        notas: conta.notas || "",
        estado: conta.estado,
      });
      setConta(updated);
      toast.success("Conta guardada");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    }
  };

  const anular = async () => {
    if (!window.confirm("Anular esta conta?")) return;
    try {
      setConta(await api.post(`/contas/${id}/anular`));
      toast.success("Conta anulada");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível anular");
    }
  };

  const liquidar = async () => {
    try {
      const updated = await api.put(`/contas/${id}`, {
        tipo: conta.tipo,
        entidade: conta.entidade,
        entidade_tipo: conta.entidade_tipo || "",
        entidade_id: conta.entidade_id || null,
        descricao: conta.descricao || "",
        referencia: conta.referencia || "",
        data: conta.data || null,
        vencimento: conta.vencimento || null,
        valor: Number(conta.valor) || 0,
        valor_pago: Number(conta.valor) || 0,
        metodo: conta.metodo || "",
        notas: conta.notas || "",
      });
      setConta(updated);
      toast.success("Conta liquidada");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível liquidar");
    }
  };

  const remove = async () => {
    if (!window.confirm("Eliminar esta conta?")) return;
    await api.del(`/contas/${id}`);
    toast.success("Conta eliminada");
    nav(`/contas?tipo=${backTipo}`);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Ficheiro demasiado grande (máx. 15 MB)");
      return;
    }
    setBusyFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const updated = await api.post(`/contas/${id}/anexos`, fd);
      setConta(updated);
      toast.success("Documento associado");
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Falha ao carregar documento");
    } finally {
      setBusyFile(false);
    }
  };

  const removeAnexo = async (aid) => {
    if (!window.confirm("Remover este documento da conta?")) return;
    try {
      setConta(await api.del(`/contas/${id}/anexos/${aid}`));
      toast.success("Documento removido");
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível remover");
    }
  };

  const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white";

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav(`/contas?tipo=${backTipo}`)} testid="conta-back-btn" label="Voltar às contas" />}
        title={conta.numero}
        badges={<StatusBadge status={conta.estado} testid="conta-estado-badge" />}
        subtitle={`${CONTA_TIPO_PT[conta.tipo] || conta.tipo} · ${conta.entidade || "—"}`}
        actions={
          <>
            {can("contas", "edit") && !anulada && (
              <button data-testid="conta-save-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Save size={15} /> Guardar
              </button>
            )}
            {can("contas", "edit") && !anulada && (
              <button data-testid="conta-anular-btn" onClick={anular} className="bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium">
                Anular
              </button>
            )}
            {can("contas", "delete") && (
              <button data-testid="conta-delete-btn" onClick={remove} className="bg-white text-red-700 border border-red-200 hover:bg-red-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Trash2 size={15} /> Eliminar
              </button>
            )}
          </>
        }
      />

      <DetailTabs
        testid="conta-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "conta", label: "Conta", testid: "conta-tab-conta" },
          { id: "historico", label: "Histórico", testid: "conta-tab-historico" },
        ]}
      />

      {tab === "conta" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white border border-gray-200 rounded-sm p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Dados</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Tipo</label>
                  <select data-testid="conta-tipo" value={conta.tipo} onChange={(e) => upd({ tipo: e.target.value })} disabled={anulada} className={inputCls}>
                    <option value="receber">A receber</option>
                    <option value="pagar">A pagar</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Referência</label>
                  <input data-testid="conta-referencia" value={conta.referencia || ""} onChange={(e) => upd({ referencia: e.target.value })} disabled={anulada} className={inputCls} />
                </div>
              </div>
              {conta.tipo === "receber" ? (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Cliente</label>
                  <ClienteSelector
                    value={conta.entidade_id}
                    onChange={(cid, nome) => upd({ entidade_id: cid, entidade: nome, entidade_tipo: "cliente" })}
                    testid="conta-cliente"
                    canCreate={!anulada}
                  />
                </div>
              ) : can("fornecedores", "view") ? (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Fornecedor</label>
                  <Combobox
                    testid="conta-fornecedor"
                    value={conta.entidade_id}
                    onChange={(fid) => {
                      const f = fornecedores.find((x) => x.id === fid);
                      upd({ entidade_id: fid, entidade: f?.nome || conta.entidade, entidade_tipo: "fornecedor" });
                    }}
                    options={fornecedores.map((f) => ({ value: f.id, label: f.nome }))}
                    placeholder="Selecionar fornecedor..."
                  />
                </div>
              ) : null}
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Entidade</label>
                <input data-testid="conta-entidade" value={conta.entidade || ""} onChange={(e) => upd({ entidade: e.target.value })} disabled={anulada} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
                <textarea data-testid="conta-descricao" rows={3} value={conta.descricao || ""} onChange={(e) => upd({ descricao: e.target.value })} disabled={anulada} className={`${inputCls} resize-y`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Data</label>
                  <input data-testid="conta-data" type="date" value={(conta.data || "").slice(0, 10)} onChange={(e) => upd({ data: e.target.value })} disabled={anulada} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Vencimento</label>
                  <input data-testid="conta-vencimento" type="date" value={(conta.vencimento || "").slice(0, 10)} onChange={(e) => upd({ vencimento: e.target.value })} disabled={anulada} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Notas</label>
                <textarea data-testid="conta-notas" rows={2} value={conta.notas || ""} onChange={(e) => upd({ notas: e.target.value })} disabled={anulada} className={`${inputCls} resize-y`} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">Valores</h3>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Valor</label>
                  <input data-testid="conta-valor" type="number" min="0" step="0.01" value={conta.valor ?? 0} onChange={(e) => upd({ valor: e.target.value })} disabled={anulada} className={`${inputCls} tabular-nums`} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Já pago / recebido</label>
                  <input data-testid="conta-valor-pago" type="number" min="0" step="0.01" value={conta.valor_pago ?? 0} onChange={(e) => upd({ valor_pago: e.target.value })} disabled={anulada} className={`${inputCls} tabular-nums`} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Método</label>
                  <select data-testid="conta-metodo" value={conta.metodo || ""} onChange={(e) => upd({ metodo: e.target.value })} disabled={anulada} className={inputCls}>
                    {METODOS.map((m) => <option key={m.id || "none"} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-gray-100">
                  <span className="text-gray-500">Pendente</span>
                  <span className="tabular-nums font-medium text-gray-900" data-testid="conta-pendente">{eur(conta.valor_pendente)}</span>
                </div>
                {can("contas", "edit") && !anulada && Number(conta.valor_pago) < Number(conta.valor) && (
                  <button type="button" data-testid="conta-liquidar-btn" onClick={liquidar} className="w-full text-sm border border-gray-300 rounded-sm px-3 py-2 hover:bg-gray-50">
                    Marcar como liquidada
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-sm p-5 mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-700">Documentos associados</h3>
              {can("contas", "edit") && !anulada && (
                <>
                  <input ref={fileRef} type="file" className="hidden" onChange={onFile} data-testid="conta-anexo-input" />
                  <button
                    type="button"
                    data-testid="conta-anexo-add"
                    disabled={busyFile}
                    onClick={() => fileRef.current?.click()}
                    className="bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
                  >
                    {busyFile ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                    Associar documento
                  </button>
                </>
              )}
            </div>
            {(conta.anexos || []).length === 0 ? (
              <p className="text-sm text-gray-400">Ainda sem documentos. Pode associar PDFs, imagens ou folhas de cálculo.</p>
            ) : (
              <ul className="divide-y divide-gray-100" data-testid="conta-anexos">
                {(conta.anexos || []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <FileText size={16} className="text-gray-400 shrink-0" />
                    <a
                      href={fileUrl(a.path)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 min-w-0 text-sm text-gray-900 hover:underline truncate"
                    >
                      {a.nome || "Documento"}
                    </a>
                    <span className="text-xs text-gray-400 tabular-nums">{fmtSize(a.size)}</span>
                    <span className="text-xs text-gray-400">{fmtDate(a.created_at)}</span>
                    {can("contas", "edit") && !anulada && (
                      <button type="button" onClick={() => removeAnexo(a.id)} className="p-1 rounded-sm hover:bg-red-50 text-red-600" aria-label="Remover documento">
                        <X size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="conta" id={id} hideTitle />
      )}
    </div>
  );
}
