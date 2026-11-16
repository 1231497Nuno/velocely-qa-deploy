import { Link, useNavigate } from "react-router-dom";
import { ClipboardList, PackageCheck, ArrowLeftRight, Search, SlidersHorizontal, QrCode, Monitor, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { MovelHeader, Pagina } from "./comum";

/** Início da app móvel: atalhos grandes para os registos do dia a dia. */
export default function MovelHome() {
  const { user, can, logout } = useAuth();
  const confirm = useConfirm();
  const nav = useNavigate();
  const ops = [
    { to: "/m/rececoes", label: "Receções", desc: "Dar entrada do que chegou", icon: PackageCheck, ok: can("ordens_compra", "edit"), cor: "bg-emerald-600" },
    { to: "/m/inventario", label: "Inventário", desc: "Contar artigos", icon: ClipboardList, ok: can("artigos", "edit"), cor: "bg-sky-600" },
    { to: "/m/transferir", label: "Transferir", desc: "Mudar de localização", icon: ArrowLeftRight, ok: can("artigos", "edit"), cor: "bg-amber-600" },
    { to: "/m/consultar", label: "Consultar stock", desc: "Onde está e quanto há", icon: Search, ok: can("artigos", "view"), cor: "bg-gray-800" },
    { to: "/m/acertar", label: "Acertar stock", desc: "Corrigir uma quantidade", icon: SlidersHorizontal, ok: can("artigos", "edit"), cor: "bg-violet-600" },
    { to: "/oficina", label: "Oficina", desc: "Operações das OF", icon: QrCode, ok: can("ordens_fabrico", "view"), cor: "bg-rose-700" },
  ].filter((o) => o.ok);
  const sair = async () => {
    if (await confirm({ title: "Terminar sessão?", confirmLabel: "Sair" })) { logout(); nav("/login?next=/m", { replace: true }); }
  };
  return (
    <Pagina>
      <MovelHeader titulo="Velocely Móvel" voltar={null}
        direita={<button type="button" aria-label="Sair" className="p-2 rounded-lg active:bg-white/10" onClick={sair}><LogOut className="w-5 h-5" /></button>} />
      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600">Olá, <b>{user?.name?.split(" ")[0] || ""}</b>. O que vai registar?</p>
        <div className="grid grid-cols-2 gap-3">
          {ops.map((o) => (
            <Link key={o.to} to={o.to} className="bg-white rounded-2xl border p-4 flex flex-col gap-3 active:bg-gray-100 shadow-sm" data-testid={`movel-op-${o.to.split("/").pop()}`}>
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
