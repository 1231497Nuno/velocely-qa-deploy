import BlocosShell from "@/components/BlocosShell";
import { BLOCOS_ARTIGO, blocosVisiveis } from "@/features/artigos/artigoTipos";

export { FieldGrid, FieldRow } from "@/components/BlocosShell";

/**
 * Contentor de blocos da ficha de artigo: minimizar e reordenar (arrastar).
 * Preferência guardada em localStorage.
 */
export default function ArtigoBlocosShell({ tipo, produzido, renderBlock }) {
  const visiveis = blocosVisiveis(tipo, produzido);
  return (
    <BlocosShell
      testid="artigo-blocos"
      blocks={BLOCOS_ARTIGO}
      storageKey="artigo-blocos-layout-v1"
      visibleIds={visiveis}
      renderBlock={renderBlock}
    />
  );
}
