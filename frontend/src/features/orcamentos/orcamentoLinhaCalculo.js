/** Cálculo explícito de custo/preço de uma linha de orçamento. */

import { custoConsumoMedida } from "@/features/artigos/artigoCustoPlaca";

export function custoOperacoesUnit(l, { maquinas = [], maoObra = [], toHours, maqHora }) {
  let c = 0;
  for (const op of l?.roteiro || []) {
    const mq = maquinas.find((x) => x.id === op.maquina_id);
    const mo = maoObra.find((x) => x.id === op.mao_obra_id);
    c += toHours(op.tempo_maquina, op.tempo_maquina_unidade) * maqHora(mq);
    c += toHours(op.tempo_mao_obra, op.tempo_mao_obra_unidade) * (mo ? Number(mo.custo_hora) || 0 : 0);
  }
  return Math.round(c * 100) / 100;
}

/**
 * Breakdown unitário explícito:
 * compra (artigo) + materiais (receita) + operações = custo
 * preço calc = custo × (1 + margem/100)
 */
export function breakdownLinhaUnit(l, materiais = [], ctx = {}) {
  const qtd = Number(l?.quantidade) > 0 ? Number(l.quantidade) : 1;
  const modo = l?.modo_calculo;
  const usaReceita = modo === "producao" || modo === "materia_prima";
  const usaOps = modo === "producao";

  let compra = 0;
  if (modo === "materia_prima") {
    compra = 0;
  } else if (modo === "servico" || modo === "compra" || modo === "diversos") {
    compra = Number(l?.custo_compra_unit) || 0;
  } else if (modo === "producao") {
    compra = Number(l?.custo_compra_unit) || 0;
  } else {
    compra = l?.eh_materia_prima ? 0 : (Number(l?.custo_compra_unit) || 0);
  }

  const matsLinha = usaReceita
    ? (materiais || []).filter((m) => m.da_receita && m.linha_origem_id === l?.id)
    : [];
  const matCustoFn = ctx.matCusto || ((m) => custoConsumoMedida(m));
  const materiaisTotal = matsLinha.reduce((s, m) => s + matCustoFn(m), 0);
  const materiaisUnit = Math.round((materiaisTotal / qtd) * 100) / 100;
  const operacoesUnit = usaOps ? custoOperacoesUnit(l, ctx) : 0;
  const custo = Math.round((compra + materiaisUnit + operacoesUnit) * 100) / 100;
  const margem = Number(l?.margem) || 0;
  const precoCalc = Math.round(custo * (1 + margem / 100) * 100) / 100;
  const precoCatalogo = Number(l?.preco_venda_catalogo) || 0;
  const margemCatalogo =
    custo > 0 && precoCatalogo > 0
      ? Math.round(((precoCatalogo / custo) - 1) * 10000) / 100
      : margem;

  return {
    compra,
    materiais: materiaisUnit,
    materiaisTotal,
    materiaisLinhas: matsLinha,
    operacoes: operacoesUnit,
    custo,
    margem,
    precoCalc,
    precoCatalogo,
    margemCatalogo,
    modo,
  };
}

/** Preço unitário a mostrar / usar, conforme origem. */
export function precoUnitFromBreakdown(l, bd) {
  if (l?.preco_unit_manual || l?.preco_origem === "manual") {
    return Number(l.preco_unit) || 0;
  }
  if (l?.preco_origem === "calculado") {
    return bd.precoCalc;
  }
  // catalogo: preço de venda que veio do artigo
  if (l?.preco_venda_catalogo != null && l.preco_venda_catalogo !== "") {
    return Number(l.preco_venda_catalogo) || Number(l.preco_unit) || 0;
  }
  return Number(l?.preco_unit) || bd.precoCalc || 0;
}
