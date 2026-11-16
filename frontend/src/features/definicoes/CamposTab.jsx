import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CornerDownRight, GitBranch, Plus, Save, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCampos } from "@/context/CamposContext";
import { useConfirm } from "@/hooks/useConfirm";
import { CORES_LINHA } from "@/components/CorLinhaPicker";
import { slugCampo } from "@/lib/camposDependentes";

const TIPOS = [
  { key: "texto", label: "Texto" },
  { key: "texto_longo", label: "Texto longo" },
  { key: "numero", label: "Número" },
  { key: "data", label: "Data" },
  { key: "lista", label: "Lista de opções" },
  { key: "sim_nao", label: "Sim / Não" },
];

const inputCls = "border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50";
const sectionCls = "bg-white border border-gray-200 rounded-sm p-5 space-y-3";
const h2Cls = "text-sm font-semibold uppercase tracking-[0.08em] text-gray-700";

function Paleta({ value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CORES_LINHA.map((c) => (
        <button
          key={c.cor}
          type="button"
          disabled={disabled}
          title={c.nome}
          onClick={() => onChange(value === c.cor ? "" : c.cor)}
          className={`w-5 h-5 rounded-full ${value === c.cor ? "ring-2 ring-offset-1 ring-gray-900" : "ring-1 ring-black/10"}`}
          style={{ background: c.cor }}
        />
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("")}
        title="Sem cor"
        className={`w-5 h-5 rounded-full border border-gray-300 bg-white flex items-center justify-center ${!value ? "ring-2 ring-offset-1 ring-gray-900" : ""}`}
      >
        <X size={10} className="text-gray-400" />
      </button>
    </div>
  );
}

function Chips({ opcoes, valor, onChange, disabled, vazio }) {
  const sel = valor || [];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {opcoes.map((o) => {
        const on = sel.includes(o);
        return (
          <button
            key={o} type="button" disabled={disabled}
            onClick={() => onChange(on ? sel.filter((x) => x !== o) : [...sel, o])}
            className={`rounded-sm border px-2 py-0.5 text-xs ${on ? "border-brand bg-brand-soft text-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
          >
            {o}
          </button>
        );
      })}
      {!sel.length && vazio && <span className="text-xs text-gray-400 ml-1">{vazio}</span>}
    </div>
  );
}

/** Chaves dos campos que dependem (direta ou indiretamente) de `key` — não podem ser o "pai" dele. */
function descendentes(extras, key) {
  const out = new Set();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const c of extras) {
      const pai = c.depende_de?.campo;
      if (pai && (pai === key || out.has(pai)) && !out.has(c.key)) { out.add(c.key); mudou = true; }
    }
  }
  return out;
}

/** "Mostrar só quando…": escolher o campo de que este depende e a condição. */
function Dependencia({ campo, extras, onChange, disabled }) {
  const dep = campo.depende_de;
  const proibidos = descendentes(extras, campo.key);
  const candidatos = extras.filter((x) => x.key && x.key !== campo.key && !proibidos.has(x.key) && x.label.trim());
  const pai = dep?.campo ? extras.find((x) => x.key === dep.campo) : null;
  const opcoesPai = pai?.tipo === "lista" ? pai.opcoes.map((o) => o.valor) : [];

  if (!dep) {
    if (disabled || !candidatos.length) return null;
    return (
      <button type="button" onClick={() => onChange({ depende_de: { campo: candidatos[0].key, valores: [] } })} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900" data-testid={`campos-dep-add-${campo.key}`}>
        <GitBranch size={13} /> Mostrar só consoante outro campo
      </button>
    );
  }
  return (
    <div className="rounded-sm border border-dashed border-gray-300 bg-gray-50/60 px-3 py-2 space-y-1.5" data-testid={`campos-dep-${campo.key}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <GitBranch size={14} className="text-gray-500" />
        <span className="text-gray-600">Mostrar só quando</span>
        <select className={`${inputCls} !py-1`} value={dep.campo} disabled={disabled}
          onChange={(e) => onChange({ depende_de: { campo: e.target.value, valores: [] }, opcoes: campo.opcoes.map((o) => ({ ...o, pais: [] })) })}>
          {!pai && <option value={dep.campo}>(campo removido)</option>}
          {candidatos.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        {pai?.tipo === "sim_nao" ? (
          <select className={`${inputCls} !py-1`} value={(dep.valores || [])[0] || "sim"} disabled={disabled} onChange={(e) => onChange({ depende_de: { ...dep, valores: [e.target.value] } })}>
            <option value="sim">estiver marcado (Sim)</option>
            <option value="nao">não estiver marcado (Não)</option>
          </select>
        ) : pai?.tipo === "lista" ? (
          <span className="text-gray-600">for</span>
        ) : (
          <span className="text-gray-600">estiver preenchido</span>
        )}
        {!disabled && (
          <button type="button" onClick={() => onChange({ depende_de: null, opcoes: campo.opcoes.map((o) => ({ ...o, pais: [] })) })} className="ml-auto text-gray-400 hover:text-red-600" title="Mostrar sempre"><X size={14} /></button>
        )}
      </div>
      {pai?.tipo === "lista" && (
        <div className="pl-6">
          <Chips opcoes={opcoesPai} valor={(dep.valores || []).filter((v) => opcoesPai.includes(v))} disabled={disabled}
            onChange={(valores) => onChange({ depende_de: { ...dep, valores } })} vazio="qualquer opção" />
        </div>
      )}
    </div>
  );
}

function novoCampo() {
  return { key: "", label: "", tipo: "texto", opcoes: [], obrigatorio: false, ajuda: "", mostrar_na_lista: false, ativo: true, depende_de: null, _novo: true };
}

/** Definições → Campos: obrigatórios, campos personalizados e cores das linhas, por módulo. */
export default function CamposTab() {
  const { isAdmin } = useAuth();
  const { catalogo, recarregar } = useCampos();
  const confirm = useConfirm();
  const modulos = Object.keys(catalogo);
  const [modulo, setModulo] = useState("");
  const [form, setForm] = useState(null);
  const [novaOpcao, setNovaOpcao] = useState({});
  const [busy, setBusy] = useState(false);

  const meta = catalogo[modulo];
  const original = useMemo(() => (meta ? JSON.stringify(meta.config) : ""), [meta]);
  const sujo = !!form && JSON.stringify({ ...form, extras: form.extras.map(({ _novo, ...c }) => c) }) !== original;

  useEffect(() => {
    if (!modulo && modulos.length) setModulo(modulos.includes("encomendas") ? "encomendas" : modulos[0]);
  }, [modulos, modulo]);

  useEffect(() => {
    if (meta) {
      setForm(JSON.parse(JSON.stringify(meta.config)));
      setNovaOpcao({});
    }
  }, [meta]);

  async function trocarModulo(m) {
    if (m === modulo) return;
    if (sujo && !(await confirm({ title: "Sair sem guardar?", description: "As alterações a este módulo perdem-se.", confirmLabel: "Sair sem guardar", tone: "danger" }))) return;
    setModulo(m);
  }

  if (!meta || !form) return <p className="text-sm text-gray-500">A carregar...</p>;

  const disabled = !isAdmin;
  const setExtra = (i, patch) => setForm((f) => ({ ...f, extras: f.extras.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  // Campos novos ganham já a chave (a partir do nome) para poderem ser usados como "pai" de outros
  const mudarNome = (i, label) => setForm((f) => {
    const c = f.extras[i];
    if (!c._novo) return { ...f, extras: f.extras.map((x, j) => (j === i ? { ...x, label } : x)) };
    const usadas = new Set(f.extras.filter((_, j) => j !== i).map((x) => x.key).filter(Boolean));
    const base = slugCampo(label);
    let key = base;
    for (let n = 2; usadas.has(key); n += 1) key = `${base}_${n}`;
    const antiga = c.key;
    return {
      ...f,
      extras: f.extras.map((x, j) => {
        if (j === i) return { ...x, label, key: label.trim() ? key : "" };
        if (antiga && x.depende_de?.campo === antiga) return { ...x, depende_de: { ...x.depende_de, campo: key } };
        return x;
      }),
      cores_linhas: antiga && f.cores_linhas.campo === `extra:${antiga}` ? { ...f.cores_linhas, campo: `extra:${key}` } : f.cores_linhas,
    };
  });
  const moverExtra = (i, d) => setForm((f) => {
    const ex = [...f.extras];
    const j = i + d;
    if (j < 0 || j >= ex.length) return f;
    [ex[i], ex[j]] = [ex[j], ex[i]];
    return { ...f, extras: ex };
  });
  const listas = form.extras.filter((c) => c.tipo === "lista" && c.key);

  function toggleObrigatorio(key) {
    setForm((f) => ({
      ...f,
      obrigatorios: f.obrigatorios.includes(key) ? f.obrigatorios.filter((k) => k !== key) : [...f.obrigatorios, key],
    }));
  }

  function addOpcao(i) {
    const valor = (novaOpcao[i] || "").trim();
    if (!valor) return;
    const c = form.extras[i];
    if (c.opcoes.some((o) => o.valor.toLowerCase() === valor.toLowerCase())) {
      toast.error("Essa opção já existe");
      return;
    }
    setExtra(i, { opcoes: [...c.opcoes, { valor, cor: "", pais: [] }] });
    setNovaOpcao((n) => ({ ...n, [i]: "" }));
  }

  async function removerExtra(i) {
    const c = form.extras[i];
    if (!c._novo) {
      const ok = await confirm({
        title: `Remover «${c.label}»?`,
        description: "O campo deixa de aparecer. Os valores já guardados nos registos mantêm-se na base de dados. Se só o quiser esconder, desmarque «Ativo».",
        confirmLabel: "Remover",
        tone: "danger",
      });
      if (!ok) return;
    }
    setForm((f) => {
      const extras = f.extras.filter((_, j) => j !== i).map((x) => (
        c.key && x.depende_de?.campo === c.key ? { ...x, depende_de: null, opcoes: x.opcoes.map((o) => ({ ...o, pais: [] })) } : x
      ));
      const cl = f.cores_linhas.campo === `extra:${c.key}` ? { campo: "", mapa: {} } : f.cores_linhas;
      return { ...f, extras, cores_linhas: cl };
    });
  }

  async function guardar() {
    if (form.extras.some((c) => !c.label.trim())) {
      toast.error("Dê um nome a todos os campos personalizados");
      return;
    }
    setBusy(true);
    try {
      const body = { ...form, extras: form.extras.map(({ _novo, ...c }) => c) };
      await api.put(`/settings/campos/${modulo}`, body);
      await recarregar();
      toast.success(`Campos de ${meta.label} guardados`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(Array.isArray(d) ? d.map((x) => (x.msg || "").replace("Value error, ", "")).join("; ") : d || "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  }

  const quando = {
    sempre: "Validado ao criar e ao guardar.",
    guardar: "Validado ao guardar (o rascunho pode ser criado vazio).",
    finalizar: "Validado ao finalizar (atribuir número).",
  }[meta.validar];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)] gap-5" data-testid="campos-tab">
      <nav className="bg-white border border-gray-200 rounded-sm p-2 h-fit lg:sticky lg:top-20">
        {modulos.map((m) => {
          const n = (catalogo[m].config?.extras || []).length + (catalogo[m].config?.obrigatorios || []).length;
          return (
            <button
              key={m}
              type="button"
              onClick={() => trocarModulo(m)}
              data-testid={`campos-modulo-${m}`}
              className={`w-full text-left px-3 py-2 rounded-sm text-sm flex items-center justify-between ${m === modulo ? "bg-brand text-brand-fg" : "text-gray-700 hover:bg-gray-100"}`}
            >
              <span className="truncate">{catalogo[m].label}</span>
              {n > 0 && <span className={`text-[11px] tabular-nums ${m === modulo ? "opacity-80" : "text-gray-400"}`}>{n}</span>}
            </button>
          );
        })}
      </nav>

      <div className="space-y-5 min-w-0">
        <section className={sectionCls}>
          <div>
            <h2 className={h2Cls}>Campos obrigatórios — {meta.label}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Marque os campos que têm de estar preenchidos. {quando}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {meta.campos.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-gray-800 border border-gray-200 rounded-sm px-3 py-2 hover:bg-gray-50">
                <input type="checkbox" disabled={disabled} checked={form.obrigatorios.includes(c.key)} onChange={() => toggleObrigatorio(c.key)} data-testid={`campos-obrig-${c.key}`} />
                {c.label}
              </label>
            ))}
          </div>
          {modulo === "clientes" && <p className="text-xs text-gray-500">Nas empresas o ERP já exige sempre NIF, morada, código postal, cidade, telefone e email.</p>}
        </section>

        <section className={sectionCls}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className={h2Cls}>Campos personalizados</h2>
              <p className="text-xs text-gray-500 mt-0.5">Campos novos que aparecem na ficha de {meta.label.toLowerCase()}, no bloco «Outros dados». Um campo pode aparecer só consoante a resposta a outro (ex.: Categoria → Subcategoria, ou «Tem logótipo?» → «Ficheiro do logótipo»).</p>
            </div>
            {!disabled && (
              <button type="button" onClick={() => setForm((f) => ({ ...f, extras: [...f.extras, novoCampo()] }))} className="btn btn-secundario shrink-0" data-testid="campos-add-extra">
                <Plus size={14} /> Novo campo
              </button>
            )}
          </div>
          {form.extras.length === 0 && <p className="text-sm text-gray-400 py-2">Sem campos personalizados.</p>}
          <ul className="space-y-2">
            {form.extras.map((c, i) => (
              <li key={c._novo ? `novo-${i}` : c.key} className={`border rounded-sm p-3 space-y-2 ${c.ativo === false ? "border-dashed border-gray-300 bg-gray-50" : "border-gray-200"} ${c.depende_de?.campo ? "ml-6 border-l-4 border-l-brand/40" : ""}`} data-testid={`campos-extra-row-${i}`}>
                {c.depende_de?.campo && (
                  <div className="flex items-center gap-1 text-[11px] text-gray-500 -mb-1">
                    <CornerDownRight size={12} /> depende de «{form.extras.find((x) => x.key === c.depende_de.campo)?.label || "?"}»
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col">
                    <button type="button" disabled={disabled || i === 0} onClick={() => moverExtra(i, -1)} className="p-0.5 text-gray-500 hover:text-gray-900 disabled:opacity-30"><ArrowUp size={13} /></button>
                    <button type="button" disabled={disabled || i === form.extras.length - 1} onClick={() => moverExtra(i, 1)} className="p-0.5 text-gray-500 hover:text-gray-900 disabled:opacity-30"><ArrowDown size={13} /></button>
                  </div>
                  <input className={`${inputCls} flex-1 min-w-[12rem]`} placeholder="Nome do campo (ex.: Setor de atividade)" value={c.label} disabled={disabled} onChange={(e) => mudarNome(i, e.target.value)} data-testid={`campos-extra-label-${i}`} />
                  <select className={inputCls} value={c.tipo} disabled={disabled || !c._novo} onChange={(e) => setExtra(i, { tipo: e.target.value })} title={c._novo ? "" : "O tipo não muda depois de guardado"}>
                    {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  {!disabled && (
                    <button type="button" onClick={() => removerExtra(i)} className="p-1.5 text-gray-400 hover:text-red-600" title="Remover campo"><Trash2 size={15} /></button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-sm text-gray-700">
                  {c.tipo !== "sim_nao" && (
                    <label className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={!!c.obrigatorio} onChange={(e) => setExtra(i, { obrigatorio: e.target.checked })} /> Obrigatório</label>
                  )}
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={!!c.mostrar_na_lista} onChange={(e) => setExtra(i, { mostrar_na_lista: e.target.checked })} /> Mostrar na listagem</label>
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={c.ativo !== false} onChange={(e) => setExtra(i, { ativo: e.target.checked })} /> Ativo</label>
                  <input className={`${inputCls} flex-1 min-w-[12rem] !py-1 text-xs`} placeholder="Texto de ajuda (opcional)" value={c.ajuda || ""} disabled={disabled} onChange={(e) => setExtra(i, { ajuda: e.target.value })} />
                </div>
                <div className="pl-7">
                  <Dependencia campo={c} extras={form.extras} disabled={disabled} onChange={(patch) => setExtra(i, patch)} />
                </div>
                {c.tipo === "lista" && (
                  <div className="pl-7 space-y-1.5">
                    <div className="text-xs text-gray-500">Opções {listas.some((l) => l.key === c.key) && form.cores_linhas.campo === `extra:${c.key}` ? "— as cores pintam as linhas da listagem" : "— pode dar uma cor a cada opção"}</div>
                    {(() => {
                      const pai = c.depende_de?.campo ? form.extras.find((x) => x.key === c.depende_de.campo) : null;
                      return pai?.tipo === "lista" ? (
                        <p className="text-xs text-gray-500">Escolha em que opções de «{pai.label}» aparece cada opção (sem escolha = aparece sempre).</p>
                      ) : null;
                    })()}
                    {c.opcoes.map((o, oi) => (
                      <div key={oi} className="flex flex-wrap items-center gap-2">
                        <span className="text-sm min-w-[8rem]">{o.valor}</span>
                        <Paleta value={o.cor} disabled={disabled} onChange={(cor) => setExtra(i, { opcoes: c.opcoes.map((x, xi) => (xi === oi ? { ...x, cor } : x)) })} />
                        {(() => {
                          const pai = c.depende_de?.campo ? form.extras.find((x) => x.key === c.depende_de.campo) : null;
                          if (pai?.tipo !== "lista") return null;
                          const op = pai.opcoes.map((x) => x.valor);
                          return (
                            <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                              <CornerDownRight size={12} />
                              <Chips opcoes={op} valor={(o.pais || []).filter((p) => op.includes(p))} disabled={disabled} vazio="todas"
                                onChange={(pais) => setExtra(i, { opcoes: c.opcoes.map((x, xi) => (xi === oi ? { ...x, pais } : x)) })} />
                            </span>
                          );
                        })()}
                        {!disabled && (
                          <button type="button" onClick={() => setExtra(i, { opcoes: c.opcoes.filter((_, xi) => xi !== oi) })} className="text-gray-400 hover:text-red-600"><X size={14} /></button>
                        )}
                      </div>
                    ))}
                    {!disabled && (
                      <div className="flex gap-2">
                        <input className={`${inputCls} !py-1 text-sm`} placeholder="Nova opção" value={novaOpcao[i] || ""} onChange={(e) => setNovaOpcao((n) => ({ ...n, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOpcao(i); } }} />
                        <button type="button" onClick={() => addOpcao(i)} className="border border-gray-300 rounded-sm px-2 text-sm hover:bg-gray-50">Adicionar</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className={sectionCls}>
          <div>
            <h2 className={h2Cls}>Cores das linhas na listagem</h2>
            <p className="text-xs text-gray-500 mt-0.5">Pinta cada linha da listagem de {meta.label.toLowerCase()} conforme o estado ou um campo do tipo lista.</p>
          </div>
          <select
            className={inputCls}
            disabled={disabled}
            value={form.cores_linhas.campo}
            onChange={(e) => setForm((f) => ({ ...f, cores_linhas: { campo: e.target.value, mapa: e.target.value === "estado" ? f.cores_linhas.mapa || {} : {} } }))}
            data-testid="campos-cores-origem"
          >
            <option value="">Sem cores</option>
            {meta.estado && <option value="estado">Pelo estado</option>}
            {listas.map((l) => <option key={l.key} value={`extra:${l.key}`}>Pelo campo «{l.label}»</option>)}
          </select>
          {form.cores_linhas.campo === "estado" && meta.estado && (
            <div className="space-y-1.5">
              {meta.estado.valores.map((v) => (
                <div key={v.valor} className="flex flex-wrap items-center gap-3">
                  <span className="text-sm min-w-[9rem]">{v.label}</span>
                  <Paleta
                    value={form.cores_linhas.mapa?.[v.valor] || ""}
                    disabled={disabled}
                    onChange={(cor) => setForm((f) => {
                      const mapa = { ...(f.cores_linhas.mapa || {}) };
                      if (cor) mapa[v.valor] = cor; else delete mapa[v.valor];
                      return { ...f, cores_linhas: { ...f.cores_linhas, mapa } };
                    })}
                  />
                </div>
              ))}
            </div>
          )}
          {form.cores_linhas.campo.startsWith("extra:") && (
            <p className="text-xs text-gray-500">As cores vêm das opções do campo, definidas acima.</p>
          )}
          {!listas.length && !meta.estado && (
            <p className="text-xs text-gray-500">Crie um campo personalizado do tipo «Lista de opções» para poder colorir as linhas.</p>
          )}
        </section>

        {isAdmin ? (
          <div className="flex justify-end sticky bottom-3">
            <button type="button" onClick={guardar} disabled={busy || !sujo} className="btn btn-primario" data-testid="campos-guardar">
              <Save size={15} /> {busy ? "A guardar..." : `Guardar ${meta.label}`}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Só os administradores podem alterar os campos.</p>
        )}
      </div>
    </div>
  );
}
