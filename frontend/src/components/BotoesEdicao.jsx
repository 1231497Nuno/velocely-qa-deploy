import { Check, Lock, Pencil, Save, X } from "lucide-react";

/**
 * Botões de edição iguais em todas as fichas.
 *
 * - Sem permissão: não mostra nada.
 * - Documento em estado final: mostra "Bloqueado" com o motivo.
 * - Em leitura: botão "Editar".
 * - Em edição:
 *     · fichas com gravação ao sair do campo (`autoGuardado`): "Concluir edição";
 *     · restantes: "Cancelar" + "Guardar".
 */
export default function BotoesEdicao({
  modo,
  onGuardar,
  onCancelar,
  guardando = false,
  autoGuardado = false,
  testid = "ficha",
  guardarLabel = "Guardar",
}) {
  if (!modo?.permitido) return null;

  if (modo.bloqueio) {
    return (
      <span
        data-testid={`${testid}-bloqueado`}
        title={`${modo.bloqueio} — não é possível editar`}
        className="inline-flex items-center gap-1.5 rounded-sm border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-600"
      >
        <Lock size={13} /> {modo.bloqueio}
      </span>
    );
  }

  if (!modo.editando) {
    return (
      <button type="button" data-testid={`${testid}-editar-btn`} onClick={modo.iniciar} className="btn btn-primario">
        <Pencil size={15} /> Editar
      </button>
    );
  }

  if (autoGuardado) {
    return (
      <button type="button" data-testid={`${testid}-concluir-edicao-btn`} onClick={modo.terminar} className="btn btn-primario">
        <Check size={15} /> Concluir edição
      </button>
    );
  }

  const cancelar = async () => {
    if (onCancelar) await onCancelar();
    modo.terminar();
  };
  const guardar = async () => {
    const ok = onGuardar ? await onGuardar() : true;
    if (ok !== false) modo.terminar();
  };

  return (
    <>
      <button type="button" data-testid={`${testid}-cancelar-btn`} onClick={cancelar} disabled={guardando} className="btn btn-secundario">
        <X size={15} /> Cancelar
      </button>
      <button type="button" data-testid={`${testid}-guardar-btn`} onClick={guardar} disabled={guardando} className="btn btn-primario">
        <Save size={15} /> {guardando ? "A guardar…" : guardarLabel}
      </button>
    </>
  );
}
