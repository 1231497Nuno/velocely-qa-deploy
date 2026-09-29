/** Matéria-prima: preço da placa + L×A → €/m² (alimenta receitas e orçamentos). */

const LINEAR_TO_M = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  inch: 0.0254,
  '"': 0.0254,
};

export function linearToM(val, unidade = "mm") {
  const v = Number(val) || 0;
  if (v <= 0) return 0;
  const u = String(unidade || "mm").trim().toLowerCase();
  return v * (LINEAR_TO_M[u] ?? 0.001);
}

export function areaPlacaM2(artigo) {
  if (!artigo) return 0;
  const comp = linearToM(artigo.comprimento_mm, artigo.comprimento_unidade || "mm");
  const larg = linearToM(artigo.largura_mm, artigo.largura_unidade || "mm");
  if (comp <= 0 || larg <= 0) return 0;
  return Math.round(comp * larg * 100) / 100;
}

export function custoM2FromPlaca(artigo) {
  if (!artigo) return 0;
  const preco = Number(artigo.preco_compra) || 0;
  const area = areaPlacaM2(artigo);
  if (preco <= 0 || area <= 0) return 0;
  return Math.round((preco / area) * 100) / 100;
}

/** Se MP/consumível tem placa+preço, devolve patch com custo_artigo €/m² e unidade m². */
export function applyCustoPlaca(form) {
  const tipo = form?.tipo_artigo;
  if (tipo !== "materia_prima" && tipo !== "consumivel") return form;
  const custoM2 = custoM2FromPlaca(form);
  if (custoM2 <= 0) return form;
  const un = String(form.unidade || "").trim().toLowerCase().replace("m2", "m²");
  return {
    ...form,
    custo_artigo: custoM2,
    unidade: un === "m²" || un === "m2" ? form.unidade || "m²" : "m²",
  };
}

/** Custo por unidade de medida usado em receitas/orçamentos (€/m² se veio da placa). */
export function custoUnitarioArtigo(artigo) {
  if (!artigo) return 0;
  const tipo = artigo.tipo_artigo;
  if (tipo === "materia_prima" || tipo === "consumivel") {
    const m2 = custoM2FromPlaca(artigo);
    if (m2 > 0) return m2;
  }
  return Number(artigo.custo_artigo ?? artigo.custo_unitario) || 0;
}

/**
 * Custo de um consumo: se m² e tem L×A → área(m²) × €/m² × nº peças;
 * senão quantidade × custo unitário.
 */
export function custoConsumoMedida({ unidade, custo_unitario, quantidade, comprimento_mm, largura_mm, modo_m2 }) {
  const custoU = Number(custo_unitario) || 0;
  const qtd = Number(quantidade) || 0;
  const un = String(unidade || "").trim().toLowerCase().replace("m2", "m²");
  if (un === "m²") {
    const comp = Number(comprimento_mm) || 0;
    const larg = Number(largura_mm) || 0;
    const porDims = modo_m2 === "dimensoes" || (modo_m2 !== "area" && comp > 0 && larg > 0);
    if (porDims && comp > 0 && larg > 0) {
      const area = (comp / 1000) * (larg / 1000);
      return Math.round(area * custoU * (qtd > 0 ? qtd : 1) * 100) / 100;
    }
    return Math.round(qtd * custoU * 100) / 100;
  }
  return Math.round(qtd * custoU * 100) / 100;
}

export function unidadeMedida(artigoOuUnidade) {
  if (artigoOuUnidade == null) return "un";
  if (typeof artigoOuUnidade === "string") {
    return artigoOuUnidade.trim() || "un";
  }
  return String(artigoOuUnidade.unidade || "un").trim() || "un";
}
