import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, FileDown, Image as ImageIcon, Loader2, MessageSquare, Smartphone, XCircle, CreditCard } from "lucide-react";
import { api, API, eur, fmtDate } from "@/lib/api";

const ESTADO_ENC = { aberta: "Recebida", em_producao: "Em produção", concluida: "Pronta", cancelada: "Cancelada" };
const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10";
const msgErro = (e, d) => {
  const x = e?.response?.data?.detail;
  return typeof x === "string" ? x : d;
};

function Arte({ token, linha, onDone }) {
  const [modo, setModo] = useState(null);
  const [comentario, setComentario] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const ap = linha.arte_aprovacao;
  const decidir = async (aprovada) => {
    setBusy(true); setErro("");
    try { await api.post(`/publico/${token}/arte/${linha.id}`, { aprovada, comentario }); onDone(); setModo(null); }
    catch (e) { setErro(msgErro(e, "Não foi possível enviar")); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ImageIcon size={15} className="text-gray-500" />
        <a href={`${API}/publico/${token}/arte/${linha.id}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">Ver maqueta{linha.arte_nome ? ` (${linha.arte_nome})` : ""}</a>
        {ap && <span className={`ml-auto inline-flex items-center gap-1 text-xs font-medium ${ap.aprovada ? "text-emerald-700" : "text-amber-700"}`}>
          {ap.aprovada ? <CheckCircle2 size={14} /> : <MessageSquare size={14} />} {ap.aprovada ? "Aprovada" : "Alteração pedida"} em {fmtDate(ap.at)}</span>}
      </div>
      {!ap && !modo && (
        <div className="flex gap-2 mt-2">
          <button type="button" className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium" onClick={() => decidir(true)} disabled={busy} data-testid={`portal-arte-ok-${linha.id}`}>Aprovar maqueta</button>
          <button type="button" className="px-3 py-1.5 rounded-md border border-gray-300 text-sm font-medium" onClick={() => setModo("alterar")}>Pedir alteração</button>
        </div>
      )}
      {modo === "alterar" && (
        <div className="mt-2 space-y-2">
          <textarea className={inputCls} rows={3} placeholder="O que quer alterar?" value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm font-medium" onClick={() => decidir(false)} disabled={busy}>Enviar pedido</button>
            <button type="button" className="px-3 py-1.5 rounded-md border border-gray-300 text-sm" onClick={() => setModo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {erro && <p className="text-red-700 text-xs mt-1">{erro}</p>}
    </div>
  );
}

/** Página pública do cliente (link sem login): orçamento ou encomenda. */
export default function PortalCliente() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [resp, setResp] = useState(null);
  const [nome, setNome] = useState("");
  const [comentario, setComentario] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tel, setTel] = useState("");
  const [ref, setRef] = useState(null);
  const carregar = () => api.get(`/publico/${token}`).then(setD).catch((e) => setErro(msgErro(e, "Link inválido")));
  useEffect(() => { carregar(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = async (aceitar) => {
    setBusy(true); setMsg("");
    try { await api.post(`/publico/${token}/resposta`, { aceitar, nome, comentario }); setResp(null); await carregar(); }
    catch (e) { setMsg(msgErro(e, "Não foi possível enviar")); } finally { setBusy(false); }
  };
  const pagar = async (metodo) => {
    setBusy(true); setMsg("");
    try {
      const r = await api.post(`/publico/${token}/pagar`, { metodo, telemovel: tel });
      setRef(r);
      if (metodo === "mbway") setMsg("Enviámos o pedido para o seu telemóvel. Confirme na app MB WAY nos próximos 4 minutos.");
    } catch (e) { setMsg(msgErro(e, "Não foi possível criar o pagamento")); } finally { setBusy(false); }
  };

  if (erro) return <div className="min-h-screen grid place-items-center p-6 text-center text-gray-600">{erro}</div>;
  if (!d) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-gray-400" /></div>;
  const orc = d.tipo === "orcamento";
  const respondido = orc && (d.resposta || ["aceite", "rejeitado"].includes(d.estado) || d.encomenda_id);
  const refs = ref && ref.metodo === "multibanco" ? [ref] : (d.referencias || []).filter((r) => r.metodo === "multibanco");

  return (
    <div className="min-h-screen bg-gray-100 py-6 sm:py-10 px-3" data-testid="portal-cliente">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="text-center">
          <div className="text-xl font-bold tracking-tight">{d.empresa?.nome || "Fam'Art"}</div>
          <div className="text-xs text-gray-500">{[d.empresa?.telefone || d.empresa?.contacto, d.empresa?.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <div className="text-xs uppercase tracking-wide text-gray-500">{orc ? "Orçamento" : "Encomenda"}</div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-2xl font-bold">{d.numero}</h1>
              {!orc && <span className="text-sm font-medium px-2 py-0.5 rounded-full bg-gray-100">{d.entregue ? "Entregue" : ESTADO_ENC[d.estado] || d.estado}</span>}
            </div>
            <div className="text-sm text-gray-600 mt-1">{d.cliente}{d.descricao ? ` — ${d.descricao}` : ""}</div>
            <div className="text-xs text-gray-500 mt-1">
              {d.data && `Data ${fmtDate(d.data)}`}{orc && d.validade ? ` · Válido até ${fmtDate(d.validade)}` : ""}{!orc && d.prazo_entrega ? ` · Prazo previsto ${fmtDate(d.prazo_entrega)}` : ""}
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {d.linhas.map((l) => (
              <div key={l.id} className="p-4">
                <div className="flex justify-between gap-3 text-sm">
                  <div><div className="font-medium">{l.descricao}</div><div className="text-gray-500">{l.quantidade} × {eur(l.preco_unit)}</div>
                    {l.observacoes && <div className="text-xs text-gray-500 mt-0.5">{l.observacoes}</div>}</div>
                  <div className="font-semibold tabular-nums whitespace-nowrap">{eur(l.total)}</div>
                </div>
                {l.tem_arte && <Arte token={token} linha={l} onDone={carregar} />}
              </div>
            ))}
          </div>
          <div className="p-5 bg-gray-50 border-t border-gray-100 space-y-1 text-sm">
            <div className="flex justify-between text-base font-bold"><span>Total</span><span className="tabular-nums">{eur(d.total)}</span></div>
            {!orc && <><div className="flex justify-between text-gray-600"><span>Pago</span><span className="tabular-nums">{eur(d.pago)}</span></div>
              <div className="flex justify-between font-semibold"><span>Por pagar</span><span className="tabular-nums">{eur(d.pendente)}</span></div></>}
          </div>
        </div>

        {orc && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-3">
            <a href={`${API}/publico/${token}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-2"><FileDown size={16} /> Descarregar PDF</a>
            {respondido ? (
              <div className={`rounded-md p-3 text-sm ${d.estado === "rejeitado" ? "bg-gray-50" : "bg-emerald-50 text-emerald-800"}`}>
                {d.estado === "rejeitado" ? "Recebemos a sua resposta. Obrigado!" : "Orçamento aceite — obrigado! Vamos avançar e entramos em contacto."}
              </div>
            ) : !resp ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="flex-1 min-w-[10rem] px-4 py-2.5 rounded-md bg-emerald-600 text-white font-semibold" onClick={() => setResp("aceitar")} data-testid="portal-aceitar"><CheckCircle2 size={16} className="inline mr-1" /> Aceitar orçamento</button>
                <button type="button" className="flex-1 min-w-[10rem] px-4 py-2.5 rounded-md border border-gray-300 font-medium" onClick={() => setResp("rejeitar")}><XCircle size={16} className="inline mr-1" /> Não aceitar</button>
              </div>
            ) : (
              <div className="space-y-2">
                {resp === "aceitar" && <input className={inputCls} placeholder="O seu nome" value={nome} onChange={(e) => setNome(e.target.value)} data-testid="portal-nome" />}
                <textarea className={inputCls} rows={3} placeholder={resp === "aceitar" ? "Comentário (opcional)" : "Pode dizer-nos porquê? (opcional)"} value={comentario} onChange={(e) => setComentario(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className={`px-4 py-2 rounded-md text-white font-semibold ${resp === "aceitar" ? "bg-emerald-600" : "bg-gray-900"}`} onClick={() => responder(resp === "aceitar")} data-testid="portal-confirmar">Confirmar</button>
                  <button type="button" className="px-4 py-2 rounded-md border border-gray-300" onClick={() => setResp(null)}>Voltar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {!orc && d.pagamento_online && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-3" data-testid="portal-pagar">
            <div className="font-semibold flex items-center gap-2"><CreditCard size={18} /> Pagar {eur(d.pendente)}</div>
            <p className="text-xs text-gray-500">A produção começa quando o pagamento é confirmado.</p>
            {refs.length > 0 && refs.map((r) => (
              <div key={r.referencia} className="rounded-md border border-gray-200 p-3 grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-xs text-gray-500">Entidade</div><div className="font-mono font-semibold">{r.entidade}</div></div>
                <div><div className="text-xs text-gray-500">Referência</div><div className="font-mono font-semibold">{String(r.referencia).replace(/(\d{3})(?=\d)/g, "$1 ")}</div></div>
                <div><div className="text-xs text-gray-500">Valor</div><div className="font-semibold">{eur(r.valor)}</div></div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {d.metodos.includes("multibanco") && !refs.length && <button type="button" disabled={busy} className="px-4 py-2 rounded-md bg-gray-900 text-white font-medium" onClick={() => pagar("multibanco")} data-testid="portal-mb">Referência Multibanco</button>}
              {d.metodos.includes("mbway") && (
                <div className="flex gap-2 items-center flex-1 min-w-[16rem]">
                  <input className={inputCls} inputMode="numeric" placeholder="Telemóvel MB WAY" value={tel} onChange={(e) => setTel(e.target.value)} />
                  <button type="button" disabled={busy} className="px-4 py-2 rounded-md bg-red-600 text-white font-medium whitespace-nowrap" onClick={() => pagar("mbway")}><Smartphone size={15} className="inline mr-1" />MB WAY</button>
                </div>
              )}
            </div>
          </div>
        )}
        {msg && <p className="text-sm text-center text-gray-700">{msg}</p>}
        <p className="text-center text-xs text-gray-400">Link pessoal — não o partilhe. Dúvidas? Contacte-nos.</p>
      </div>
    </div>
  );
}
