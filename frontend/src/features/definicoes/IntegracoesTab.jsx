import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, Globe, KeyRound, PlugZap, RefreshCw, Save, ShoppingBag } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { API } from "@/infrastructure/api/client";
import { useAuth } from "@/context/AuthContext";

const ESTADOS_WOO = [
  { id: "processing", label: "Em processamento (pagas)" },
  { id: "completed", label: "Concluídas" },
  { id: "on-hold", label: "Em espera (ex.: à espera de transferência / Multibanco)" },
  { id: "pending", label: "Pagamento pendente" },
];

const inputCls = "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50";

function apiPublica() {
  return API.startsWith("http") ? API : `${window.location.origin}${API}`;
}

function CopiarCampo({ label, valor, testid }) {
  const [ok, setOk] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 min-w-0 truncate rounded-sm border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800" data-testid={testid}>{valor || "—"}</code>
        <button type="button" onClick={copiar} disabled={!valor} className="btn btn-secundario btn-sm shrink-0" title="Copiar">
          {ok ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function erro(e, msg) {
  const d = e?.response?.data?.detail;
  toast.error(typeof d === "string" ? d : msg);
}

/** Definições → Integrações: loja online (WooCommerce) e formulários do site. */
export default function IntegracoesTab() {
  const { isAdmin } = useAuth();
  const [woo, setWoo] = useState(null);
  const [site, setSite] = useState(null);
  const [form, setForm] = useState({});
  const [segredo, setSegredo] = useState("");
  const [desde, setDesde] = useState(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [busy, setBusy] = useState("");

  const carregar = async () => {
    const r = await api.get("/integracoes");
    setWoo(r.woocommerce);
    setSite(r.site);
    setForm({
      ativo: r.woocommerce.ativo,
      url: r.woocommerce.url || "",
      consumer_key: "",
      consumer_secret: "",
      estados_importar: r.woocommerce.estados_importar || [],
      criar_clientes: r.woocommerce.criar_clientes !== false,
    });
  };
  useEffect(() => { carregar().catch(() => toast.error("Não foi possível carregar as integrações")); }, []);

  if (!woo || !site) return <div className="text-sm text-gray-500">A carregar...</div>;

  const guardarWoo = async () => {
    setBusy("woo");
    try {
      const body = { ...form };
      if (!body.consumer_key) delete body.consumer_key;
      if (!body.consumer_secret) delete body.consumer_secret;
      await api.put("/integracoes/woocommerce", body);
      toast.success("Ligação à loja guardada");
      await carregar();
    } catch (e) {
      erro(e, "Não foi possível guardar");
    } finally {
      setBusy("");
    }
  };
  const testar = async () => {
    setBusy("testar");
    try {
      const r = await api.post("/integracoes/woocommerce/testar");
      toast.success(`Ligação OK${r.total_encomendas != null ? ` — ${r.total_encomendas} encomendas na loja` : ""}${r.ultima ? ` · última #${r.ultima.numero}` : ""}`);
    } catch (e) {
      erro(e, "Não foi possível ligar ao site");
    } finally {
      setBusy("");
    }
  };
  const sincronizar = async () => {
    setBusy("sync");
    const tid = toast.loading("A importar encomendas da loja…");
    try {
      const r = await api.post("/integracoes/woocommerce/sincronizar", { desde });
      toast.success(`${r.criadas} nova(s), ${r.atualizadas} atualizada(s), ${r.ignoradas} ignorada(s)`, { id: tid });
      if (r.erros?.length) toast.error(`${r.erros.length} com erro: ${r.erros.slice(0, 2).join(" · ")}`);
      await carregar();
    } catch (e) {
      toast.dismiss(tid);
      erro(e, "Não foi possível importar");
    } finally {
      setBusy("");
    }
  };
  const novoSegredo = async () => {
    const r = await api.post("/integracoes/woocommerce/segredo");
    setSegredo(r.webhook_secret);
    toast.success("Segredo novo gerado — copie-o já para o WooCommerce");
    await carregar();
  };
  const guardarSite = async (patch) => {
    setBusy("site");
    try {
      setSite(await api.put("/integracoes/site", patch));
      toast.success("Guardado");
    } catch (e) {
      erro(e, "Não foi possível guardar");
    } finally {
      setBusy("");
    }
  };
  const toggleEstado = (id) => setForm((f) => ({
    ...f,
    estados_importar: f.estados_importar.includes(id) ? f.estados_importar.filter((x) => x !== id) : [...f.estados_importar, id],
  }));
  const urlWebhook = `${apiPublica()}/integracoes/woocommerce/webhook`;
  const urlSite = `${apiPublica()}/integracoes/site/pedido`;

  return (
    <div className="space-y-6 max-w-4xl">
      {!isAdmin && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">Só administradores podem alterar as integrações.</p>
      )}

      {/* Loja online */}
      <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4" data-testid="integracao-woo">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><ShoppingBag size={18} /> Loja online (WooCommerce)</h3>
            <p className="text-sm text-gray-500 mt-0.5">As encomendas do site entram como encomendas, com o cliente, os artigos (pelo SKU) e o pagamento.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="w-4 h-4 accent-current" checked={!!form.ativo} disabled={!isAdmin} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} data-testid="woo-ativo" />
            Ativa
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Endereço do site</label>
            <input className={inputCls} value={form.url} disabled={!isAdmin} placeholder="https://famarte.pt" onChange={(e) => setForm({ ...form, url: e.target.value })} data-testid="woo-url" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Chave do cliente (ck_…)</label>
            <input className={inputCls} value={form.consumer_key} disabled={!isAdmin} placeholder={woo.consumer_key_mask || "ck_..."} onChange={(e) => setForm({ ...form, consumer_key: e.target.value })} autoComplete="off" data-testid="woo-ck" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Segredo do cliente (cs_…)</label>
            <input type="password" className={inputCls} value={form.consumer_secret} disabled={!isAdmin} placeholder={woo.consumer_secret_definido ? "•••••• (guardado)" : "cs_..."} onChange={(e) => setForm({ ...form, consumer_secret: e.target.value })} autoComplete="new-password" data-testid="woo-cs" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 pb-2">
              <input type="checkbox" className="w-4 h-4 accent-current" checked={!!form.criar_clientes} disabled={!isAdmin} onChange={(e) => setForm({ ...form, criar_clientes: e.target.checked })} />
              Criar clientes novos automaticamente
            </label>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-1.5">Importar encomendas nestes estados</div>
          <div className="flex flex-wrap gap-2">
            {ESTADOS_WOO.map((e) => (
              <label key={e.id} className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-sm cursor-pointer ${form.estados_importar.includes(e.id) ? "border-brand bg-brand-soft" : "border-gray-300 text-gray-600"}`}>
                <input type="checkbox" className="accent-current" checked={form.estados_importar.includes(e.id)} disabled={!isAdmin} onChange={() => toggleEstado(e.id)} />
                {e.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1.5">Encomendas em espera entram sem pagamento; quando ficam pagas na loja, o pagamento é registado aqui sozinho. Só entram em produção depois de pagas.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={guardarWoo} disabled={!isAdmin || !!busy} className="btn btn-primario" data-testid="woo-guardar"><Save size={15} /> Guardar</button>
          <button type="button" onClick={testar} disabled={!isAdmin || !!busy} className="btn btn-secundario" data-testid="woo-testar"><PlugZap size={15} /> {busy === "testar" ? "A testar…" : "Testar ligação"}</button>
        </div>

        <div className="border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <CopiarCampo label="URL de entrega do webhook" valor={urlWebhook} testid="woo-webhook-url" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1">Segredo do webhook</div>
            {segredo ? (
              <CopiarCampo label="" valor={segredo} testid="woo-webhook-segredo" />
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-sm border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-500">{woo.webhook_secret_mask || "ainda não gerado"}</code>
                <button type="button" onClick={novoSegredo} disabled={!isAdmin} className="btn btn-secundario btn-sm"><KeyRound size={13} /> Gerar novo</button>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Importar encomendas desde</label>
            <input type="date" className={inputCls} value={desde} onChange={(e) => setDesde(e.target.value)} data-testid="woo-desde" />
          </div>
          <button type="button" onClick={sincronizar} disabled={!isAdmin || !!busy || !woo.ativo} className="btn btn-secundario" data-testid="woo-sincronizar">
            {busy === "sync" ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />} Importar agora
          </button>
          <div className="text-xs text-gray-500">
            {woo.ultima_sincronizacao && <div>Última importação: {fmtDate(woo.ultima_sincronizacao)}</div>}
            {woo.ultimo_pedido && <div>Último pedido recebido: #{woo.ultimo_pedido.numero} → {woo.ultimo_pedido.encomenda}</div>}
            {woo.ultimo_erro && <div className="text-red-600">Erros: {woo.ultimo_erro}</div>}
          </div>
        </div>

        <details className="text-sm text-gray-700 border-t border-gray-100 pt-3">
          <summary className="cursor-pointer font-medium">Como ligar no WordPress (5 minutos)</summary>
          <ol className="list-decimal ml-5 mt-2 space-y-1.5">
            <li>WooCommerce → Definições → Avançado → <b>API REST</b> → Adicionar chave. Permissão: <b>Ler</b>. Copie a chave (ck_…) e o segredo (cs_…) para aqui e guarde.</li>
            <li>Carregue em <b>Testar ligação</b>.</li>
            <li>Marque <b>Ativa</b>, guarde e carregue em <b>Gerar novo</b> no segredo do webhook (copie-o).</li>
            <li>WooCommerce → Definições → Avançado → <b>Webhooks</b> → Adicionar: tópico <b>Encomenda criada</b>, URL de entrega acima, segredo copiado, estado Ativo. Repita para <b>Encomenda atualizada</b>.</li>
            <li>Para trazer as encomendas antigas, use <b>Importar agora</b> com a data desejada (as repetidas não duplicam).</li>
          </ol>
          <p className="text-xs text-gray-500 mt-2">Artigos: o SKU do produto na loja deve ser igual ao código do artigo aqui (ou ao código de produto/fabricante). Sem correspondência, a linha entra com o nome da loja e pode ser ligada depois.</p>
        </details>
      </section>

      {/* Formulários */}
      <section className="bg-white border border-gray-200 rounded-sm p-5 space-y-4" data-testid="integracao-site">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Globe size={18} /> Pedidos de orçamento / contacto do site</h3>
            <p className="text-sm text-gray-500 mt-0.5">Cada formulário enviado no site cria um lead no CRM (ou junta-se ao lead em aberto do mesmo contacto).</p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="w-4 h-4 accent-current" checked={!!site.ativo} disabled={!isAdmin || busy === "site"} onChange={(e) => guardarSite({ ativo: e.target.checked })} data-testid="site-ativo" />
            Ativo
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CopiarCampo label="URL do webhook" valor={site.token ? `${urlSite}?token=${site.token}` : ""} testid="site-url" />
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1 block">Origem no CRM</label>
            <div className="flex gap-1.5">
              <input className={inputCls} defaultValue={site.origem || "Site"} disabled={!isAdmin} onBlur={(e) => e.target.value !== site.origem && guardarSite({ origem: e.target.value })} />
              <button type="button" onClick={() => guardarSite({ novo_token: true })} disabled={!isAdmin || !site.ativo} className="btn btn-secundario btn-sm shrink-0" title="O link antigo deixa de funcionar"><KeyRound size={13} /> Novo token</button>
            </div>
          </div>
        </div>
        {site.ultimo_pedido && <p className="text-xs text-gray-500">Último pedido: {site.ultimo_pedido.nome} · {fmtDate(site.ultimo_pedido.at)}</p>}
        <details className="text-sm text-gray-700 border-t border-gray-100 pt-3">
          <summary className="cursor-pointer font-medium">Como ligar o formulário</summary>
          <ul className="list-disc ml-5 mt-2 space-y-1.5">
            <li><b>Elementor</b>: no formulário → Ações após envio → <b>Webhook</b> → cole o URL acima.</li>
            <li><b>Contact Form 7 / WPForms</b>: com um extra de webhook (ex.: «CF7 to Webhook»), envie para o URL acima.</li>
            <li>Os campos são reconhecidos pelo nome (nome, email, telefone, empresa, mensagem…); os restantes ficam na descrição do lead.</li>
          </ul>
        </details>
      </section>
    </div>
  );
}
