import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Building2, FileText, Plus, Pencil, Trash2, Save, Upload, Image as ImageIcon, Hash, FileSpreadsheet, Download, Loader2, Mail, RotateCcw, Layers } from "lucide-react";
import { exportExcel, downloadImportTemplate, importExcel } from "@/lib/excelIo";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const MODULO_LABELS = { orcamento: "Orçamento", of: "Ordem de Fabrico", encomenda: "Encomenda" };
const FINALIDADES = [{ v: "ambos", l: "Ambos" }, { v: "cliente", l: "Cliente" }, { v: "interno", l: "Interno" }];
const emptyEmpresa = { nome: "", morada: "", codigo_postal: "", cidade: "", pais: "Portugal", nif: "", telefone: "", email: "", website: "", logo_base64: "", login_bg_base64: "", rodape: "", moeda_simbolo: "€", iva_taxa: 23, iva_isento: false, condicoes_pagamento: "" };

const MOEDAS = [
  { simbolo: "€", label: "Euro (€)" },
  { simbolo: "$", label: "Dólar americano ($)" },
  { simbolo: "£", label: "Libra esterlina (£)" },
  { simbolo: "R$", label: "Real brasileiro (R$)" },
  { simbolo: "CHF", label: "Franco suíço (CHF)" },
  { simbolo: "Kz", label: "Kwanza angolano (Kz)" },
  { simbolo: "MT", label: "Metical moçambicano (MT)" },
  { simbolo: "$", label: "Escudo cabo-verdiano ($)" },
];

const Inp = ({ label, val, onChange, tid, ph }) => (
  <div>
    <label className="text-sm font-medium text-gray-700 mb-1.5 block">{label}</label>
    <input data-testid={tid} value={val || ""} placeholder={ph} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
  </div>
);

