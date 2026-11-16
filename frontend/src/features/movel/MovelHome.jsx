import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ClipboardList, PackageCheck, ArrowLeftRight, Search, SlidersHorizontal, QrCode, Monitor, LogOut, MapPin,
  ArrowUpFromLine, AlertTriangle, History, RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { MovelHeader, Pagina, ArtigoPicker } from "./comum";

/** Início da app móvel: procurar/ler um artigo logo no topo, atalhos com contadores e as restantes operações. */
export default function MovelHome() {
  const { user, can, logout } = useAuth();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [res, setRes] = useState(null);
  const carregar = () => api.get("/movel/resumo").then(setRes).catch(() => {});
  useEffect(() => { carregar(); }, []);

  const inv = res?.inventario;
  const ops = [
    { to: "/m/rececoes", label: "Receções", desc: res ? (res.ocs_por_receber ? `${res.fornecedores_por_receber} fornecedor(es) · ${res.ocs_por_receber} encomenda(s)` : "Nada por receber") : "Dar entrada do que chegou", icon: PackageCheck, ok: can("ordens_compra", "edit"), cor: "bg-emerald-600", badge: res?.ocs_por_receber },
    { to: "/m/inventario", label: "Inventário", desc: inv ? `Aberto · ${Math.round((inv.n_contados / Math.max(inv.n_linhas, 1)) * 100)}% contado` : "Contar artigos", icon: ClipboardList, ok: can("artigos", "edit"), cor: "bg-sky-600" },
    { to: "/m/localizacoes", label: "Localizações", desc: "O que está em cada sítio", icon: MapPin, ok: can("artigos", "view"), cor: "bg-amber-600" },
    { to: "/m/transferir", label: "Transferir", desc: "Mudar de localização", icon: ArrowLeftRight, ok: can("artigos", "edit"), cor: "bg-orange-600" },
    { to: "/m/movimento", label: "Entrada / saída", desc: "Consumo, amostra, quebra…", icon: ArrowUpFromLine, ok: can("artigos", "edit"), cor: "bg-red-600" },
    { to: "/m/acertar", label: "Acertar stock", desc: "Corrigir uma quantidade", icon: SlidersHorizontal, ok: can("artigos", "edit"), cor: "bg-violet-600" },
    { to: "/m/stock-baixo", label: "Stock baixo", desc: res ? `${res.stock_baixo} artigo(s) a repor` : "Abaixo do nível", icon: AlertTriangle, ok: can("artigos", "view"), cor: "bg-yellow-600", badge: res?.stock_baixo },
    { to: "/m/movimentos", label: "Movimentos", desc: "Últimos registos", icon: History, ok: can("artigos", "view"), cor: "bg-gray-700" },
    { to: "/m/consultar", label: "Consultar stock", desc: "Onde está e quanto há", icon: Search, ok: can("artigos", "view"), cor: "bg-gray-800" },
    { to: "/oficina", label: "Oficina", desc: "Operações das OF", icon: QrCode, ok: can("ordens_fabrico", "view"), cor: "bg-rose-700" },
  ].filter((o) => o.ok);
  const sair = async () => {
    if (await confirm({ title: "Terminar sessão?", confirmLabel: "Sair" })) { logout(); nav("/login?next=/m", { replace: true }); }
  };
  return (
    <Pagina>
      <MovelHeader titulo="Velocely Móvel" voltar={null}
        direita={<>
          <button type="button" aria-label="Atualizar" className="p-2 rounded-lg active:bg-white/10" onClick={carregar}><RefreshCw className="w-5 h-5" /></button>
          <button type="button" aria-label="Sair" className="p-2 rounded-lg active:bg-white/10" onClick={sair}><LogOut className="w-5 h-5" /></button>
        </>} />
      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600">Olá, <b>{user?.name?.split(" ")[0] || ""}</b>. Leia um código ou escolha o que vai registar.</p>
        {can("artigos", "view") && <ArtigoPicker autoFocus={false} placeholder="Procurar ou ler um artigo…" onEscolher={(a) => nav("/m/consultar", { state: { artigo: a } })} />}
        <div className="grid grid-cols-2 gap-3">
          {ops.map((o) => (
            <Link key={o.to} to={o.to} className="relative bg-white rounded-2xl border p-4 flex flex-col gap-3 active:bg-gray-100 shadow-sm" data-testid={`movel-op-${o.to.split("/").pop()}`}>
              {o.badge > 0 && <span className="absolute top-3 right-3 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center">{o.badge}</span>}
              <span className={`w-12 h-12 rounded-xl ${o.cor} text-white flex items-center justify-center`}><o.icon className="w-6 h-6" /></span>
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-xs text-gray-500">{o.desc}</span>
              </span>
            </Link>
          ))}
        </div>
        {!ops.length && <p className="text-sm text-gray-500">O seu perfil não tem acesso a nenhuma operação de armazém.</p>}
        <Link to="/" className="flex items-center justify-center gap-2 text-sm text-gray-600 py-3"><Monitor className="w-4 h-4" /> Abrir a versão completa</Link>
      </div>
    </Pagina>
  );
}
