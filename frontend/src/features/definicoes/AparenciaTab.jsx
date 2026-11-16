import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Save, Check, Search, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTema } from "@/context/TemaContext";
import { TEMA_DEFAULT, corEscura, normalizarTema } from "@/lib/tema";

const CORES = [
  { key: "cor_principal", label: "Cor principal", ajuda: "Botões principais, item ativo do menu e filtros selecionados." },
  { key: "cor_menu", label: "Barra lateral (menu)", ajuda: "Fundo do menu. O texto ajusta-se sozinho para ficar legível." },
  { key: "cor_fundo", label: "Fundo das páginas", ajuda: "Cor por trás das tabelas e cartões." },
  { key: "cor_destaque", label: "Cor de destaque", ajuda: "Ligações e pequenos realces." },
];

const CANTOS = [
  { key: "retos", label: "Retos" },
  { key: "suaves", label: "Suaves" },
  { key: "arredondados", label: "Arredondados" },
];

/** Definições → Aparência: cores, cantos e logótipo, com pré-visualização ao vivo. */
export default function AparenciaTab() {
  const { isAdmin } = useAuth();
  const { recarregar, preVisualizar } = useTema();
  const [form, setForm] = useState(TEMA_DEFAULT);
  const [guardado, setGuardado] = useState(TEMA_DEFAULT);
  const [presets, setPresets] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/settings/aparencia")
      .then((r) => {
        const t = normalizarTema(r.tema);
        setForm(t);
        setGuardado(t);
        setPresets(r.presets || []);
      })
      .catch(() => toast.error("Não foi possível carregar a aparência"));
  }, []);

  // Pré-visualização ao vivo; ao sair sem guardar, repõe o tema guardado.
  useEffect(() => { preVisualizar(form); }, [form, preVisualizar]);
  useEffect(() => () => { recarregar(); }, [recarregar]);

  const sujo = useMemo(() => JSON.stringify(form) !== JSON.stringify(guardado), [form, guardado]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function guardar() {
    setBusy(true);
    try {
      const r = await api.put("/settings/aparencia", form);
      const t = normalizarTema(r.tema);
      setGuardado(t);
      setForm(t);
      await recarregar();
      toast.success("Aparência guardada para todos os utilizadores");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-5" data-testid="aparencia-tab">
      <div className="space-y-5">
        <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-700">Temas prontos</h2>
            <p className="text-xs text-gray-500 mt-0.5">Escolha um ponto de partida e ajuste as cores à vontade.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.nome}
                type="button"
                disabled={!isAdmin}
                onClick={() => setForm((f) => ({ ...f, ...p, nome: undefined }))}
                className="flex items-center gap-2 border border-gray-200 hover:border-gray-400 rounded-sm px-3 py-2 text-sm disabled:opacity-50"
                data-testid={`tema-preset-${p.nome}`}
              >
                <span className="flex -space-x-1">
                  {[p.cor_menu, p.cor_principal, p.cor_destaque].map((c, i) => (
                    <span key={i} className="w-4 h-4 rounded-full border border-white ring-1 ring-gray-200" style={{ background: c }} />
                  ))}
                </span>
                {p.nome}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-700">Cores</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CORES.map((c) => (
              <label key={c.key} className="flex items-start gap-3">
                <input
                  type="color"
                  value={form[c.key]}
                  disabled={!isAdmin}
                  onChange={(e) => set(c.key, e.target.value)}
                  className="w-11 h-11 shrink-0 border border-gray-300 rounded-sm cursor-pointer bg-white p-0.5"
                  data-testid={`tema-${c.key}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                  <input
                    value={form[c.key]}
                    disabled={!isAdmin}
                    onChange={(e) => set(c.key, e.target.value)}
                    className="mt-0.5 w-24 border border-gray-300 rounded-sm px-2 py-0.5 text-xs font-mono"
                  />
                  <span className="block text-xs text-gray-500 mt-1">{c.ajuda}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-700">Formas e logótipo</h2>
          <div>
            <div className="text-sm font-medium text-gray-900 mb-2">Cantos de botões, caixas e cartões</div>
            <div className="inline-flex border border-gray-300 rounded-sm overflow-hidden">
              {CANTOS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => set("cantos", c.key)}
                  className={`px-4 py-2 text-sm ${form.cantos === c.key ? "bg-brand text-brand-fg" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  data-testid={`tema-cantos-${c.key}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!form.usar_logo_empresa}
              disabled={!isAdmin}
              onChange={(e) => set("usar_logo_empresa", e.target.checked)}
              data-testid="tema-usar-logo"
            />
            <span>
              <span className="font-medium text-gray-900">Usar o logótipo da empresa na barra lateral</span>
              <span className="block text-xs text-gray-500">O logótipo carrega-se em Definições → Empresa.</span>
            </span>
          </label>
        </section>

        {isAdmin ? (
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={() => setForm(TEMA_DEFAULT)} className="border border-gray-300 bg-white hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium inline-flex items-center gap-2">
              <RotateCcw size={15} /> Repor original
            </button>
            <button type="button" onClick={guardar} disabled={busy || !sujo} className="btn btn-primario" data-testid="tema-guardar">
              <Save size={15} /> {busy ? "A guardar..." : "Guardar aparência"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Só os administradores podem alterar a aparência.</p>
        )}
      </div>

      <aside className="xl:sticky xl:top-20 self-start">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">Pré-visualização</div>
        <div className="border border-gray-200 rounded-sm overflow-hidden flex h-72 shadow-sm">
          <div className="w-28 bg-sidebar border-r border-sidebar-border p-2 space-y-1">
            <div className={`text-[11px] font-bold mb-2 ${corEscura(form.cor_menu) ? "text-white" : "text-gray-900"}`}>Menu</div>
            <div className="text-[11px] px-2 py-1 rounded-sm bg-brand text-brand-fg">Orçamentos</div>
            <div className="text-[11px] px-2 py-1 rounded-sm text-sidebar-fg">Encomendas</div>
            <div className="text-[11px] px-2 py-1 rounded-sm text-sidebar-fg">Clientes</div>
          </div>
          <div className="flex-1 bg-appbg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-900">Orçamentos</span>
              <span className="text-[11px] px-2 py-1 rounded-sm bg-brand text-brand-fg inline-flex items-center gap-1"><Plus size={11} /> Novo</span>
            </div>
            <div className="flex items-center gap-1 border border-gray-300 rounded-sm bg-white px-2 py-1 text-[11px] text-gray-400"><Search size={11} /> Pesquisar...</div>
            <div className="flex gap-1">
              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-brand text-brand-fg">Todos</span>
              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-white border border-gray-300 text-gray-600">Abertos</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-sm p-2 space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between text-[10px] text-gray-600">
                  <span>ORC-2026-000{i}</span>
                  <span className="text-destaque underline">ver</span>
                </div>
              ))}
            </div>
            <div className="inline-flex items-center gap-1 text-[10px] text-gray-600"><Check size={11} className="text-destaque" /> Guardado</div>
          </div>
        </div>
      </aside>
    </div>
  );
}
