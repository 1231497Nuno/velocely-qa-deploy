import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Configuração de campos por módulo (Definições → Campos):
 * obrigatórios, campos personalizados e cores das linhas.
 */
const CamposCtx = createContext(null);

const VAZIO = { obrigatorios: [], extras: [], cores_linhas: { campo: "", mapa: {} } };

export function CamposProvider({ children }) {
  const { user } = useAuth();
  const [catalogo, setCatalogo] = useState({});
  const userId = user?.id;

  const recarregar = useCallback(async () => {
    if (!userId) return;
    try {
      setCatalogo(await api.get("/settings/campos"));
    } catch {
      /* sem configuração: comporta-se como antes */
    }
  }, [userId]);

  useEffect(() => { recarregar(); }, [recarregar]);

  const value = useMemo(() => {
    const config = (modulo) => catalogo[modulo]?.config || VAZIO;
    return {
      catalogo,
      recarregar,
      config,
      /** Campos personalizados ativos do módulo. */
      extras: (modulo) => (config(modulo).extras || []).filter((c) => c.ativo !== false),
      /** true se o campo do sistema foi marcado como obrigatório. */
      obrigatorio: (modulo, key) => (config(modulo).obrigatorios || []).includes(key),
      /** Cor da linha na listagem para um registo (ou ""). */
      corLinha: (modulo, registo) => {
        if (!registo) return "";
        const meta = catalogo[modulo];
        const cl = config(modulo).cores_linhas || {};
        if (!meta || !cl.campo) return "";
        if (cl.campo === "estado") {
          const campoEstado = meta.estado?.campo;
          return (campoEstado && cl.mapa?.[registo[campoEstado]]) || "";
        }
        if (cl.campo.startsWith("extra:")) {
          const key = cl.campo.slice(6);
          const def = (config(modulo).extras || []).find((c) => c.key === key);
          const valor = registo.campos_extra?.[key];
          return def?.opcoes?.find((o) => o.valor === valor)?.cor || "";
        }
        return "";
      },
    };
  }, [catalogo, recarregar]);

  return <CamposCtx.Provider value={value}>{children}</CamposCtx.Provider>;
}

export function useCampos() {
  const ctx = useContext(CamposCtx);
  if (!ctx) {
    return {
      catalogo: {}, recarregar: () => {}, config: () => VAZIO, extras: () => [],
      obrigatorio: () => false, corLinha: () => "",
    };
  }
  return ctx;
}

/** Estilo para pintar uma linha de tabela/cartão com a cor configurada. */
export function estiloCor(cor) {
  if (!cor) return undefined;
  return { boxShadow: `inset 4px 0 0 ${cor}`, backgroundColor: `${cor}14` };
}
