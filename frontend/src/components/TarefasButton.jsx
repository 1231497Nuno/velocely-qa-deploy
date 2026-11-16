import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import HeaderIconBadge, { HEADER_ICON_BTN } from "@/components/HeaderIconBadge";

/** Ícone do topo: aprovações pendentes + alertas por ler (abre a página Tarefas). */
export default function TarefasButton() {
  const nav = useNavigate();
  const location = useLocation();
  const [c, setC] = useState({ total: 0, aprovacoes: 0 });

  const carregar = useCallback(() => {
    api.get("/tarefas/contagem").then(setC).catch(() => {});
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 90000);
    return () => clearInterval(t);
  }, [carregar, location.pathname]);

  useEffect(() => {
    const h = (ev) => {
      carregar();
      const d = ev.detail || {};
      if (d.codigo === "aprovacao_pedida") {
        toast.message("Pedido de aprovação enviado", { description: "Quando for aprovado, tente de novo.", action: { label: "Ver", onClick: () => nav("/tarefas") } });
      }
    };
    const r = () => carregar();
    window.addEventListener("velocely:aprovacao", h);
    window.addEventListener("velocely:tarefas", r);
    return () => { window.removeEventListener("velocely:aprovacao", h); window.removeEventListener("velocely:tarefas", r); };
  }, [carregar, nav]);

  return (
    <button type="button" onClick={() => nav("/tarefas")} className={HEADER_ICON_BTN} title="Tarefas e aprovações" data-testid="header-tarefas">
      <ListChecks size={19} />
      <HeaderIconBadge count={c.total} critical={c.aprovacoes > 0} testid="header-tarefas-badge" />
    </button>
  );
}
