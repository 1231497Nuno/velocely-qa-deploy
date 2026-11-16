import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Phone, Mail, MessageCircle, Trash2, FileText, UserCheck, UserPlus, Unlink, Plus, Send, ExternalLink,
} from "lucide-react";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import ConverterDialog from "./ConverterDialog";
import CamposPersonalizados from "@/components/CamposPersonalizados";
import {
  TIPOS_INTERACAO, apiError, btnPrimary, btnSecondary, fmtDateTime, fromLocalInput, inputCls, labelCls,
  linkWhatsApp, tipoInteracao, tituloLead, toLocalInput,
} from "./crmShared";

const VAZIO = {
  nome: "", empresa: "", telefone: "", email: "", origem: "", descricao: "", valor_estimado: "",
  estado_id: "", responsavel_id: "", proxima_acao_at: "", proxima_acao_nota: "", motivo_perda: "",
  campos_extra: {},
};

function formDoLead(lead) {
  if (!lead) return VAZIO;
  return {
    nome: lead.nome || "",
    empresa: lead.empresa || "",
    telefone: lead.telefone || "",
    email: lead.email || "",
    origem: lead.origem || "",
    descricao: lead.descricao || "",
    valor_estimado: lead.valor_estimado ?? "",
    estado_id: lead.estado_id || "",
    responsavel_id: lead.responsavel_id || "",
    proxima_acao_at: toLocalInput(lead.proxima_acao_at),
    proxima_acao_nota: lead.proxima_acao_nota || "",
    motivo_perda: lead.motivo_perda || "",
    campos_extra: lead.campos_extra || {},
  };
}

/**
 * Painel lateral do lead — criar (leadId=null) ou consultar/editar.
 * novoEstadoId: estado inicial quando se cria a partir de uma coluna.
 */
