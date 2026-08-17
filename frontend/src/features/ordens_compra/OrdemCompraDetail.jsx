import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { toast } from "sonner";
import { Plus, Trash2, Save, Pencil, X } from "lucide-react";

const TIPO_DESPESA_OPTS = [
  { value: "compra", label: "Compra — stock / matéria-prima para vender" },
  { value: "despesa_normal", label: "Despesa — água, luz, telecom, gasóleo, renda…" },
  { value: "despesa_diversa", label: "Despesa diversa — hotéis, anúncios, portes…" },
];

const TIPO_DESPESA_LABEL = Object.fromEntries(TIPO_DESPESA_OPTS.map((o) => [o.value, o.label]));
const ESTADO_LABEL = { criada: "Criada", recebida: "Recebida", cancelada: "Cancelada" };
const TIPO_COMPRA_OPTS = ["", "Consumiveis", "Produtos", "Outros", "Manutenção", "Portes"];

const emptyLinha = () => ({
  id: crypto.randomUUID?.() || String(Date.now()),
  nome: "",
  quantidade: 1,
  preco_unit: 0,
  desconto: 0,
  comentario: "",
  artigo_id: null,
  artigo_nome: "",
});

function Field({ label, children }) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

function ViewValue({ children, empty = "—" }) {
  const v = children;
  const blank = v === null || v === undefined || v === "";
  return (
    <div className="text-sm text-gray-900 min-h-[38px] flex items-center">
      {blank ? <span className="text-gray-400">{empty}</span> : v}
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-gray-400";

function formFromOc(data) {
  return {
    ...data,
    linhas: (data.linhas || []).map((l) => ({ ...l })),
  };
}

export default function OrdemCompraDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useDetailTab(["oc", "historico"], "oc");
  const location = useLocation();
  const { can } = useAuth();
  const [oc, setOc] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(!!location.state?.edit);
  const [saving, setSaving] = useState(false);
  const [fornecedores, setFornecedores] = useState([]);

  const load = useCallback(async () => {
    const data = await api.get(`/ordens-compra/${id}`);
    setOc(data);
    setForm(formFromOc(data));
  }, [id]);

  useEffect(() => { load().catch(() => setOc(null)); }, [load]);
  useEffect(() => {
    if (location.state?.edit) {
      setEditing(true);
      nav(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, nav]);
  useEffect(() => {
    api.get("/fornecedores").then((r) => {
      setFornecedores(Array.isArray(r) ? r : (r.items || []));
    }).catch(() => {});
  }, []);

  if (!form) {
    return <div className="text-sm text-gray-500">{oc === null ? "Ordem não encontrada." : "A carregar..."}</div>;
  }

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setLinha = (idx, key, val) => {
    setForm((f) => {
      const linhas = [...(f.linhas || [])];
      linhas[idx] = { ...linhas[idx], [key]: val };
      return { ...f, linhas };
    });
  };

  const addLinha = () => setForm((f) => ({ ...f, linhas: [...(f.linhas || []), emptyLinha()] }));
  const removeLinha = (idx) => setForm((f) => ({ ...f, linhas: f.linhas.filter((_, i) => i !== idx) }));

  const onFornecedor = (fid) => {
    const f = fornecedores.find((x) => x.id === fid);
    setForm((prev) => ({
      ...prev,
      fornecedor_id: fid || null,
      fornecedor_nome: f?.nome || "",
    }));
  };

  const startEdit = () => {
    setForm(formFromOc(oc));
    setEditing(true);
  };

  const cancelEdit = () => {
    setForm(formFromOc(oc));
    setEditing(false);
  };

  const save = async () => {
    if (!can("ordens_compra", "edit")) return;
    setSaving(true);
    try {
      const payload = {
        assunto: form.assunto || "",
        fornecedor_id: form.fornecedor_id || null,
        fornecedor_nome: form.fornecedor_nome || "",
        tipo_compra: form.tipo_compra || "",
        tipo_despesa: form.tipo_despesa || "despesa_diversa",
        estado: form.estado || "criada",
        data: form.data || "",
        vencimento: form.vencimento || "",
        data_pagamento: form.data_pagamento || "",
        subtotal: Number(form.subtotal) || 0,
        total: Number(form.total) || 0,
        valor_pago: Number(form.valor_pago) || 0,
        desconto_percentual: Number(form.desconto_percentual) || 0,
        valor_desconto: Number(form.valor_desconto) || 0,
        valor_taxa: Number(form.valor_taxa) || 0,
        moeda: form.moeda || "EUR",
        responsavel: form.responsavel || "",
        tipologia: form.tipologia || "",
        transportadora: form.transportadora || "",
        notas: form.notas || "",
        linhas: (form.linhas || []).map((l) => ({
          id: l.id,
          nome: l.nome || "",
          quantidade: Number(l.quantidade) || 0,
          preco_unit: Number(l.preco_unit) || 0,
          desconto: Number(l.desconto) || 0,
          comentario: l.comentario || "",
          artigo_id: l.artigo_id || null,
          artigo_nome: l.artigo_nome || "",
        })),
      };
      const linhasTotal = payload.linhas.reduce(
        (s, l) => s + (l.quantidade * l.preco_unit) - (l.desconto || 0),
        0,
      );
      if (!payload.total && linhasTotal) {
        payload.subtotal = Math.round(linhasTotal * 100) / 100;
        payload.total = payload.subtotal;
      }
      const updated = await api.put(`/ordens-compra/${id}`, payload);
      setOc(updated);
      setForm(formFromOc(updated));
      setEditing(false);
      toast.success("Ordem guardada");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const linhasTotal = (form.linhas || []).reduce(
    (s, l) => s + (Number(l.quantidade) || 0) * (Number(l.preco_unit) || 0) - (Number(l.desconto) || 0),
    0,
  );

  const podeEditar = can("ordens_compra", "edit");

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/ordens-compra")} testid="oc-back-btn" label="Voltar às ordens" />}
        title={<h1 className="text-lg sm:text-xl font-bold tracking-tight font-display" data-testid="oc-codigo">{form.codigo || "Ordem de compra"}</h1>}
        badges={<StatusBadge status={form.estado} />}
        subtitle={form.codigo_origem ? `Origem CRM: ${form.codigo_origem}` : (form.assunto || null)}
        actions={
          podeEditar ? (
            editing ? (
              <>
                <button type="button" data-testid="oc-cancel-btn" onClick={cancelEdit} disabled={saving} className="border border-gray-300 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-gray-50 disabled:opacity-50">
                  <X size={15} /> Cancelar
                </button>
                <button data-testid="oc-save-btn" onClick={save} disabled={saving} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50">
                  <Save size={15} /> {saving ? "A guardar…" : "Guardar"}
                </button>
              </>
            ) : (
              <button type="button" data-testid="oc-edit-btn" onClick={startEdit} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <Pencil size={15} /> Editar
              </button>
            )
          ) : null
        }
      />

      <DetailTabs
        testid="oc-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "oc", label: "Ordem de compra", testid: "oc-tab-oc" },
          { id: "historico", label: "Histórico", testid: "oc-tab-historico" },
        ]}
      />

      {tab === "oc" && (
        <>
      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Assunto">
            {editing ? (
              <input className={inputCls} value={form.assunto || ""} onChange={(e) => set("assunto", e.target.value)} data-testid="oc-assunto" />
            ) : (
              <ViewValue>{form.assunto}</ViewValue>
            )}
          </Field>
          <Field label="Fornecedor">
            {editing ? (
              <>
                <select
                  className={inputCls}
                  value={form.fornecedor_id || ""}
                  onChange={(e) => onFornecedor(e.target.value)}
                  data-testid="oc-fornecedor"
                >
                  <option value="">— Sem fornecedor —</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
                {form.fornecedor_id && (
                  <Link to={`/fornecedores/${form.fornecedor_id}`} className="text-xs text-gray-500 hover:text-gray-900 mt-1 inline-block">
                    Ver ficha do fornecedor →
                  </Link>
                )}
                {!form.fornecedor_id && form.fornecedor_nome && (
                  <p className="text-xs text-gray-500 mt-1">Nome CSV: {form.fornecedor_nome}</p>
                )}
              </>
            ) : (
              <ViewValue>
                {form.fornecedor_id ? (
                  <Link to={`/fornecedores/${form.fornecedor_id}`} className="hover:underline text-gray-900">
                    {form.fornecedor_nome || "Fornecedor"}
                  </Link>
                ) : (
                  form.fornecedor_nome || null
                )}
              </ViewValue>
            )}
          </Field>
          <Field label="Tipo de despesa">
            {editing ? (
              <select className={inputCls} value={form.tipo_despesa || "despesa_diversa"} onChange={(e) => set("tipo_despesa", e.target.value)} data-testid="oc-tipo-despesa">
                {TIPO_DESPESA_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <ViewValue>{TIPO_DESPESA_LABEL[form.tipo_despesa] || form.tipo_despesa}</ViewValue>
            )}
          </Field>
          <Field label="Tipo compra (CRM)">
            {editing ? (
              <select className={inputCls} value={form.tipo_compra || ""} onChange={(e) => set("tipo_compra", e.target.value)}>
                {TIPO_COMPRA_OPTS.map((t) => <option key={t || "vazio"} value={t}>{t || "—"}</option>)}
              </select>
            ) : (
              <ViewValue>{form.tipo_compra}</ViewValue>
            )}
          </Field>
          <Field label="Estado">
            {editing ? (
              <select className={inputCls} value={form.estado || "criada"} onChange={(e) => set("estado", e.target.value)} data-testid="oc-estado">
                <option value="criada">Criada</option>
                <option value="recebida">Recebida</option>
                <option value="cancelada">Cancelada</option>
              </select>
            ) : (
              <ViewValue>{ESTADO_LABEL[form.estado] || form.estado}</ViewValue>
            )}
          </Field>
          <Field label="Data">
            {editing ? (
              <input type="date" className={inputCls} value={form.data || ""} onChange={(e) => set("data", e.target.value)} />
            ) : (
              <ViewValue>{form.data ? fmtDate(form.data) : null}</ViewValue>
            )}
          </Field>
          <Field label="Vencimento">
            {editing ? (
              <input type="date" className={inputCls} value={form.vencimento || ""} onChange={(e) => set("vencimento", e.target.value)} />
            ) : (
              <ViewValue>{form.vencimento ? fmtDate(form.vencimento) : null}</ViewValue>
            )}
          </Field>
          <Field label="Data pagamento">
            {editing ? (
              <input type="date" className={inputCls} value={form.data_pagamento || ""} onChange={(e) => set("data_pagamento", e.target.value)} />
            ) : (
              <ViewValue>{form.data_pagamento ? fmtDate(form.data_pagamento) : null}</ViewValue>
            )}
          </Field>
          <Field label="Responsável">
            {editing ? (
              <input className={inputCls} value={form.responsavel || ""} onChange={(e) => set("responsavel", e.target.value)} />
            ) : (
              <ViewValue>{form.responsavel}</ViewValue>
            )}
          </Field>
          <Field label="Tipologia">
            {editing ? (
              <input className={inputCls} value={form.tipologia || ""} onChange={(e) => set("tipologia", e.target.value)} />
            ) : (
              <ViewValue>{form.tipologia}</ViewValue>
            )}
          </Field>
          <Field label="Transportadora">
            {editing ? (
              <input className={inputCls} value={form.transportadora || ""} onChange={(e) => set("transportadora", e.target.value)} />
            ) : (
              <ViewValue>{form.transportadora}</ViewValue>
            )}
          </Field>
          <Field label="Total (€)">
            {editing ? (
              <input type="number" step="0.01" className={inputCls} value={form.total ?? 0} onChange={(e) => set("total", e.target.value)} data-testid="oc-total" />
            ) : (
              <ViewValue>{eur(form.total)}</ViewValue>
            )}
          </Field>
          <Field label="Valor pago (€)">
            {editing ? (
              <input type="number" step="0.01" className={inputCls} value={form.valor_pago ?? 0} onChange={(e) => set("valor_pago", e.target.value)} />
            ) : (
              <ViewValue>{eur(form.valor_pago)}</ViewValue>
            )}
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Notas">
            {editing ? (
              <textarea className={`${inputCls} min-h-[72px]`} value={form.notas || ""} onChange={(e) => set("notas", e.target.value)} />
            ) : (
              <ViewValue>{form.notas}</ViewValue>
            )}
          </Field>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-700">Linhas</h2>
          {editing && (
            <button type="button" onClick={addLinha} className="text-sm text-gray-700 hover:text-gray-900 flex items-center gap-1" data-testid="oc-add-linha">
              <Plus size={14} /> Adicionar linha
            </button>
          )}
        </div>
        <div className="overflow-auto max-h-[min(55vh,28rem)] lg:max-h-[min(65vh,32rem)]">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Item</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-24 bg-white">Qtd</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-28 bg-white">Preço</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-28 bg-white">Desc.</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-28 bg-white">Subtotal</th>
                {editing && <th className="w-10 bg-white"></th>}
              </tr>
            </thead>
            <tbody>
              {(form.linhas || []).map((l, idx) => {
                const sub = (Number(l.quantidade) || 0) * (Number(l.preco_unit) || 0) - (Number(l.desconto) || 0);
                return (
                  <tr key={l.id || idx} className="border-b border-gray-50">
                    <td className="px-4 py-2">
                      {editing ? (
                        <>
                          <input className={inputCls} value={l.nome || ""} onChange={(e) => setLinha(idx, "nome", e.target.value)} placeholder="Nome do item" />
                          {l.comentario && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{l.comentario}</p>}
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-gray-900">{l.nome || "—"}</div>
                          {l.comentario && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{l.comentario}</p>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {editing ? (
                        <input type="number" step="0.01" className={`${inputCls} text-right`} value={l.quantidade ?? 1} onChange={(e) => setLinha(idx, "quantidade", e.target.value)} />
                      ) : (
                        l.quantidade ?? 0
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {editing ? (
                        <input type="number" step="0.01" className={`${inputCls} text-right`} value={l.preco_unit ?? 0} onChange={(e) => setLinha(idx, "preco_unit", e.target.value)} />
                      ) : (
                        eur(l.preco_unit)
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {editing ? (
                        <input type="number" step="0.01" className={`${inputCls} text-right`} value={l.desconto ?? 0} onChange={(e) => setLinha(idx, "desconto", e.target.value)} />
                      ) : (
                        eur(l.desconto)
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{eur(sub)}</td>
                    {editing && (
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => removeLinha(idx)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-sm">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {(form.linhas || []).length === 0 && (
                <tr><td colSpan={editing ? 6 : 5} className="px-4 py-8 text-center text-gray-400 text-sm">Sem linhas.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={4} className="px-4 py-3 text-right text-sm font-medium text-gray-600">Soma linhas</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">{eur(linhasTotal)}</td>
                {editing && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-400 mb-6">
        Criada em {fmtDate(oc?.created_at)} · Subtotal doc. {eur(form.subtotal)} · Pago {eur(form.valor_pago)}
      </div>
        </>
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="ordem_compra" id={id} hideTitle />
      )}
    </div>
  );
}
