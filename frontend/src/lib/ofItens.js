/** Artigo da OF que não se produz: só se vai buscar (comprado / de stock) e junta à encomenda. */
export const aPreparar = (it) => it.tipo_item === "preparar" || (!it.tipo_item && !(it.operacoes || []).length && !(it.materiais || []).length);