function EmpresaTab() {
  const [form, setForm] = useState(emptyEmpresa);
  useEffect(() => { api.get("/settings/empresa").then((s) => setForm({ ...emptyEmpresa, ...s })); }, []);
  const upd = (k, v) => setForm({ ...form, [k]: v });

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 600 * 1024) return toast.error("Logótipo demasiado grande (máx. 600KB)");
    const reader = new FileReader();
    reader.onload = () => upd("logo_base64", reader.result);
    reader.readAsDataURL(file);
  };

  const onLoginBg = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast.error("Imagem demasiado grande (máx. 3MB)");
    const reader = new FileReader();
    reader.onload = () => upd("login_bg_base64", reader.result);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    try { await api.put("/settings/empresa", form); toast.success("Definições guardadas"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Erro ao guardar"); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm p-5 sm:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Building2 size={16} className="text-gray-400" /> Dados da Empresa (cabeçalho dos PDFs)</h2>
        <button data-testid="save-empresa-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2"><Save size={16} /> Guardar</button>
      </div>

      <div className="flex items-center gap-4 mb-5">
        <div className="w-28 h-20 border border-dashed border-gray-300 rounded-sm flex items-center justify-center overflow-hidden bg-gray-50 shrink-0">
          {form.logo_base64 ? <img src={form.logo_base64} alt="logo" className="max-w-full max-h-full object-contain" /> : <ImageIcon size={22} className="text-gray-300" />}
        </div>
        <div>
          <label className="inline-flex items-center gap-2 cursor-pointer border border-gray-300 rounded-sm px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Upload size={15} /> Carregar logótipo
            <input data-testid="logo-input" type="file" accept="image/*" onChange={onLogo} className="hidden" />
          </label>
          {form.logo_base64 && <button onClick={() => upd("logo_base64", "")} className="ml-2 text-sm text-red-600 hover:underline">Remover</button>}
          <p className="text-xs text-gray-400 mt-1">PNG/JPG, máx. 600KB.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Inp label="Nome da empresa" tid="emp-nome" val={form.nome} onChange={(v) => upd("nome", v)} />
        <Inp label="NIF" tid="emp-nif" val={form.nif} onChange={(v) => upd("nif", v)} />
        <Inp label="Morada" tid="emp-morada" val={form.morada} onChange={(v) => upd("morada", v)} />
        <div className="grid grid-cols-2 gap-3">
          <Inp label="Cód. Postal" tid="emp-cp" val={form.codigo_postal} onChange={(v) => upd("codigo_postal", v)} />
          <Inp label="Cidade" tid="emp-cidade" val={form.cidade} onChange={(v) => upd("cidade", v)} />
        </div>
        <Inp label="País" tid="emp-pais" val={form.pais} onChange={(v) => upd("pais", v)} />
        <Inp label="Telefone" tid="emp-tel" val={form.telefone} onChange={(v) => upd("telefone", v)} />
        <Inp label="Email" tid="emp-email" val={form.email} onChange={(v) => upd("email", v)} />
        <Inp label="Website" tid="emp-web" val={form.website} onChange={(v) => upd("website", v)} />
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700 mb-1.5 block">Rodapé do PDF (opcional)</label>
        <textarea data-testid="emp-rodape" value={form.rodape || ""} onChange={(e) => upd("rodape", e.target.value)} rows={2} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" placeholder="Ex.: Obrigado pela preferência · IVA incluído à taxa legal em vigor" />
      </div>

      <div className="mt-6 pt-5 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Fiscal e financeiro</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Moeda</label>
            <select data-testid="emp-moeda" value={form.moeda_simbolo || "€"} onChange={(e) => upd("moeda_simbolo", e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black">
              {!MOEDAS.some((m) => m.simbolo === form.moeda_simbolo) && form.moeda_simbolo && (
                <option value={form.moeda_simbolo}>{form.moeda_simbolo} (personalizado)</option>
              )}
              {MOEDAS.map((m) => <option key={m.label} value={m.simbolo}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Taxa de IVA (%)</label>
            <input data-testid="emp-iva-taxa" type="number" min="0" step="0.1" disabled={form.iva_isento} value={form.iva_taxa ?? 0} onChange={(e) => upd("iva_taxa", parseFloat(e.target.value) || 0)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:bg-gray-100 disabled:text-gray-400" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pb-2">
            <input data-testid="emp-iva-isento" type="checkbox" checked={!!form.iva_isento} onChange={(e) => upd("iva_isento", e.target.checked)} className="w-4 h-4 accent-black" />
            Isento de IVA (IVA = 0)
          </label>
        </div>
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">Condições de pagamento (impresso nos PDFs)</label>
          <textarea data-testid="emp-condicoes" value={form.condicoes_pagamento || ""} onChange={(e) => upd("condicoes_pagamento", e.target.value)} rows={2} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" placeholder="Ex.: Pagamento a 30 dias por transferência bancária · IBAN PT50..." />
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Ecrã de login</h3>
        <p className="text-xs text-gray-400 mb-4">Imagem de fundo do ecrã de início de sessão (substitui o fundo escuro).</p>
        <div className="flex items-center gap-4">
          <div className="w-40 h-24 border border-dashed border-gray-300 rounded-sm flex items-center justify-center overflow-hidden bg-gray-50 shrink-0">
            {form.login_bg_base64 ? <img src={form.login_bg_base64} alt="fundo login" className="w-full h-full object-cover" /> : <ImageIcon size={22} className="text-gray-300" />}
          </div>
          <div>
            <label className="inline-flex items-center gap-2 cursor-pointer border border-gray-300 rounded-sm px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Upload size={15} /> Carregar imagem de fundo
              <input data-testid="login-bg-input" type="file" accept="image/*" onChange={onLoginBg} className="hidden" />
            </label>
            {form.login_bg_base64 && <button data-testid="login-bg-remove" onClick={() => upd("login_bg_base64", "")} className="ml-2 text-sm text-red-600 hover:underline">Remover</button>}
            <p className="text-xs text-gray-400 mt-1">PNG/JPG, máx. 3MB. Recomenda-se uma imagem larga (ex.: 1920×1080).</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const emptyTpl = { nome: "", modulo: "encomenda", finalidade: "ambos", mostrar_branding: true, campos: {} };

function ModelosTab() {
  const [secoes, setSecoes] = useState({});
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyTpl);

  const load = async () => setItems(await api.get("/pdf-templates"));
  useEffect(() => { api.get("/pdf-secoes").then(setSecoes); load(); }, []);

  const allOn = (modulo) => {
    const o = {};
    (secoes[modulo] || []).forEach((s) => {
      o[s.key] = true;
      (s.campos || []).forEach((c) => { o[c.key] = true; });
    });
    return o;
  };

  const openNew = () => { setForm({ ...emptyTpl, campos: allOn("encomenda") }); setEditId(null); setOpen(true); };
  const openEdit = (t) => { setForm({ nome: t.nome, modulo: t.modulo, finalidade: t.finalidade || "ambos", mostrar_branding: t.mostrar_branding !== false, campos: t.campos || {} }); setEditId(t.id); setOpen(true); };
  const changeModulo = (m) => setForm({ ...form, modulo: m, campos: allOn(m) });

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome do modelo");
    try {
      if (editId) await api.put(`/pdf-templates/${editId}`, form);
      else await api.post("/pdf-templates", form);
      toast.success("Modelo guardado"); setOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Erro ao guardar"); }
  };
  const del = async (id) => { await api.delete(`/pdf-templates/${id}`); toast.success("Modelo removido"); load(); };

  const secoesModulo = secoes[form.modulo] || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><FileText size={16} className="text-gray-400" /> Modelos de PDF reutilizáveis</h2>
        <button data-testid="novo-modelo-btn" onClick={openNew} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2"><Plus size={16} /> Novo modelo</button>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-sm p-10 text-center text-sm text-gray-400">Sem modelos. Crie um modelo por módulo para escolher que campos aparecem no PDF.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((t) => {
            const onCount = Object.values(t.campos || {}).filter(Boolean).length;
            return (
              <div key={t.id} data-testid={`modelo-${t.id}`} className="bg-white border border-gray-200 rounded-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{t.nome}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{MODULO_LABELS[t.modulo]} · {t.finalidade} · {onCount} secções</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button data-testid={`edit-modelo-${t.id}`} onClick={() => openEdit(t)} className="p-1.5 rounded-sm hover:bg-gray-100 text-gray-500"><Pencil size={15} /></button>
                    <button data-testid={`del-modelo-${t.id}`} onClick={() => del(t.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  {t.mostrar_branding !== false && <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Branding</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{editId ? "Editar modelo" : "Novo modelo de PDF"}</DialogTitle>
            <DialogDescription>Escolha o módulo e quais as secções a incluir no PDF.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto">
            <Inp label="Nome do modelo" tid="modelo-nome" val={form.nome} onChange={(v) => setForm({ ...form, nome: v })} ph="Ex.: Confirmação de Encomenda" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Módulo</label>
                <select data-testid="modelo-modulo" disabled={!!editId} value={form.modulo} onChange={(e) => changeModulo(e.target.value)} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white disabled:bg-gray-100">
                  {Object.keys(MODULO_LABELS).map((m) => <option key={m} value={m}>{MODULO_LABELS[m]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Finalidade</label>
                <select data-testid="modelo-finalidade" value={form.finalidade} onChange={(e) => setForm({ ...form, finalidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white">
                  {FINALIDADES.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input data-testid="modelo-branding" type="checkbox" checked={!!form.mostrar_branding} onChange={(e) => setForm({ ...form, mostrar_branding: e.target.checked })} className="w-4 h-4 accent-black" />
              Mostrar dados/logótipo da empresa no cabeçalho
            </label>
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">Secções a incluir</div>
              <div className="space-y-2 border border-gray-200 rounded-sm p-3">
                {secoesModulo.map((s) => {
                  const secOn = form.campos[s.key] !== false;
                  return (
                    <div key={s.key}>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer">
                        <input data-testid={`secao-${s.key}`} type="checkbox" checked={secOn} onChange={(e) => setForm({ ...form, campos: { ...form.campos, [s.key]: e.target.checked } })} className="w-4 h-4 accent-black" />
                        {s.label}
                      </label>
                      {s.campos && (
                        <div className={`mt-1.5 ml-6 grid grid-cols-2 gap-x-4 gap-y-1 ${secOn ? "" : "opacity-40 pointer-events-none"}`}>
                          {s.campos.map((c) => (
                            <label key={c.key} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                              <input data-testid={`secao-${c.key}`} type="checkbox" checked={form.campos[c.key] !== false} onChange={(e) => setForm({ ...form, campos: { ...form.campos, [c.key]: e.target.checked } })} className="w-3.5 h-3.5 accent-black" />
                              {c.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-modelo-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Guardar modelo</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const GRUPO_LABELS = {
  catalogo: "Catálogo",
  negocio: "Negócio",
  documentos: "Documentos",
};

function ReferenciasTab() {
  const [refs, setRefs] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/settings/numeracao").then((d) => {
      setRefs(d.referencias || {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const upd = (key, patch) => setRefs((prev) => {
    const cur = { ...prev[key], ...patch };
    const digitos = Math.max(2, Math.min(8, Number(cur.digitos) || 4));
    const prefix = (cur.prefix || "").toUpperCase().replace(/\s/g, "");
    const year = new Date().getFullYear();
    const seq = "1".padStart(digitos, "0");
    cur.exemplo = cur.incluir_ano ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`;
    cur.digitos = digitos;
    cur.prefix = prefix;
    return { ...prev, [key]: cur };
  });

  const save = async () => {
    try {
      const payload = {};
      Object.entries(refs).forEach(([k, v]) => {
        payload[k] = { prefix: v.prefix, incluir_ano: !!v.incluir_ano, digitos: Number(v.digitos) || 4 };
      });
      const d = await api.put("/settings/numeracao", { referencias: payload });
      setRefs(d.referencias || {});
      toast.success("Referências guardadas");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    }
  };

  const backfill = async () => {
    try {
      const r = await api.post("/settings/numeracao/backfill", {});
      const n = Object.values(r.atribuidos || {}).reduce((a, b) => a + b, 0);
      toast.success(n ? `Atribuídos ${n} códigos em falta` : "Todos os registos já tinham código");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro no backfill");
    }
  };

  if (loading) return <div className="text-sm text-gray-500">A carregar…</div>;

  const groups = ["catalogo", "negocio", "documentos"];

  return (
    <div className="bg-white border border-gray-200 rounded-sm p-5 sm:p-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Hash size={16} className="text-gray-400" /> Referências sequenciais
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Códigos gerados automaticamente ao criar registos. Personaliza o prefixo (ex.: ART → SKU) e se inclui o ano.
            Alterações só afectam <span className="font-medium text-gray-700">novos</span> códigos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button data-testid="backfill-codigos-btn" onClick={backfill} className="bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-2 text-sm font-medium">
            Preencher em falta
          </button>
          <button data-testid="save-numeracao-btn" onClick={save} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
            <Save size={16} /> Guardar
          </button>
        </div>
      </div>

      {groups.map((g) => {
        const rows = Object.entries(refs).filter(([, v]) => v.grupo === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="mb-6 last:mb-0">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-3">{GRUPO_LABELS[g] || g}</h3>
            <div className="border border-gray-200 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Entidade</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Prefixo</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Ano</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Dígitos</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Exemplo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([key, v]) => (
                    <tr key={key} className="border-b border-gray-100 last:border-0" data-testid={`ref-row-${key}`}>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{v.label}</td>
                      <td className="px-3 py-2.5">
                        <input
                          data-testid={`ref-prefix-${key}`}
                          value={v.prefix || ""}
                          onChange={(e) => upd(key, { prefix: e.target.value })}
                          maxLength={12}
                          className="w-24 border border-gray-300 rounded-sm px-2 py-1.5 text-sm mono uppercase focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          data-testid={`ref-ano-${key}`}
                          type="checkbox"
                          checked={!!v.incluir_ano}
                          onChange={(e) => upd(key, { incluir_ano: e.target.checked })}
                          className="w-4 h-4 accent-black"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          data-testid={`ref-digitos-${key}`}
                          type="number"
                          min={2}
                          max={8}
                          value={v.digitos || 4}
                          onChange={(e) => upd(key, { digitos: e.target.value })}
                          className="w-16 border border-gray-300 rounded-sm px-2 py-1.5 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                        />
                      </td>
                      <td className="px-3 py-2.5 mono text-gray-600 tabular-nums">{v.exemplo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModulosTab() {
  const { isAdmin, refresh } = useAuth();
  const [packs, setPacks] = useState([]);
  const [modulos, setModulos] = useState([]);
  const [ativos, setAtivos] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get("/settings/modulos").then((r) => {
      setPacks(r.packs || []);
      setModulos(r.modulos || []);
      setAtivos(r.ativos || []);
    }).catch(() => toast.error("Não foi possível carregar os módulos"));
  };
  useEffect(() => { load(); }, []);

  const toggle = (key, core) => {
    if (core || !isAdmin) return;
    setAtivos((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/settings/modulos", { modulos: ativos });
      setAtivos(r.ativos || ativos);
      toast.success("Módulos actualizados. Os packs aplicam-se a este cliente.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar módulos");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm p-5 sm:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-2 gap-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Layers size={16} className="text-gray-400" /> Packs e módulos</h2>
        {isAdmin && (
          <button data-testid="save-modulos-btn" onClick={save} disabled={saving} className="bg-black text-white hover:bg-gray-800 disabled:opacity-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
            <Save size={16} /> Guardar
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5">Cada cliente (instalação) tem os módulos do seu pack. Os utilizadores só vêem o que está activo aqui, com as permissões do perfil.</p>
      <div className="space-y-5">
        {packs.map((p) => {
          const items = modulos.filter((m) => m.pack === p.key);
          if (!items.length) return null;
          return (
            <div key={p.key} data-testid={`pack-${p.key}`}>
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-2">{p.label}</div>
              <div className="border border-gray-200 rounded-sm divide-y divide-gray-100">
                {items.map((m) => {
                  const on = ativos.includes(m.key);
                  return (
                    <label
                      key={m.key}
                      data-testid={`modulo-row-${m.key}`}
                      className={`flex items-center justify-between gap-3 px-3 py-2.5 ${m.core || !isAdmin ? "cursor-default" : "cursor-pointer hover:bg-gray-50"}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">{m.label}</div>
                        {m.core && <div className="text-[11px] text-gray-400">Incluído na base — não se desliga</div>}
                      </div>
                      <input
                        data-testid={`modulo-toggle-${m.key}`}
                        type="checkbox"
                        checked={on}
                        disabled={!!m.core || !isAdmin}
                        onChange={() => toggle(m.key, m.core)}
                        className="h-4 w-4 accent-black"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Definicoes() {
  const [tab, setTab] = useState("empresa");
  return (
    <div>
      <PageHeader title="Definições" subtitle="Empresa, módulos, referências, dados Excel, modelos PDF e emails" />
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        {[["empresa", "Empresa"], ["modulos", "Módulos"], ["referencias", "Referências"], ["dados", "Dados"], ["modelos", "Modelos PDF"], ["emails", "Emails"]].map(([k, l]) => (
          <button key={k} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap ${tab === k ? "border-black text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"}`}>{l}</button>
        ))}
      </div>
      {tab === "empresa" && <EmpresaTab />}
      {tab === "modulos" && <ModulosTab />}
      {tab === "referencias" && <ReferenciasTab />}
      {tab === "dados" && <DadosTab />}
      {tab === "modelos" && <ModelosTab />}
      {tab === "emails" && <EmailsTab />}
    </div>
  );
}

function EmailsTab() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ subject: "", body: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const list = await api.get("/settings/email-templates");
    setItems(list || []);
    if (selected) {
      const fresh = (list || []).find((t) => t.tipo === selected.tipo);
      if (fresh) {
        setSelected(fresh);
        setForm({ subject: fresh.subject, body: fresh.body });
      }
    } else if (list?.length) {
      setSelected(list[0]);
      setForm({ subject: list[0].subject, body: list[0].body });
    }
  };

  useEffect(() => { load().catch(() => toast.error("Não foi possível carregar os templates")); }, []);

  const pick = (t) => {
    setSelected(t);
    setForm({ subject: t.subject, body: t.body });
  };

  const save = async () => {
    if (!selected) return;
    if (!form.subject.trim()) return toast.error("Assunto obrigatório");
    if (!form.body.trim()) return toast.error("Corpo do email obrigatório");
    setBusy(true);
    try {
      const updated = await api.put(`/settings/email-templates/${selected.tipo}`, {
        subject: form.subject.trim(),
        body: form.body,
      });
      toast.success("Template guardado");
      setSelected(updated);
      setForm({ subject: updated.subject, body: updated.body });
      setItems((prev) => prev.map((t) => (t.tipo === updated.tipo ? updated : t)));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao guardar");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!selected) return;
    if (!window.confirm("Repor o texto original deste template?")) return;
    setBusy(true);
    try {
      const updated = await api.post(`/settings/email-templates/${selected.tipo}/repor`);
      toast.success("Template reposto");
      setSelected(updated);
      setForm({ subject: updated.subject, body: updated.body });
      setItems((prev) => prev.map((t) => (t.tipo === updated.tipo ? updated : t)));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro ao repor");
    } finally {
      setBusy(false);
    }
  };

  const insertPlaceholder = (key) => {
    setForm((f) => ({ ...f, body: `${f.body}{${key}}` }));
  };

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-4">
        <Mail size={16} className="text-gray-400" /> Templates de email
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Edite o assunto e o texto dos emails automáticos. Use os placeholders (ex.: {"{nome}"}, {"{numero}"}) — são substituídos no envio.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
          {(items || []).map((t) => (
            <button
              key={t.tipo}
              type="button"
              data-testid={`email-tpl-${t.tipo}`}
              onClick={() => pick(t)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${
                selected?.tipo === t.tipo ? "bg-gray-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="text-sm font-medium text-gray-900">{t.nome}</div>
              <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.descricao}</div>
            </button>
          ))}
          {!items.length && <div className="px-4 py-6 text-sm text-gray-400">A carregar…</div>}
        </div>

        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-sm p-5 space-y-4">
          {!selected ? (
            <p className="text-sm text-gray-400">Seleccione um template à esquerda.</p>
          ) : (
            <>
              <div>
                <h3 className="text-base font-semibold text-gray-900 font-display">{selected.nome}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{selected.descricao}</p>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Assunto</label>
                <input
                  data-testid="email-tpl-subject"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Corpo</label>
                <textarea
                  data-testid="email-tpl-body"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={14}
                  className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black resize-y"
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-2">Placeholders</p>
                <div className="flex flex-wrap gap-1.5">
                  {(selected.placeholders || []).map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      title={p.label}
                      onClick={() => insertPlaceholder(p.key)}
                      className="text-xs mono bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-sm px-2 py-1 border border-gray-200"
                    >
                      {`{${p.key}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  data-testid="email-tpl-save"
                  disabled={busy}
                  onClick={save}
                  className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60"
                >
                  <Save size={15} /> {busy ? "A guardar..." : "Guardar"}
                </button>
                <button
                  type="button"
                  data-testid="email-tpl-reset"
                  disabled={busy}
                  onClick={reset}
                  className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60"
                >
                  <RotateCcw size={15} /> Repor original
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DadosTab() {
  const [entities, setEntities] = useState([]);
  const [selected, setSelected] = useState({});
  const [exporting, setExporting] = useState(false);
  const [importEntity, setImportEntity] = useState("clientes");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/io/entities").then((d) => {
      const list = d.entities || [];
      setEntities(list);
      const init = {};
      list.forEach((e) => { init[e.key] = ["clientes", "artigos", "materiais"].includes(e.key); });
      setSelected(init);
      const firstImport = list.find((e) => e.importable);
      if (firstImport) setImportEntity(firstImport.key);
    }).catch(() => toast.error("Não foi possível carregar entidades"));
  }, []);

  const toggle = (key) => setSelected((s) => ({ ...s, [key]: !s[key] }));
  const selectedKeys = entities.filter((e) => selected[e.key]).map((e) => e.key);

  const doExport = async () => {
    if (!selectedKeys.length) return toast.error("Seleccione pelo menos uma entidade");
    setExporting(true);
    try {
      await exportExcel(selectedKeys);
      toast.success("Excel descarregado");
    } catch (e) {
      toast.error(e?.message || "Erro ao exportar");
    } finally {
      setExporting(false);
    }
  };

  const doTemplate = async () => {
    try {
      await downloadImportTemplate(importEntity);
      toast.success("Template descarregado");
    } catch (e) {
      toast.error(e?.message || "Erro ao descarregar template");
    }
  };

  const runImport = async (dryRun) => {
    if (!file) return toast.error("Escolha um ficheiro .xlsx");
    setBusy(true);
    try {
      const res = await importExcel(importEntity, file, dryRun);
      setPreview(res);
      if (dryRun) {
        if (res.ok) toast.success(`Validação OK — ${res.created} novos, ${res.updated} actualizações`);
        else toast.error(`${res.errors?.length || 0} erro(s) na validação`);
      } else {
        if (res.ok) toast.success(`Importado: ${res.created} criados, ${res.updated} actualizados`);
        else toast.error("Importação com erros");
      }
    } catch (e) {
      toast.error(e?.message || "Erro na importação");
    } finally {
      setBusy(false);
    }
  };

  const importable = entities.filter((e) => e.importable);

  return (
    <div className="space-y-8 max-w-3xl" data-testid="dados-tab">
      <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
        <div>
          <h2 className="font-display text-lg text-gray-900 flex items-center gap-2"><FileSpreadsheet size={18} /> Exportar Excel</h2>
          <p className="text-sm text-gray-500 mt-1">Escolha os dados a incluir. Cada entidade vira uma folha no ficheiro.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {entities.map((e) => (
            <label key={e.key} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer py-1.5 px-2 rounded-sm hover:bg-gray-50">
              <input type="checkbox" checked={!!selected[e.key]} onChange={() => toggle(e.key)} data-testid={`export-check-${e.key}`} className="h-4 w-4" />
              {e.label}
              {!e.importable && <span className="text-[10px] uppercase tracking-wide text-gray-400">só export</span>}
            </label>
          ))}
        </div>
        <button
          data-testid="export-selected-btn"
          type="button"
          disabled={exporting}
          onClick={doExport}
          className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Exportar seleccionados
        </button>
      </section>

      <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
        <div>
          <h2 className="font-display text-lg text-gray-900 flex items-center gap-2"><Upload size={18} /> Importar Excel</h2>
          <p className="text-sm text-gray-500 mt-1">
            Descarregue o template, preencha no Excel e valide antes de gravar. Upsert por código (máx. 5000 linhas).
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Entidade</label>
            <select
              data-testid="import-entity-select"
              value={importEntity}
              onChange={(e) => { setImportEntity(e.target.value); setPreview(null); setFile(null); }}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
            >
              {importable.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Ficheiro .xlsx</label>
            <input
              data-testid="import-file-input"
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }}
              className="w-full text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={doTemplate} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2">
            <Download size={16} /> Template
          </button>
          <button
            data-testid="import-validate-btn"
            type="button"
            disabled={busy}
            onClick={() => runImport(true)}
            className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Validar
          </button>
          <button
            data-testid="import-commit-btn"
            type="button"
            disabled={busy || !preview?.ok}
            onClick={() => runImport(false)}
            className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Confirmar importação
          </button>
        </div>
        {preview && (
          <div className="border border-gray-200 rounded-sm p-3 text-sm space-y-2" data-testid="import-preview">
            <div className="text-gray-700">
              {preview.dry_run ? "Pré-visualização" : "Resultado"}:{" "}
              <span className="font-medium">{preview.created}</span> criar,{" "}
              <span className="font-medium">{preview.updated}</span> actualizar
              {preview.errors?.length ? <> · <span className="text-red-600">{preview.errors.length} erros</span></> : null}
            </div>
            {preview.errors?.length > 0 && (
              <ul className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-sm p-2 max-h-40 overflow-auto space-y-1">
                {preview.errors.slice(0, 30).map((err, i) => (
                  <li key={i}>Linha {err.linha}{err.folha ? ` (${err.folha})` : ""}: {err.erro}</li>
                ))}
              </ul>
            )}
            {preview.preview?.length > 0 && !preview.errors?.length && (
              <ul className="text-xs text-gray-600 max-h-32 overflow-auto space-y-0.5">
                {preview.preview.slice(0, 15).map((p, i) => (
                  <li key={i}>{p.acao}: {p.codigo} — {p.nome}</li>
                ))}
                {preview.preview_total > 15 && <li>… e mais {preview.preview_total - 15}</li>}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
