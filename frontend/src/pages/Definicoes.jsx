import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { toast } from "sonner";
import { Building2, FileText, Plus, Pencil, Trash2, Save, Upload, Image as ImageIcon } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

const MODULO_LABELS = { orcamento: "Orçamento", of: "Ordem de Fabrico", encomenda: "Encomenda" };
const FINALIDADES = [{ v: "ambos", l: "Ambos" }, { v: "cliente", l: "Cliente" }, { v: "interno", l: "Interno" }];
const emptyEmpresa = { nome: "", morada: "", codigo_postal: "", cidade: "", pais: "Portugal", nif: "", telefone: "", email: "", website: "", logo_base64: "", rodape: "" };

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

export default function Definicoes() {
  const [tab, setTab] = useState("empresa");
  return (
    <div>
      <PageHeader title="Definições" subtitle="Branding da empresa e modelos de PDF" />
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {[["empresa", "Empresa"], ["modelos", "Modelos PDF"]].map(([k, l]) => (
          <button key={k} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === k ? "border-black text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"}`}>{l}</button>
        ))}
      </div>
      {tab === "empresa" ? <EmpresaTab /> : <ModelosTab />}
    </div>
  );
}
