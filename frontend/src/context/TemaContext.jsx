import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { aplicarTema, normalizarTema, TEMA_DEFAULT } from "@/lib/tema";

const TemaCtx = createContext({ tema: TEMA_DEFAULT, logo: "", recarregar: () => {}, preVisualizar: () => {} });

/** Carrega a aparência (pública, sem login) e aplica-a logo no arranque. */
export function TemaProvider({ children }) {
  const [tema, setTema] = useState(() => aplicarTema(TEMA_DEFAULT));
  const [logo, setLogo] = useState("");

  const recarregar = useCallback(async () => {
    try {
      const b = await api.get("/branding");
      setTema(aplicarTema(b?.tema));
      setLogo(b?.logo_base64 || "");
    } catch {
      /* mantém o tema por defeito */
    }
  }, []);

  /** Aplica um tema sem guardar (pré-visualização nas Definições). */
  const preVisualizar = useCallback((t) => setTema(aplicarTema(normalizarTema(t))), []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const value = useMemo(() => ({ tema, logo, recarregar, preVisualizar }), [tema, logo, recarregar, preVisualizar]);
  return <TemaCtx.Provider value={value}>{children}</TemaCtx.Provider>;
}

export function useTema() {
  return useContext(TemaCtx);
}
