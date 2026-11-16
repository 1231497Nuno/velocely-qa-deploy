import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, ListRestart, PlugZap, Receipt, Save } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { API } from "@/infrastructure/api/client";
import { METODOS_PAGAMENTO } from "@/features/pagamentos/PagamentoDialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50";
const labelCls = "text-sm font-medium text-gray-700 mb-1.5 block";

const INFO = {
  fiz: {
    resumo: "Chave de API (FIZ → Definições → API). Sem ambiente de testes: tudo o que é emitido é real e vai para a AT.",
    ajuda: [
      "Na FIZ, vá a Definições → API e crie uma chave (começa por fiz_api_).",
      "Cole a chave aqui, indique o CAE da empresa e guarde.",
      "Carregue em «Testar ligação» e depois em «Carregar séries» para escolher as séries.",
    ],
  },
  toconline: {
    resumo: "Ligação OAuth: dados em TOConline → Empresa → Configurações → Dados API.",
    ajuda: [
      "No TOConline: Empresa → Configurações → Dados API. Copie o Client ID, o Client Secret, o URL OAuth e o URL da API.",
      "Ainda lá, registe como endereço de retorno (redirect URI) o endereço mostrado abaixo.",
      "Guarde aqui e carregue em «Autorizar no TOConline» — entra com a sua conta e volta automaticamente.",
      "Depois de autorizado, «Carregar séries» e escolha as séries de fatura e fatura-recibo.",
    ],
  },
  moloni: {
    resumo: "API Moloni com credenciais de programador (moloni.pt/dev) e o utilizador da conta.",
    ajuda: [
      "Peça as credenciais de programador em moloni.pt/dev (Client ID e Client Secret).",
      "Indique o utilizador e a palavra-passe da conta Moloni e guarde. «Testar ligação» mostra as empresas — escolha a sua.",
      "Crie no Moloni um artigo genérico (ex.: referência GEN, «Personalização») — cada linha da fatura usa-o com o nome e preço da linha.",
      "«Carregar séries» para escolher as séries, o IVA e os métodos de pagamento.",
    ],
  },
};

const SAFT = [
  { id: "NU", nome: "NU — Numerário" }, { id: "TB", nome: "TB — Transferência bancária" }, { id: "MB", nome: "MB — Multibanco / MB WAY" },
  { id: "CC", nome: "CC — Cartão de crédito" }, { id: "CD", nome: "CD — Cartão de débito" }, { id: "CH", nome: "CH — Cheque" },
  { id: "OU", nome: "OU — Outros" },
];
const SAFT_DEFAULT = { numerario: "NU", transferencia: "TB", multibanco: "MB", mbway: "MB", cartao: "CC", cheque: "CH", outro: "OU" };

function apiPublica() {
  return API.startsWith("http") ? API : `${window.location.origin}${API}`;
}

function erro(e, msg) {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : (d?.mensagem || msg));
}

function SelectOuTexto({ opcoes, value, onChange, disabled, placeholder, testid }) {
  if (opcoes?.length) {
    return (
      <select className={inputCls} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        <option value="">{placeholder || "— por defeito do programa —"}</option>
        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
      </select>
    );
  }
  return <input className={inputCls} value={value || ""} disabled={disabled} placeholder={placeholder || "ID (ou carregue as séries)"} onChange={(e) => onChange(e.target.value)} data-testid={testid} />;
}

