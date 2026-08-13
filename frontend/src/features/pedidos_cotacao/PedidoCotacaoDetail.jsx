import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { toast } from "sonner";
import {
  Plus, Trash2, Save, Pencil, X, Send, CheckCircle2, Ban, ShoppingCart,
} from "lucide-react";

const ESTADO_LABEL = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  respondido: "Respondido",
  cancelado: "Cancelado",
  adjudicado: "Adjudicado",
};

const emptyLinha = () => ({
  id: crypto.randomUUID?.() || String(Date.now()),
  nome: "",
  quantidade: 1,
  unidade: "un",
  notas: "",
  artigo_id: null,
  artigo_nome: "",
  preco_unit_cotado: null,
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

function formFromPc(data) {
  return {
    ...data,
    linhas: (data.linhas || []).map((l) => ({ ...l })),
  };
}

export default function PedidoCotacaoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const [pc, setPc] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(!!location.state?.edit);
  const [saving, setSaving] = useState(false);
  const [fornecedores, setFornecedores] = useState([]);

  const load = useCallback(async () => {
    const data = await api.get(`/pedidos-cotacao/${id}`);
    setPc(data);
    setForm(formFromPc(data));
  }, [id]);

  useEffect(() => { load().catch(() => setPc(null)); }, [load]);
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
    return <div className="text-sm text-gray-500">{pc === null ? "Pedido não encontrado." : "A carregar..."}</div>;
  }

  const locked = form.estado === "adjudicado" || form.estado === "cancelado";
  const podeEditar = can("pedidos_cotacao", "edit") && !locked;

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
    setForm(formFromPc(pc));
    setEditing(true);
  };

  const cancelEdit = () => {
    setForm(formFromPc(pc));
    setEditing(false);
  };

  const buildPayload = (extra = {}) => ({
    assunto: form.assunto || "",
    fornecedor_id: form.fornecedor_id || null,
    fornecedor_nome: form.fornecedor_nome || "",
    estado: form.estado || "rascunho",
    data: form.data || "",
    prazo_resposta: form.prazo_resposta || "",
    valor_cotado: form.valor_cotado != null && form.valor_cotado !== "" ? Number(form.valor_cotado) : null,
    moeda: form.moeda || "EUR",
    responsavel: form.responsavel || "",
    notas: form.notas || "",
    linhas: (form.linhas || []).map((l) => ({
      id: l.id,
      nome: l.nome || "",
      quantidade: Number(l.quantidade) || 0,
      unidade: l.unidade || "un",
      notas: l.notas || "",
      artigo_id: l.artigo_id || null,
      artigo_nome: l.artigo_nome || "",
      preco_unit_cotado:
        l.preco_unit_cotado === null || l.preco_unit_cotado === "" || l.preco_unit_cotado === undefined
          ? null
          : Number(l.preco_unit_cotado),
    })),
    ordem_compra_id: form.ordem_compra_id || null,
    ordem_compra_codigo: form.ordem_compra_codigo || "",
    ...extra,
  });

  const save = async (extra = {}, opts = {}) => {
    if (!can("pedidos_cotacao", "edit")) return;
    setSaving(true);
    try {
      const updated = await api.put(`/pedidos-cotacao/${id}`, buildPayload(extra));
      setPc(updated);
      setForm(formFromPc(updated));
      if (!opts.keepEditing) setEditing(false);
      toast.success(opts.msg || "Pedido guardado");
      return updated;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const setEstado = async (estado, msg) => {
    if (editing) {
      await save({ estado }, { msg });
    } else {
      setSaving(true);
      try {
        const updated = await api.put(`/pedidos-cotacao/${id}`, {
          ...buildPayload(),
          estado,
        });
        setPc(updated);
        setForm(formFromPc(updated));
        toast.success(msg || "Estado actualizado");
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Erro ao actualizar estado");
      } finally {
        setSaving(false);
      }
    }
  };

  const adjudicar = async () => {
    if (!window.confirm("Adjudicar este pedido e criar uma Ordem de Compra?")) return;
    setSaving(true);
    try {
      if (editing) {
        const saved = await api.put(`/pedidos-cotacao/${id}`, buildPayload());
        setPc(saved);
        setForm(formFromPc(saved));
        setEditing(false);
      }
      const res = await api.post(`/pedidos-cotacao/${id}/adjudicar`);
      setPc(res);
      setForm(formFromPc(res));
      toast.success(`Adjudicado · OC ${res.ordem_compra_codigo || res.ordem_compra?.codigo}`);
      if (res.ordem_compra_id) {
        nav(`/ordens-compra/${res.ordem_compra_id}`, { state: { edit: true } });
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao adjudicar");
    } finally {
      setSaving(false);
    }
  };

  const linhasTotal = (form.linhas || []).reduce((s, l) => {
    if (l.preco_unit_cotado == null || l.preco_unit_cotado === "") return s;
    return s + (Number(l.quantidade) || 0) * Number(l.preco_unit_cotado);
  }, 0);

  const temPrecos = (form.linhas || []).length > 0 && (form.linhas || []).every(
    (l) => l.preco_unit_cotado != null && l.preco_unit_cotado !== "",
  );

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/pedidos-cotacao")} testid="pc-back-btn" label="Voltar aos pedidos" />}
        title={<h1 className="text-lg sm:text-xl font-bold tracking-tight font-display" data-testid="pc-codigo">{form.codigo || "Pedido de cotação"}</h1>}
        badges={<StatusBadge status={form.estado} testid="pc-estado-badge" />}
        subtitle={form.ordem_compra_id ? (
          <>Ordem de compra:{" "}
            <Link to={`/ordens-compra/${form.ordem_compra_id}`} className="mono text-gray-800 hover:underline">
              {form.ordem_compra_codigo || "ver OC"}
            </Link>
          </>
        ) : (form.assunto || null)}
        actions={
          <>
            {podeEditar && !editing && form.estado === "rascunho" && (
              <button type="button" data-testid="pc-enviar-btn" disabled={saving} onClick={() => setEstado("enviado", "Marcado como enviado")} className="border border-indigo-300 text-indigo-800 hover:bg-indigo-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Send size={15} /> Marcar enviado
              </button>
            )}
            {podeEditar && !editing && (form.estado === "enviado" || form.estado === "rascunho") && (
              <button type="button" data-testid="pc-responder-btn" disabled={saving} onClick={() => { startEdit(); toast.message("Preenche os preços cotados e guarda como Respondido"); }} className="border border-amber-300 text-amber-900 hover:bg-amber-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 size={15} /> Registar resposta
              </button>
            )}
            {podeEditar && !editing && form.estado === "respondido" && temPrecos && (
              <button type="button" data-testid="pc-adjudicar-btn" disabled={saving} onClick={adjudicar} className="bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <ShoppingCart size={15} /> Adjudicar → OC
              </button>
            )}
            {podeEditar && !editing && form.estado !== "cancelado" && (
              <button type="button" data-testid="pc-cancelar-estado-btn" disabled={saving} onClick={() => { if (window.confirm("Cancelar este pedido?")) setEstado("cancelado", "Pedido cancelado"); }} className="border border-red-200 text-red-700 hover:bg-red-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Ban size={15} /> Cancelar
              </button>
            )}
            {podeEditar && (
              editing ? (
                <>
                  <button type="button" data-testid="pc-cancel-btn" onClick={cancelEdit} disabled={saving} className="border border-gray-300 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-gray-50 disabled:opacity-50">
                    <X size={15} /> Cancelar
                  </button>
                  {(form.estado === "enviado" || form.estado === "rascunho") && (
                    <button type="button" data-testid="pc-save-respondido-btn" disabled={saving || !temPrecos} onClick={() => save({ estado: "respondido" }, { msg: "Resposta registada" })} className="border border-amber-400 text-amber-900 hover:bg-amber-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                      <CheckCircle2 size={15} /> Guardar como respondido
                    </button>
                  )}
                  <button data-testid="pc-save-btn" onClick={() => save()} disabled={saving} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50">
                    <Save size={15} /> {saving ? "A guardar…" : "Guardar"}
                  </button>
                </>
              ) : (
                <button type="button" data-testid="pc-edit-btn" onClick={startEdit} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                  <Pencil size={15} /> Editar
                </button>
              )
            )}
          </>
        }
      />

      <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Assunto">
            {editing ? (
              <input className={inputCls} value={form.assunto || ""} onChange={(e) => set("assunto", e.target.value)} data-testid="pc-assunto" />
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
                  data-testid="pc-fornecedor"
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
          <Field label="Estado">
            {editing && !locked ? (
              <select className={inputCls} value={form.estado || "rascunho"} onChange={(e) => set("estado", e.target.value)} data-testid="pc-estado">
                {Object.entries(ESTADO_LABEL).filter(([k]) => k !== "adjudicado").map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
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
          <Field label="Prazo de resposta">
            {editing ? (
              <input type="date" className={inputCls} value={form.prazo_resposta || ""} onChange={(e) => set("prazo_resposta", e.target.value)} data-testid="pc-prazo" />
            ) : (
              <ViewValue>{form.prazo_resposta ? fmtDate(form.prazo_resposta) : null}</ViewValue>
            )}
          </Field>
          <Field label="Responsável">
            {editing ? (
              <input className={inputCls} value={form.responsavel || ""} onChange={(e) => set("responsavel", e.target.value)} />
            ) : (
              <ViewValue>{form.responsavel}</ViewValue>
            )}
          </Field>
          <Field label="Valor cotado (€)">
            <ViewValue>{form.valor_cotado != null ? eur(form.valor_cotado) : (linhasTotal > 0 ? eur(linhasTotal) : null)}</ViewValue>
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
            <button type="button" onClick={addLinha} className="text-sm text-gray-700 hover:text-gray-900 flex items-center gap-1" data-testid="pc-add-linha">
              <Plus size={14} /> Adicionar linha
            </button>
          )}
        </div>
        <div className="overflow-auto max-h-[min(55vh,28rem)] lg:max-h-[min(65vh,32rem)]">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white">Item</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-24 bg-white">Qtd</th>
                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-20 bg-white">Un.</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-28 bg-white">Preço cotado</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-28 bg-white">Subtotal</th>
                {editing && <th className="w-10 bg-white"></th>}
              </tr>
            </thead>
            <tbody>
              {(form.linhas || []).map((l, idx) => {
                const sub =
                  l.preco_unit_cotado == null || l.preco_unit_cotado === ""
                    ? null
                    : (Number(l.quantidade) || 0) * Number(l.preco_unit_cotado);
                return (
                  <tr key={l.id || idx} className="border-b border-gray-50">
                    <td className="px-4 py-2">
                      {editing ? (
                        <>
                          <input className={inputCls} value={l.nome || ""} onChange={(e) => setLinha(idx, "nome", e.target.value)} placeholder="Nome do item" />
                          <input
                            className={`${inputCls} mt-1 text-xs`}
                            value={l.notas || ""}
                            onChange={(e) => setLinha(idx, "notas", e.target.value)}
                            placeholder="Notas da linha"
                          />
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-gray-900">{l.nome || "—"}</div>
                          {l.notas && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{l.notas}</p>}
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
                    <td className="px-4 py-2">
                      {editing ? (
                        <input className={inputCls} value={l.unidade || "un"} onChange={(e) => setLinha(idx, "unidade", e.target.value)} />
                      ) : (
                        <span className="text-gray-600">{l.unidade || "un"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          step="0.01"
                          className={`${inputCls} text-right`}
                          value={l.preco_unit_cotado ?? ""}
                          onChange={(e) => setLinha(idx, "preco_unit_cotado", e.target.value === "" ? null : e.target.value)}
                          placeholder="—"
                        />
                      ) : (
                        l.preco_unit_cotado != null ? eur(l.preco_unit_cotado) : "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {sub != null ? eur(sub) : "—"}
                    </td>
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
                <td colSpan={4} className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total cotado</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">{linhasTotal > 0 ? eur(linhasTotal) : "—"}</td>
                {editing && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-400 mb-6">
        Criado em {fmtDate(pc?.created_at)}
      </div>

      <HistoricoTimeline tipo="pedido_cotacao" id={id} />
    </div>
  );
}
