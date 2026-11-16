import { useNavigate } from "react-router-dom";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";

/**
 * Página de criação (padrão único): barra fixa com «Voltar», título «Novo …», Cancelar e Guardar;
 * o formulário em blocos por baixo. Depois de guardar, a página de criação abre a ficha do registo.
 * Usada em clientes, fornecedores e artigos (/x/novo).
 */
export default function NovoRegisto({ titulo, subtitulo, voltar, voltarLabel = "Voltar", onGuardar, saving = false, testid = "novo-registo", children }) {
  const nav = useNavigate();
  return (
    <div className="max-w-[1400px] mx-auto" data-testid={testid}>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav(voltar)} testid={`${testid}-back`} label={voltarLabel} />}
        title={<h1 className="text-lg sm:text-xl font-bold font-display text-gray-900">{titulo}</h1>}
        subtitle={subtitulo}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => nav(voltar)} className="btn btn-secundario">Cancelar</button>
            <button type="button" data-testid={`${testid}-guardar`} disabled={saving} onClick={onGuardar} className="btn btn-primario">
              {saving ? "A guardar…" : "Guardar"}
            </button>
          </div>
        }
      />
      {children}
    </div>
  );
}
