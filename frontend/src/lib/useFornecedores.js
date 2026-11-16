import { useEffect, useState } from "react";
import { api } from "@/lib/api";

let cache = null;
let pedido = null;

/** Lista de fornecedores (carregada uma vez por sessão do ecrã; para seletores com pesquisa). */
export function useFornecedores() {
  const [lista, setLista] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    pedido = pedido || api.get("/fornecedores").then((r) => { cache = Array.isArray(r) ? r : r.items || []; return cache; }).catch(() => []);
    let vivo = true;
    pedido.then((l) => { if (vivo) setLista(l); });
    return () => { vivo = false; };
  }, []);
  return lista;
}

/** Esquecer a cache (ex.: depois de criar um fornecedor). */
export function limparCacheFornecedores() {
  cache = null;
  pedido = null;
}