/** Definições → Integrações → Faturação certificada (FIZ, TOConline, Moloni). */
export default function FaturacaoIntegracao({ cfg, isAdmin, onAtualizar }) {
  const [form, setForm] = useState(null);
  const [dados, setDados] = useState(null);
  const [teste, setTeste] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!cfg) return;
    setForm({
      ativo: !!cfg.ativo,
      fornecedor: cfg.fornecedor || "",
      cae: cfg.cae || "",
      motivo_isencao: cfg.motivo_isencao || "M10",
      toconline_motivo_isencao_id: cfg.toconline_motivo_isencao_id || "",
      series: cfg.series || {},
      metodos: cfg.metodos || {},
      fiz: { api_key: "" },
      toconline: { client_id: cfg.toconline?.client_id || "", client_secret: "", oauth_url: cfg.toconline?.oauth_url || "", api_url: cfg.toconline?.api_url || "" },
      moloni: {
        client_id: cfg.moloni?.client_id || "", client_secret: "", username: cfg.moloni?.username || "", password: "",
        company_id: cfg.moloni?.company_id || "", produto_referencia: cfg.moloni?.produto_referencia || "", tax_id: cfg.moloni?.tax_id || "",
      },
    });
  }, [cfg]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("toconline") === "ok") {
      toast.success("TOConline autorizado");
      window.history.replaceState(null, "", `${window.location.pathname}?tab=integracoes`);
    }
  }, []);

  const forn = form?.fornecedor || "";
  const seriesForn = useMemo(() => (form?.series || {})[forn] || {}, [form, forn]);
  const metodosForn = useMemo(() => (form?.metodos || {})[forn] || {}, [form, forn]);
  if (!cfg || !form) return null;

  const setSub = (k, campo, v) => setForm((f) => ({ ...f, [k]: { ...f[k], [campo]: v } }));
  const setSerie = (tipo, v) => setForm((f) => ({ ...f, series: { ...f.series, [forn]: { ...(f.series[forn] || {}), [tipo]: v } } }));
  const setMetodo = (m, v) => setForm((f) => ({ ...f, metodos: { ...f.metodos, [forn]: { ...(f.metodos[forn] || {}), [m]: v } } }));
  const mudarFornecedor = (id) => { setForm((f) => ({ ...f, fornecedor: id })); setDados(null); setTeste(null); };

  const corpo = () => {
    const b = {
      fornecedor: form.fornecedor, cae: form.cae, motivo_isencao: form.motivo_isencao,
      toconline_motivo_isencao_id: form.toconline_motivo_isencao_id,
    };
    if (forn) Object.assign(b, { [forn]: form[forn], series: seriesForn, metodos: metodosForn });
    return b;
  };

  const guardar = async (extra = {}) => {
    setBusy("guardar");
    try {
      const r = await api.put("/integracoes/faturacao", { ...corpo(), ...extra });
      toast.success(extra.ativo === true ? "Faturação certificada ativa" : extra.ativo === false ? "Faturação certificada desligada" : "Definições de faturação guardadas");
      onAtualizar?.(r);
      return true;
    } catch (e) {
      erro(e, "Não foi possível guardar");
      return false;
    } finally {
      setBusy("");
    }
  };
  const testar = async () => {
    if (!(await guardar())) return;
    setBusy("testar");
    try {
      const r = await api.post("/integracoes/faturacao/testar");
      setTeste(r);
      toast.success(`Ligação ao ${r.fornecedor} OK${r.empresa ? ` — ${r.empresa}` : ""}`);
    } catch (e) {
      erro(e, "Não foi possível ligar ao programa");
    } finally {
      setBusy("");
    }
  };
  const carregarDados = async () => {
    setBusy("dados");
    try {
      const r = await api.get("/integracoes/faturacao/dados");
      setDados(r);
      if (!r.series?.length) toast.message("O programa não devolveu séries — pode escrever os IDs à mão");
    } catch (e) {
      erro(e, "Não foi possível carregar as séries");
    } finally {
      setBusy("");
    }
  };
  const autorizarToc = async () => {
    if (!(await guardar())) return;
    setBusy("autorizar");
    try {
      const r = await api.post("/integracoes/faturacao/toconline/autorizar", {
        api_publica: apiPublica(),
        retorno: `${window.location.origin}${window.location.pathname}?tab=integracoes`,
      });
      window.location.assign(r.url);
    } catch (e) {
      erro(e, "Não foi possível iniciar a autorização");
      setBusy("");
    }
  };
  const ativar = async (v) => {
    if (v && !forn) { toast.error("Escolha primeiro o programa de faturação"); return; }
    if (await guardar({ ativo: v })) setForm((f) => ({ ...f, ativo: v }));
  };

  const empresas = dados?.empresas || teste?.empresas || [];
  const opSeries = dados?.series || [];
  const opMetodos = forn === "toconline" ? SAFT : (dados?.metodos || []);
  const redirectToc = `${apiPublica()}/integracoes/faturacao/toconline/callback`;
  const dis = !isAdmin;

  return (
    <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-5" data-testid="integracao-faturacao">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Receipt size={18} /> Faturação certificada (AT)</h3>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Com a ligação ativa, «Assinar» uma fatura ou fatura-recibo envia-a ao programa escolhido: o número, o ATCUD e o PDF oficiais vêm de lá e o documento fica bloqueado. Proformas continuam internas.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="w-4 h-4 accent-current" checked={!!form.ativo} disabled={dis || !!busy} onChange={(e) => ativar(e.target.checked)} data-testid="fat-ativo" />
          Ativa
        </label>
      </div>

      <div>
        <div className={labelCls}>Programa de faturação</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(cfg.fornecedores || []).map((f) => (
            <button
              key={f.id} type="button" disabled={dis} onClick={() => mudarFornecedor(f.id)} data-testid={`fat-forn-${f.id}`}
              className={`text-left rounded-sm border px-3 py-2.5 transition-colors ${forn === f.id ? "border-brand bg-brand-soft ring-1 ring-brand/30" : "border-gray-300 hover:border-gray-400"}`}
            >
              <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                {f.nome}
                {cfg.ativo && cfg.fornecedor === f.id && <CheckCircle2 size={14} className="text-emerald-600" />}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{INFO[f.id]?.resumo}</div>
            </button>
          ))}
        </div>
      </div>

      {forn && (
        <>
          {forn === "fiz" && (
            <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> A FIZ não tem modo de testes: cada documento assinado é real e comunicado à AT. Faça o primeiro teste com um valor baixo.
            </div>
          )}

          {/* Credenciais */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {forn === "fiz" && (
              <div className="md:col-span-2">
                <label className={labelCls}>Chave da API</label>
                <input type="password" className={inputCls} value={form.fiz.api_key} disabled={dis} autoComplete="new-password"
                  placeholder={cfg.fiz?.api_key_definido ? `${cfg.fiz.api_key_mask} (guardada)` : "fiz_api_..."}
                  onChange={(e) => setSub("fiz", "api_key", e.target.value)} data-testid="fat-fiz-key" />
              </div>
            )}
            {forn === "toconline" && (
              <>
                <div>
                  <label className={labelCls}>Client ID</label>
                  <input className={inputCls} value={form.toconline.client_id} disabled={dis} onChange={(e) => setSub("toconline", "client_id", e.target.value)} data-testid="fat-toc-id" />
                </div>
                <div>
                  <label className={labelCls}>Client Secret</label>
                  <input type="password" className={inputCls} value={form.toconline.client_secret} disabled={dis} autoComplete="new-password"
                    placeholder={cfg.toconline?.client_secret_definido ? "•••••• (guardado)" : ""} onChange={(e) => setSub("toconline", "client_secret", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>URL OAuth</label>
                  <input className={inputCls} value={form.toconline.oauth_url} disabled={dis} placeholder="https://app10.toconline.pt/oauth" onChange={(e) => setSub("toconline", "oauth_url", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>URL da API</label>
                  <input className={inputCls} value={form.toconline.api_url} disabled={dis} placeholder="https://api10.toconline.pt" onChange={(e) => setSub("toconline", "api_url", e.target.value)} />
                </div>
                <div className="md:col-span-2 flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[16rem]">
                    <div className={labelCls}>Endereço de retorno (registar no TOConline)</div>
                    <code className="block truncate rounded-sm border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800">{redirectToc}</code>
                  </div>
                  <button type="button" onClick={autorizarToc} disabled={dis || !!busy} className="btn btn-secundario" data-testid="fat-toc-autorizar">
                    <ExternalLink size={15} /> {cfg.toconline?.autorizado ? "Autorizar de novo" : "Autorizar no TOConline"}
                  </button>
                  <span className={`text-xs ${cfg.toconline?.autorizado ? "text-emerald-700" : "text-gray-500"}`}>
                    {cfg.toconline?.autorizado ? `Autorizado${cfg.toconline.autorizado_em ? ` em ${fmtDate(cfg.toconline.autorizado_em)}` : ""}` : "Ainda não autorizado"}
                  </span>
                </div>
              </>
            )}
            {forn === "moloni" && (
              <>
                <div>
                  <label className={labelCls}>Client ID (programador)</label>
                  <input className={inputCls} value={form.moloni.client_id} disabled={dis} onChange={(e) => setSub("moloni", "client_id", e.target.value)} data-testid="fat-mol-id" />
                </div>
                <div>
                  <label className={labelCls}>Client Secret</label>
                  <input type="password" className={inputCls} value={form.moloni.client_secret} disabled={dis} autoComplete="new-password"
                    placeholder={cfg.moloni?.client_secret_definido ? "•••••• (guardado)" : ""} onChange={(e) => setSub("moloni", "client_secret", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Utilizador Moloni</label>
                  <input className={inputCls} value={form.moloni.username} disabled={dis} autoComplete="off" onChange={(e) => setSub("moloni", "username", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Palavra-passe</label>
                  <input type="password" className={inputCls} value={form.moloni.password} disabled={dis} autoComplete="new-password"
                    placeholder={cfg.moloni?.password_definido ? "•••••• (guardada)" : ""} onChange={(e) => setSub("moloni", "password", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Empresa</label>
                  <SelectOuTexto opcoes={empresas} value={form.moloni.company_id} disabled={dis} placeholder="Escolha (teste a ligação)" onChange={(v) => setSub("moloni", "company_id", v)} testid="fat-mol-empresa" />
                </div>
                <div>
                  <label className={labelCls}>Artigo genérico (referência)</label>
                  <input className={inputCls} value={form.moloni.produto_referencia} disabled={dis} placeholder="GEN" onChange={(e) => setSub("moloni", "produto_referencia", e.target.value)} />
                  {teste && teste.produto === false && <p className="text-xs text-red-600 mt-1">Não existe no Moloni um artigo com esta referência.</p>}
                </div>
                <div>
                  <label className={labelCls}>IVA (quando a empresa não é isenta)</label>
                  <SelectOuTexto opcoes={dados?.impostos || []} value={form.moloni.tax_id} disabled={dis} placeholder="— isento —" onChange={(v) => setSub("moloni", "tax_id", v)} />
                </div>
              </>
            )}
          </div>

          {/* Fiscal */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-gray-100 pt-4">
            <div>
              <label className={labelCls}>CAE da empresa{forn === "fiz" ? " *" : ""}</label>
              {dados?.caes?.length ? (
                <SelectOuTexto opcoes={dados.caes.map((c) => ({ id: c.id, nome: `${c.id} ${c.nome}` }))} value={form.cae} disabled={dis} placeholder="Escolha" onChange={(v) => setForm({ ...form, cae: v })} />
              ) : (
                <input className={inputCls} value={form.cae} disabled={dis} placeholder="ex.: 73110" onChange={(e) => setForm({ ...form, cae: e.target.value })} data-testid="fat-cae" />
              )}
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Motivo de isenção de IVA</label>
              <select className={inputCls} value={form.motivo_isencao} disabled={dis} onChange={(e) => setForm({ ...form, motivo_isencao: e.target.value })} data-testid="fat-motivo">
                {(cfg.motivos_isencao || []).map((m) => <option key={m.codigo} value={m.codigo}>{m.label}</option>)}
              </select>
              <p className="text-xs text-gray-500 mt-1">Usado quando a empresa está marcada como isenta de IVA (Definições → Empresa).</p>
            </div>
            {forn === "toconline" && (
              <div>
                <label className={labelCls}>ID do motivo de isenção no TOConline</label>
                <input className={inputCls} value={form.toconline_motivo_isencao_id} disabled={dis} placeholder="opcional" onChange={(e) => setForm({ ...form, toconline_motivo_isencao_id: e.target.value })} />
              </div>
            )}
          </div>

          {/* Séries e métodos */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900">Séries{forn !== "fiz" ? " e métodos de pagamento" : ""}</div>
              <button type="button" onClick={carregarDados} disabled={dis || !!busy} className="btn btn-secundario btn-sm" data-testid="fat-carregar">
                <ListRestart size={13} /> {busy === "dados" ? "A carregar…" : "Carregar séries"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[["fatura", "Fatura"], ["fatura_recibo", "Fatura-recibo"], ["recibo", "Recibo"]].map(([t, l]) => (
                <div key={t}>
                  <label className={labelCls}>{l}</label>
                  <SelectOuTexto opcoes={opSeries} value={seriesForn[t]} disabled={dis} onChange={(v) => setSerie(t, v)} testid={`fat-serie-${t}`}
                    placeholder={forn === "moloni" ? "Escolha a série" : "— série por defeito —"} />
                </div>
              ))}
            </div>
            {forn !== "fiz" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {METODOS_PAGAMENTO.map((m) => (
                  <div key={m.id}>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{m.label}</label>
                    <SelectOuTexto opcoes={opMetodos} value={metodosForn[m.id]} disabled={dis} onChange={(v) => setMetodo(m.id, v)}
                      placeholder={forn === "toconline" ? `— ${SAFT_DEFAULT[m.id]} —` : "— por defeito —"} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
            <button type="button" onClick={() => guardar()} disabled={dis || !!busy} className="btn btn-primario" data-testid="fat-guardar"><Save size={15} /> Guardar</button>
            <button type="button" onClick={testar} disabled={dis || !!busy} className="btn btn-secundario" data-testid="fat-testar"><PlugZap size={15} /> {busy === "testar" ? "A testar…" : "Testar ligação"}</button>
            <div className="text-xs text-gray-500 ml-1">
              {cfg.ultimo_teste && !cfg.ultimo_erro && <span className="text-emerald-700">Último teste OK · {fmtDate(cfg.ultimo_teste)}</span>}
              {cfg.ultimo_erro && <span className="text-red-600">Último erro: {cfg.ultimo_erro}</span>}
            </div>
          </div>

          <details className="text-sm text-gray-700 border-t border-gray-100 pt-3">
            <summary className="cursor-pointer font-medium">Como ligar o {(cfg.fornecedores || []).find((f) => f.id === forn)?.nome}</summary>
            <ol className="list-decimal ml-5 mt-2 space-y-1.5">
              {INFO[forn].ajuda.map((t) => <li key={t}>{t}</li>)}
              <li>Marque <b>Ativa</b>. A partir daí, «Assinar» nas faturas e no ecrã Pagamentos emite no programa.</li>
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
