import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";

const NOMES = {
  clientes: "clientes", fornecedores: "fornecedores", artigos: "artigos", leads: "leads", orcamentos: "orçamentos",
  encomendas: "encomendas", ordens_fabrico: "OF", ordens_compra: "ordens de compra", nao_conformidades: "não conformidades",
  maquinas: "máquinas", mao_obra: "mão de obra", categorias: "categorias", subcategorias: "subcategorias", relatorios_guardados: "relatórios",
};

/** Dados de simulação para testes: cria/apaga um conjunto completo marcado com [SIM]. Só administradores. */
export default function SimulacaoCard() {
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState("");
  const carregar = () => api.get("/simulacao").then(setEst).catch(() => {});
  useEffect(() => { if (isAdmin) carregar(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isAdmin || !est) return null;

  const criar = async () => {
    setBusy("criar");
    try {
      await api.post("/simulacao", {});
      toast.success("Dados de simulação criados");
      await carregar();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Não foi possível criar a simulação");
    } finally { setBusy(""); }
  };
  const apagar = async () => {
    if (!(await confirm({ title: "Apagar dados de simulação?", description: "Apaga tudo o que tem «[SIM]» (e os movimentos de stock desses artigos). Os dados reais não são tocados.", confirmLabel: "Apagar simulação", tone: "danger" }))) return;
    setBusy("apagar");
    try {
      await api.del("/simulacao");
      toast.success("Dados de simulação apagados");
      await carregar();
    } catch { toast.error("Não foi possível apagar"); } finally { setBusy(""); }
  };
  const resumo = Object.entries(est.contagens || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${NOMES[k] || k}`).join(" · ");

  return (
    <div className="bg-white border border-gray-200 rounded-sm p-4 mb-4" data-testid="simulacao-card">
      <div className="flex flex-wrap items-start gap-3">
        <FlaskConical size={20} className="text-gray-500 mt-0.5" />
        <div className="flex-1 min-w-[16rem]">
          <div className="font-semibold text-sm">Dados de simulação (para testes)</div>
          <p className="text-sm text-gray-600 mt-0.5">
            Cria um conjunto completo de dados fictícios, com «[SIM]» no nome: catálogo com e sem stock, máquinas, clientes, leads,
            orçamentos, 14 encomendas dos últimos 6 meses com pagamentos, OF fechadas e em curso, compras com receções,
            uma não conformidade e um relatório guardado. Não emite faturas nem envia emails.
          </p>
          {est.existe && <p className="text-xs text-gray-500 mt-1.5">Existem: {resumo}</p>}
        </div>
        <div className="flex gap-2">
          {!est.existe ? (
            <button type="button" className="btn btn-primario" disabled={!!busy} onClick={criar} data-testid="simulacao-criar">
              {busy === "criar" ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />} Criar simulação
            </button>
          ) : (
            <button type="button" className="btn btn-secundario text-red-700" disabled={!!busy} onClick={apagar} data-testid="simulacao-apagar">
              {busy === "apagar" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Apagar simulação
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
