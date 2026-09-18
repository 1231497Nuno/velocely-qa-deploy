import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, eur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { Plus, X, Calculator, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  emptyArtigoForm,
  buildArtigoBody,
  mostraCampo,
} from "@/features/artigos/artigoTipos";
import ArtigoBlocosShell from "@/features/artigos/ArtigoBlocosShell";
import ArtigoFichaCampos from "@/features/artigos/ArtigoFichaCampos";

const toHours = (val, unit) => (Number(val) || 0) / (unit === "h" ? 1 : 60);
const maqHora = (m) => (m ? (Number(m.custo_amortizacao_hora) || 0) + (Number(m.custo_energia_hora) || 0) : 0);
const fieldCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";

export default function ArtigoNovo() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [form, setForm] = useState(emptyArtigoForm);
  const [maquinas, setMaquinas] = useState([]);
  const [componentes, setComponentes] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!can("artigos", "create")) {
      toast.error("Sem permissão para criar artigos");
      nav("/artigos");
    }
  }, [can, nav]);

  useEffect(() => {
    (async () => {
      try {
        const [maq, mo, cats, subs, artsCons, artsAtivo] = await Promise.all([
          api.get("/maquinas"),
          api.get("/mao-obra"),
          api.get("/categorias"),
          api.get("/subcategorias"),
          api.get("/artigos?lite=true&tipo=consumivel").catch(() => []),
          api.get("/artigos?lite=true&tipo=ativo").catch(() => []),
        ]);
        setMaquinas(maq || []);
        setMaoObra(mo || []);
        setCategorias(cats || []);
        setSubcategorias(subs || []);
        const list = [...(Array.isArray(artsCons) ? artsCons : artsCons?.items || [])];
        const ativos = Array.isArray(artsAtivo) ? artsAtivo : artsAtivo?.items || [];
        const byId = new Map(list.map((a) => [a.id, a]));
        for (const a of ativos) if (!byId.has(a.id)) byId.set(a.id, a);
        try {
          const cons = await api.get("/consumiveis");
          for (const c of cons || []) {
            if (!byId.has(c.id)) {
              byId.set(c.id, { id: c.id, nome: c.nome, unidade: c.unidade, custo_artigo: c.custo_unitario, codigo: c.codigo });
            }
          }
        } catch { /* ignore */ }
        setComponentes([...byId.values()].sort((a, b) => (a.nome || "").localeCompare(b.nome || "")));
      } catch {
        toast.error("Erro a carregar dados de apoio");
      }
    })();
  }, []);

  const tipo = form.tipo_artigo || "ativo";
  const show = (campo) => mostraCampo(tipo, campo);
  const produzido = tipo === "ativo" && !!form.produzido;

  const setTipo = (tipo_artigo) => {
    setForm((prev) => ({
      ...prev,
      tipo_artigo,
      produzido: tipo_artigo === "ativo" ? prev.produzido : false,
      margem: tipo_artigo === "consumivel" ? 0 : (prev.margem ?? 30),
      materiais: tipo_artigo === "ativo" && prev.produzido ? prev.materiais : [],
      roteiro: tipo_artigo === "ativo" && prev.produzido ? prev.roteiro : [],
      comprimento_mm: tipo_artigo === "servico" ? 0 : prev.comprimento_mm,
      largura_mm: tipo_artigo === "servico" ? 0 : prev.largura_mm,
      espessura_mm: tipo_artigo === "servico" ? 0 : prev.espessura_mm,
      peso_kg: tipo_artigo === "servico" ? 0 : prev.peso_kg,
    }));
  };

  const setProduzido = (checked) => {
    setForm((prev) => ({
      ...prev,
      produzido: checked,
      materiais: checked ? prev.materiais : [],
      roteiro: checked ? prev.roteiro : [],
    }));
  };

  const setCategoria = (categoria_id) => {
    const cat = categorias.find((c) => c.id === categoria_id);
    setForm((prev) => ({
      ...prev,
      categoria_id: categoria_id || "",
      categoria_nome: cat?.nome || "",
      subcategoria_id: "",
      subcategoria_nome: "",
    }));
  };

  const setSubcategoria = (subcategoria_id) => {
    const sub = subcategorias.find((s) => s.id === subcategoria_id);
    setForm((prev) => ({
      ...prev,
      subcategoria_id: subcategoria_id || "",
      subcategoria_nome: sub?.nome || "",
    }));
  };

  const updMat = (i, patch) => {
    setForm((p) => {
      const materiais = [...(p.materiais || [])];
      materiais[i] = { ...materiais[i], ...patch };
      return { ...p, materiais };
    });
  };
  const updOp = (i, patch) => {
    setForm((p) => {
      const roteiro = [...(p.roteiro || [])];
      roteiro[i] = { ...roteiro[i], ...patch };
      return { ...p, roteiro };
    });
  };

  const custoMateriais = (form.materiais || []).reduce((s, m) => s + (Number(m.quantidade) || 0) * (Number(m.custo_unitario) || 0), 0);
  const custoMaquinas = (form.roteiro || []).reduce((s, op) => {
    const maq = maquinas.find((x) => x.id === op.maquina_id);
    return s + toHours(op.tempo_maquina, op.tempo_maquina_unidade) * maqHora(maq);
  }, 0);
  const custoMaoObra = (form.roteiro || []).reduce((s, op) => {
    const mo = maoObra.find((x) => x.id === op.mao_obra_id);
    return s + toHours(op.tempo_mao_obra, op.tempo_mao_obra_unidade) * (mo ? Number(mo.custo_hora) || 0 : 0);
  }, 0);
  const custoTotal = (Number(form.custo_artigo) || 0) + (produzido ? custoMateriais + custoMaquinas + custoMaoObra : 0);
  const margemPct = tipo === "consumivel" ? 0 : (Number(form.margem) || 0);
  const precoVenda = custoTotal * (1 + margemPct / 100);

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Indique o nome do artigo");
    setSaving(true);
    try {
      const created = await api.post("/artigos", buildArtigoBody(form));
      toast.success("Artigo criado");
      nav(`/artigos/${created.id}`);
    } catch (e) {
      toast.error(e?.message || "Erro ao criar artigo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/artigos")} testid="artigo-novo-back" label="Voltar aos artigos" />}
        title={<h1 className="text-lg sm:text-xl font-bold font-display text-gray-900">Novo artigo</h1>}
        subtitle="Escolha o tipo — os campos adaptam-se automaticamente"
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => nav("/artigos")} className="bg-white border border-gray-300 rounded-sm px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              data-testid="artigo-novo-guardar"
              disabled={saving}
              onClick={save}
              className="bg-black text-white rounded-sm px-3 py-1.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-60"
            >
              {saving ? "A guardar…" : "Guardar"}
            </button>
          </div>
        }
      />

      <ArtigoBlocosShell
        tipo={tipo}
        produzido={produzido}
        renderBlock={(blocoId) => {
          if (["detalhes", "dimensoes", "preco", "stock"].includes(blocoId)) {
            return (
              <ArtigoFichaCampos
                blocoId={blocoId}
                artigo={form}
                draft={form}
                editing
                canEdit
                categorias={categorias}
                subcategorias={subcategorias}
                precoVenda={precoVenda}
                onChange={(patch) => setForm((p) => ({ ...p, ...patch }))}
                onSetTipo={setTipo}
                onSetProduzido={setProduzido}
                onSetCategoria={setCategoria}
                onSetSubcategoria={setSubcategoria}
              />
            );
          }

          if (blocoId === "materiais") {
            return (
              <div className="p-4 space-y-2">
                <div className="flex justify-end">
                  <button type="button" onClick={() => setForm((p) => ({
                    ...p,
                    materiais: [...(p.materiais || []), { material_id: "", material_nome: "", unidade: "un", quantidade: 1, custo_unitario: 0 }],
                  }))} className="text-sm font-medium flex items-center gap-1 hover:underline">
                    <Plus size={14} /> Material
                  </button>
                </div>
                {(form.materiais || []).map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_90px_90px_32px] gap-2 items-center">
                    <select
                      value={m.material_id || ""}
                      onChange={(e) => {
                        const c = componentes.find((x) => x.id === e.target.value);
                        updMat(i, {
                          material_id: e.target.value,
                          material_nome: c?.nome || "",
                          unidade: c?.unidade || "un",
                          custo_unitario: c?.custo_artigo ?? c?.custo_unitario ?? 0,
                        });
                      }}
                      className={fieldCls}
                    >
                      <option value="">Selecionar artigo…</option>
                      {componentes.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome}{c.codigo ? ` (${c.codigo})` : ""}</option>
                      ))}
                    </select>
                    <input type="number" step="0.01" value={m.quantidade} onChange={(e) => updMat(i, { quantidade: e.target.value })} className={`${fieldCls} text-right tabular-nums`} />
                    <div className="text-right text-sm tabular-nums text-gray-600">{eur((Number(m.quantidade) || 0) * (Number(m.custo_unitario) || 0))}</div>
                    <button type="button" onClick={() => setForm((p) => ({ ...p, materiais: p.materiais.filter((_, idx) => idx !== i) }))} className="p-1.5 text-red-600 hover:bg-red-50 rounded-sm">
                      <X size={15} />
                    </button>
                  </div>
                ))}
                {(form.materiais || []).length === 0 && <p className="text-sm text-gray-400">Sem materiais.</p>}
              </div>
            );
          }

          if (blocoId === "operacoes") {
            return (
              <div className="p-4 space-y-3">
                <div className="flex justify-end">
                  <button type="button" onClick={() => setForm((p) => ({
                    ...p,
                    roteiro: [...(p.roteiro || []), {
                      nome: "", maquina_id: "", maquina_nome: "", tempo_maquina: 0, tempo_maquina_unidade: "min",
                      mao_obra_id: "", mao_obra_nome: "", tempo_mao_obra: 0, tempo_mao_obra_unidade: "min",
                    }],
                  }))} className="text-sm font-medium flex items-center gap-1 hover:underline">
                    <Plus size={14} /> Operação
                  </button>
                </div>
                {(form.roteiro || []).map((op, i) => (
                  <div key={i} className="border border-gray-200 rounded-sm p-3 space-y-2">
                    <div className="flex gap-2">
                      <input placeholder="Nome da operação" value={op.nome} onChange={(e) => updOp(i, { nome: e.target.value })} className={`${fieldCls} flex-1`} />
                      <button type="button" onClick={() => setForm((p) => ({ ...p, roteiro: p.roteiro.filter((_, idx) => idx !== i) }))} className="p-1.5 text-red-600"><X size={15} /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="grid grid-cols-[1fr_64px_56px] gap-1.5">
                        <select value={op.maquina_id || ""} onChange={(e) => {
                          const mq = maquinas.find((x) => x.id === e.target.value);
                          updOp(i, { maquina_id: e.target.value, maquina_nome: mq?.nome || "" });
                        }} className={fieldCls}>
                          <option value="">Máquina…</option>
                          {maquinas.map((mq) => <option key={mq.id} value={mq.id}>{mq.nome}</option>)}
                        </select>
                        <input type="number" value={op.tempo_maquina} onChange={(e) => updOp(i, { tempo_maquina: e.target.value })} className={`${fieldCls} text-right`} />
                        <select value={op.tempo_maquina_unidade || "min"} onChange={(e) => updOp(i, { tempo_maquina_unidade: e.target.value })} className={fieldCls}>
                          <option value="min">min</option>
                          <option value="h">h</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-[1fr_64px_56px] gap-1.5">
                        <select value={op.mao_obra_id || ""} onChange={(e) => {
                          const mo = maoObra.find((x) => x.id === e.target.value);
                          updOp(i, { mao_obra_id: e.target.value, mao_obra_nome: mo?.nome || "" });
                        }} className={fieldCls}>
                          <option value="">Mão de obra…</option>
                          {maoObra.map((mo) => <option key={mo.id} value={mo.id}>{mo.nome}</option>)}
                        </select>
                        <input type="number" value={op.tempo_mao_obra} onChange={(e) => updOp(i, { tempo_mao_obra: e.target.value })} className={`${fieldCls} text-right`} />
                        <select value={op.tempo_mao_obra_unidade || "min"} onChange={(e) => updOp(i, { tempo_mao_obra_unidade: e.target.value })} className={fieldCls}>
                          <option value="min">min</option>
                          <option value="h">h</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                {(form.roteiro || []).length === 0 && <p className="text-sm text-gray-400">Sem operações.</p>}
              </div>
            );
          }

          if (blocoId === "custo") {
            return (
              <section className="bg-gray-900 text-white p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gray-300 mb-4">
                  <Calculator size={14} /> Custo total calculado
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
                  <div><div className="text-gray-400 text-xs">Valor de compra</div><div className="tabular-nums font-medium">{eur(Number(form.custo_artigo) || 0)}</div></div>
                  {produzido && (
                    <>
                      <div><div className="text-gray-400 text-xs">Materiais</div><div className="tabular-nums font-medium">{eur(custoMateriais)}</div></div>
                      <div><div className="text-gray-400 text-xs">Máquinas</div><div className="tabular-nums font-medium">{eur(custoMaquinas)}</div></div>
                      <div><div className="text-gray-400 text-xs">Mão de obra</div><div className="tabular-nums font-medium">{eur(custoMaoObra)}</div></div>
                    </>
                  )}
                </div>
                <div className="flex items-end justify-between border-t border-gray-700 pt-4">
                  <span className="text-sm text-gray-300">Custo por unidade</span>
                  <span className="tabular-nums font-bold text-2xl font-display">{eur(custoTotal)}</span>
                </div>
                {show("margem") && tipo !== "consumivel" && (
                  <div className="flex items-center justify-between border-t border-gray-700 pt-4 mt-4">
                    <label className="text-sm text-gray-300 flex items-center gap-2"><Tag size={14} /> Margem de lucro (%)</label>
                    <input type="number" value={form.margem} onChange={(e) => setForm((f) => ({ ...f, margem: e.target.value }))} className="w-24 text-right border border-gray-600 bg-gray-800 text-white rounded-sm px-2 py-1 text-sm tabular-nums" />
                  </div>
                )}
                {(show("margem") || show("custo_artigo")) && tipo !== "consumivel" && (
                  <div className="flex items-end justify-between pt-3">
                    <span className="text-sm font-semibold text-emerald-300">Preço de venda</span>
                    <span className="tabular-nums font-bold text-3xl font-display text-emerald-300">{eur(precoVenda)}</span>
                  </div>
                )}
              </section>
            );
          }

          return null;
        }}
      />
    </div>
  );
}