export default function LeadSheet({ open, onOpenChange, leadId, novoEstadoId, estados, meta, onChanged, onDeleted }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [lead, setLead] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inter, setInter] = useState({ tipo: "nota", texto: "" });
  const [converterOpen, setConverterOpen] = useState(false);
  const [criarOrcDepois, setCriarOrcDepois] = useState(false);

  const novo = !leadId;
  const canEdit = novo ? can("crm", "create") : can("crm", "edit");
  const estadoAtual = useMemo(() => estados.find((e) => e.id === form.estado_id), [estados, form.estado_id]);

  useEffect(() => {
    if (!open) return;
    setInter({ tipo: "nota", texto: "" });
    if (novo) {
      setLead(null);
      setForm({ ...VAZIO, estado_id: novoEstadoId || estados.find((e) => e.tipo === "aberto")?.id || estados[0]?.id || "" });
      return;
    }
    let vivo = true;
    setLoading(true);
    api.get(`/crm/leads/${leadId}`)
      .then((l) => { if (vivo) { setLead(l); setForm(formDoLead(l)); } })
      .catch((e) => { toast.error(apiError(e, "Não foi possível abrir o lead")); onOpenChange(false); })
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const sujo = useMemo(() => novo || JSON.stringify(form) !== JSON.stringify(formDoLead(lead)), [novo, form, lead]);

  function aplicar(l) {
    setLead(l);
    setForm(formDoLead(l));
    onChanged?.(l);
  }

  async function guardar() {
    if (!form.nome.trim() && !form.empresa.trim()) {
      toast.error("Indique o nome do contacto ou da empresa");
      return;
    }
    setSaving(true);
    const body = {
      ...form,
      valor_estimado: form.valor_estimado === "" ? null : Number(form.valor_estimado),
      proxima_acao_at: fromLocalInput(form.proxima_acao_at),
    };
    try {
      if (novo) {
        const criado = await api.post("/crm/leads", body);
        toast.success("Lead criado");
        onChanged?.(criado, { criado: true });
      } else {
        aplicar(await api.put(`/crm/leads/${lead.id}`, body));
        toast.success("Lead guardado");
      }
    } catch (e) {
      toast.error(apiError(e, "Não foi possível guardar"));
    } finally {
      setSaving(false);
    }
  }

  async function adicionarInteracao() {
    if (!inter.texto.trim()) return;
    try {
      await api.post(`/crm/leads/${lead.id}/interacoes`, inter);
      setInter({ tipo: inter.tipo, texto: "" });
      aplicar(await api.get(`/crm/leads/${lead.id}`));
    } catch (e) {
      toast.error(apiError(e, "Não foi possível registar"));
    }
  }

  async function apagarInteracao(i) {
    const ok = await confirm({ title: "Apagar registo?", description: i.texto, confirmLabel: "Apagar", tone: "danger" });
    if (!ok) return;
    try {
      await api.del(`/crm/leads/${lead.id}/interacoes/${i.id}`);
      aplicar(await api.get(`/crm/leads/${lead.id}`));
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function apagarLead() {
    const ok = await confirm({
      title: "Eliminar lead?",
      description: `«${tituloLead(lead)}» e todo o histórico de interações serão eliminados. Os clientes e orçamentos associados mantêm-se.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.del(`/crm/leads/${lead.id}`);
      toast.success("Lead eliminado");
      onDeleted?.(lead.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function desassociar() {
    const ok = await confirm({
      title: "Desassociar cliente?",
      description: `O lead deixa de estar ligado a «${lead.cliente_nome}». O cliente não é apagado.`,
      confirmLabel: "Desassociar",
    });
    if (!ok) return;
    try {
      aplicar(await api.post(`/crm/leads/${lead.id}/desassociar-cliente`, {}));
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function criarOrcamento(base = lead) {
    if (!base.cliente_id) {
      setCriarOrcDepois(true);
      setConverterOpen(true);
      return;
    }
    try {
      const orc = await api.post("/orcamentos", {
        cliente_id: base.cliente_id,
        cliente: base.cliente_nome,
        descricao: base.descricao || "",
      });
      await api.post(`/crm/leads/${base.id}/orcamentos`, { orcamento_id: orc.id });
      toast.success("Orçamento criado");
      onOpenChange(false);
      nav(`/orcamentos/${orc.id}`, { state: { edit: true } });
    } catch (e) {
      toast.error(apiError(e, "Não foi possível criar o orçamento"));
    }
  }

  const wa = linkWhatsApp(form.telefone);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col gap-0" data-testid="crm-lead-sheet">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-gray-200 text-left space-y-1">
          <div className="flex items-center gap-2 pr-8">
            {!novo && lead && (
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm ${lead.is_cliente ? "bg-emerald-600 text-white" : "bg-blue-100 text-blue-700"}`}>
                {lead.is_cliente ? "Cliente" : "Lead"}
              </span>
            )}
            <SheetTitle className="text-lg font-bold truncate">{novo ? "Novo lead" : tituloLead(lead || form)}</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            {novo ? "Registe um contacto novo no funil." : lead ? `Criado a ${fmtDate(lead.created_at)} por ${lead.criado_por_nome || "—"}` : "A carregar..."}
          </SheetDescription>
          {!novo && (form.telefone || form.email) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {form.telefone && (
                <a href={`tel:${form.telefone}`} className={btnSecondary + " btn-sm"}><Phone size={13} /> Ligar</a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className={btnSecondary + " btn-sm"}><MessageCircle size={13} /> WhatsApp</a>
              )}
              {form.email && (
                <a href={`mailto:${form.email}`} className={btnSecondary + " btn-sm"}><Mail size={13} /> Email</a>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading ? (
            <p className="text-sm text-gray-500">A carregar...</p>
          ) : (
            <>
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Empresa</label>
                  <input className={inputCls} value={form.empresa} onChange={set("empresa")} disabled={!canEdit} placeholder="Vazio se for particular" data-testid="crm-lead-empresa" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Pessoa de contacto</label>
                  <input className={inputCls} value={form.nome} onChange={set("nome")} disabled={!canEdit} data-testid="crm-lead-nome" />
                </div>
                <div>
                  <label className={labelCls}>Telefone</label>
                  <input className={inputCls} value={form.telefone} onChange={set("telefone")} disabled={!canEdit} inputMode="tel" data-testid="crm-lead-telefone" />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input className={inputCls} type="email" value={form.email} onChange={set("email")} disabled={!canEdit} data-testid="crm-lead-email" />
                </div>
                <div>
                  <label className={labelCls}>Origem</label>
                  <input className={inputCls} list="crm-origens" value={form.origem} onChange={set("origem")} disabled={!canEdit} placeholder="Instagram, WhatsApp..." data-testid="crm-lead-origem" />
                  <datalist id="crm-origens">
                    {(meta.origens || []).map((o) => <option key={o} value={o} />)}
                  </datalist>
                </div>
                <div>
                  <label className={labelCls}>Valor estimado (€)</label>
                  <input className={inputCls} type="number" min="0" step="0.01" value={form.valor_estimado} onChange={set("valor_estimado")} disabled={!canEdit} data-testid="crm-lead-valor" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>O que pretende</label>
                  <textarea className={inputCls + " min-h-[4.5rem]"} value={form.descricao} onChange={set("descricao")} disabled={!canEdit} placeholder="Ex.: 50 t-shirts com logótipo para evento em março" data-testid="crm-lead-descricao" />
                </div>
                <div>
                  <label className={labelCls}>Estado</label>
                  <select className={inputCls} value={form.estado_id} onChange={set("estado_id")} disabled={!canEdit} data-testid="crm-lead-estado">
                    {estados.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Responsável</label>
                  <select className={inputCls} value={form.responsavel_id} onChange={set("responsavel_id")} disabled={!canEdit} data-testid="crm-lead-responsavel">
                    <option value="">— Sem responsável —</option>
                    {(meta.responsaveis || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </div>
                {estadoAtual?.tipo === "perdido" && (
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Motivo da perda</label>
                    <input className={inputCls} value={form.motivo_perda} onChange={set("motivo_perda")} disabled={!canEdit} placeholder="Preço, prazo, foi para a concorrência..." />
                  </div>
                )}
                <div>
                  <label className={labelCls}>Próxima ação</label>
                  <input className={inputCls} type="datetime-local" value={form.proxima_acao_at} onChange={set("proxima_acao_at")} disabled={!canEdit} data-testid="crm-lead-proxima" />
                </div>
                <div>
                  <label className={labelCls}>O que fazer</label>
                  <input className={inputCls} value={form.proxima_acao_nota} onChange={set("proxima_acao_nota")} disabled={!canEdit} placeholder="Ligar a confirmar quantidades" />
                </div>
              </section>

              <CamposPersonalizados
                modulo="crm"
                titulo="Outros dados"
                className="!p-0 !border-0"
                value={form.campos_extra}
                disabled={!canEdit}
                onChange={(vals) => setForm((f) => ({ ...f, campos_extra: vals }))}
              />

              {canEdit && (
                <div className="flex justify-end">
                  <button type="button" className={btnPrimary} onClick={guardar} disabled={saving || !sujo} data-testid="crm-lead-save">
                    {saving ? "A guardar..." : novo ? "Criar lead" : "Guardar alterações"}
                  </button>
                </div>
              )}

              {!novo && lead && (
                <>
                  <section className="border-t border-gray-200 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-2">Cliente</h4>
                    {lead.is_cliente ? (
                      <div className="flex items-center justify-between gap-2 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <Link to={`/clientes/${lead.cliente_id}`} className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 hover:underline" data-testid="crm-lead-cliente-link">
                          <UserCheck size={15} /> {lead.cliente_nome}
                        </Link>
                        {can("crm", "edit") && (
                          <button type="button" onClick={desassociar} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
                            <Unlink size={13} /> Desassociar
                          </button>
                        )}
                      </div>
                    ) : (
                      can("crm", "edit") && (
                        <button type="button" className={btnSecondary} onClick={() => { setCriarOrcDepois(false); setConverterOpen(true); }} data-testid="crm-lead-converter">
                          <UserPlus size={15} /> Converter em cliente
                        </button>
                      )
                    )}
                  </section>

                  <section className="border-t border-gray-200 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Orçamentos</h4>
                      {can("orcamentos", "create") && can("crm", "edit") && (
                        <button type="button" className={btnSecondary + " btn-sm"} onClick={() => criarOrcamento()} data-testid="crm-lead-novo-orc">
                          <Plus size={13} /> Novo orçamento
                        </button>
                      )}
                    </div>
                    {(lead.orcamentos || []).length === 0 ? (
                      <p className="text-sm text-gray-500">Ainda sem orçamentos.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-sm">
                        {lead.orcamentos.map((o) => (
                          <li key={o.id}>
                            <Link to={`/orcamentos/${o.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <FileText size={14} className="text-gray-400 shrink-0" />
                                <span className="font-medium">{o.numero || "Rascunho"}</span>
                                <span className="text-xs text-gray-500 capitalize truncate">{o.status}</span>
                              </span>
                              <span className="inline-flex items-center gap-2 tabular-nums text-gray-800">
                                {eur(o.total)} <ExternalLink size={12} className="text-gray-400" />
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="border-t border-gray-200 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-2">Interações</h4>
                    {can("crm", "edit") && (
                      <div className="rounded-sm border border-gray-200 p-2 mb-3 space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {TIPOS_INTERACAO.map((t) => {
                            const Icon = t.icon;
                            return (
                              <button
                                key={t.key}
                                type="button"
                                onClick={() => setInter((i) => ({ ...i, tipo: t.key }))}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-sm border ${inter.tipo === t.key ? "bg-brand text-brand-fg border-brand" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                              >
                                <Icon size={12} /> {t.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <textarea
                            className={inputCls + " min-h-[2.5rem]"}
                            value={inter.texto}
                            onChange={(e) => setInter((i) => ({ ...i, texto: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) adicionarInteracao(); }}
                            placeholder="O que foi falado? (Ctrl+Enter para registar)"
                            data-testid="crm-lead-interacao-texto"
                          />
                          <button type="button" className={btnPrimary + " self-end"} onClick={adicionarInteracao} disabled={!inter.texto.trim()} title="Registar" data-testid="crm-lead-interacao-add">
                            <Send size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                    <ol className="space-y-3" data-testid="crm-lead-timeline">
                      {(lead.interacoes || []).map((i) => {
                        const t = tipoInteracao(i.tipo);
                        const Icon = t.icon;
                        const sistema = i.tipo === "sistema";
                        return (
                          <li key={i.id} className="flex gap-2.5 group">
                            <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${sistema ? "bg-gray-100 text-gray-400" : "bg-brand text-brand-fg"}`}>
                              <Icon size={12} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
                                <span>{t.label} · {i.autor_nome} · {fmtDateTime(i.at)}</span>
                                {!sistema && can("crm", "edit") && (
                                  <button type="button" onClick={() => apagarInteracao(i)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600" title="Apagar">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                              <p className={`text-sm whitespace-pre-line ${sistema ? "text-gray-500" : "text-gray-900"}`}>{i.texto}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>

                  {can("crm", "delete") && (
                    <section className="border-t border-gray-200 pt-4 pb-2">
                      <button type="button" onClick={apagarLead} className="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1.5" data-testid="crm-lead-delete">
                        <Trash2 size={14} /> Eliminar lead
                      </button>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {lead && (
          <ConverterDialog
            open={converterOpen}
            onOpenChange={setConverterOpen}
            lead={lead}
            canCreateCliente={can("clientes", "create")}
            onDone={(l) => {
              setConverterOpen(false);
              aplicar(l);
              if (criarOrcDepois) {
                setCriarOrcDepois(false);
                criarOrcamento(l);
              }
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
