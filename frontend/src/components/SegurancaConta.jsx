import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, BellRing, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const erro = (e, d) => toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : (e?.message || d));
const inputCls = "border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";

/** Verificação em dois passos (app autenticadora) na conta do utilizador. */
export function DoisPassos() {
  const { user, refresh } = useAuth();
  const [qr, setQr] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const ativo = !!user?.dois_passos;
  const iniciar = async () => { setBusy(true); try { setQr(await api.post("/auth/2fa/iniciar", {})); } catch (e) { erro(e, "Não foi possível iniciar"); } finally { setBusy(false); } };
  const ativar = async () => {
    setBusy(true);
    try { await api.post("/auth/2fa/ativar", { codigo }); toast.success("Verificação em dois passos ativada"); setQr(null); setCodigo(""); await refresh(); }
    catch (e) { erro(e, "Código incorreto"); } finally { setBusy(false); }
  };
  const desativar = async () => {
    setBusy(true);
    try { await api.post("/auth/2fa/desativar", { password: pw, codigo }); toast.success("Verificação em dois passos desligada"); setPw(""); setCodigo(""); await refresh(); }
    catch (e) { erro(e, "Não foi possível desligar"); } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-gray-100 pt-3 space-y-2" data-testid="conta-2fa">
      <p className="text-sm font-medium text-gray-800 flex items-center gap-2"><ShieldCheck size={15} className={ativo ? "text-emerald-700" : "text-gray-400"} /> Verificação em dois passos {ativo ? <span className="text-emerald-700 text-xs">ativa</span> : <span className="text-gray-400 text-xs">desligada</span>}</p>
      {!ativo && !qr && (
        <>
          <p className="text-xs text-gray-500">Além da password, pede um código de 6 dígitos da app de autenticação do telemóvel (Google Authenticator, Microsoft Authenticator…). Recomendado para administradores.</p>
          <button type="button" className="btn btn-secundario" disabled={busy} onClick={iniciar}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Ativar</button>
        </>
      )}
      {!ativo && qr && (
        <div className="bg-gray-50 border border-gray-200 rounded-sm p-3 space-y-2">
          <p className="text-xs text-gray-600">1. Na app de autenticação, adicione uma conta e leia este código QR (ou escreva a chave). 2. Introduza o código que aparece.</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-40 h-40 bg-white p-1 [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: qr.qr_svg }} />
            <code className="text-xs break-all bg-white border border-gray-200 rounded-sm px-2 py-1 max-w-[14rem]">{qr.segredo}</code>
          </div>
          <div className="flex gap-2">
            <input className={`${inputCls} w-32 tracking-widest text-center`} inputMode="numeric" placeholder="000000" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^0-9]/g, ""))} data-testid="conta-2fa-codigo" />
            <button type="button" className="btn btn-primario" disabled={busy || codigo.length < 6} onClick={ativar}>Confirmar</button>
          </div>
        </div>
      )}
      {ativo && (
        <div className="flex flex-wrap gap-2 items-center">
          <input type="password" className={`${inputCls} w-36`} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className={`${inputCls} w-28 tracking-widest text-center`} inputMode="numeric" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^0-9]/g, ""))} />
          <button type="button" className="btn btn-secundario" disabled={busy || !pw || codigo.length < 6} onClick={desativar}>Desligar</button>
        </div>
      )}
    </div>
  );
}

function b64ParaBytes(b64) {
  const p = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = window.atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Alertas no telemóvel/computador: notificações push dos alertas e aprovações. */
export function AlertasTelemovel() {
  const [estado, setEstado] = useState(null);
  const [ativoAqui, setAtivoAqui] = useState(false);
  const [busy, setBusy] = useState(false);
  const suportado = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  useEffect(() => {
    api.get("/push/estado").then(setEstado).catch(() => setEstado({ disponivel: false }));
    if (suportado) navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => setAtivoAqui(!!s)).catch(() => {});
  }, [suportado]);
  if (!estado) return null;
  const ativar = async () => {
    setBusy(true);
    try {
      const perm = await window.Notification.requestPermission();
      if (perm !== "granted") { toast.error("Autorize as notificações no browser para receber os alertas"); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(estado.chave_publica) });
      await api.post("/push/subscrever", { subscricao: sub.toJSON(), aparelho: navigator.userAgent.slice(0, 80) });
      setAtivoAqui(true);
      await api.post("/push/teste", {});
      toast.success("Alertas ativos neste aparelho");
    } catch (e) { erro(e, "Não foi possível ativar os alertas"); } finally { setBusy(false); }
  };
  const desativar = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api.post("/push/cancelar", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setAtivoAqui(false);
      toast.success("Alertas desligados neste aparelho");
    } catch (e) { erro(e, "Não foi possível desligar"); } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-gray-100 pt-3 space-y-2" data-testid="conta-push">
      <p className="text-sm font-medium text-gray-800 flex items-center gap-2"><BellRing size={15} className={ativoAqui ? "text-emerald-700" : "text-gray-400"} /> Alertas neste aparelho</p>
      {!estado.disponivel ? (
        <p className="text-xs text-gray-500">As notificações push ainda não estão ligadas no servidor.</p>
      ) : !suportado ? (
        <p className="text-xs text-gray-500">Este browser não suporta notificações. No iPhone: abra o Velocely no Safari → Partilhar → «Adicionar ao ecrã principal» e ative a partir daí.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">Recebe aqui os alertas e pedidos de aprovação (mesmo com a app fechada).{estado.aparelhos?.length ? ` Ativo em ${estado.aparelhos.length} aparelho(s).` : ""}</p>
          {ativoAqui
            ? <button type="button" className="btn btn-secundario" disabled={busy} onClick={desativar}>Desligar neste aparelho</button>
            : <button type="button" className="btn btn-secundario" disabled={busy} onClick={ativar} data-testid="conta-push-ativar">{busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Ativar alertas</button>}
        </>
      )}
    </div>
  );
}
