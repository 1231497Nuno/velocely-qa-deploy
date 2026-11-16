import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Listas do ERP (Definições → Listas): condições de pagamento, origens, motivos, transportadoras… */
let cache = null;
let pedido = null;
const ouvintes = new Set();

export function recarregarListas() {
  cache = null;
  pedido = null;
  carregar();
}

function carregar() {
  if (!pedido) {
    pedido = api.get("/listas").then((r) => { cache = r || {}; ouvintes.forEach((f) => f(cache)); return cache; })
      .catch(() => { pedido = null; return cache || {}; });
  }
  return pedido;
}

export function useListas() {
  const [listas, setListas] = useState(cache || {});
  useEffect(() => {
    ouvintes.add(setListas);
    if (!cache) carregar(); else setListas(cache);
    return () => ouvintes.delete(setListas);
  }, []);
  return listas;
}

/** Valores de uma lista + o valor atual (se já não existir na lista, continua a aparecer). */
export function opcoesLista(listas, chave, atual = "", { vazio = true } = {}) {
  const vals = [...(listas?.[chave] || [])];
  if (atual && !vals.includes(atual)) vals.unshift(atual);
  return vazio ? ["", ...vals] : vals;
}
