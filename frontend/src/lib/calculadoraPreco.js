/** Cálculo de preço por técnica (parâmetros em Definições → Calculadora de preços). Devolve { unit, total, custo, detalhe }. */
const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function dtfComprimento(t, w, h, qtd) {
  const esp = n(t.espaco_cm);
  const larg = n(t.largura_util_cm) || 57;
  const tentar = (a, b) => {
    const porLinha = Math.floor((larg + esp) / (a + esp));
    if (porLinha < 1) return null;
    return { porLinha, cm: Math.ceil(qtd / porLinha) * (b + esp) };
  };
  const opcoes = [tentar(w, h), tentar(h, w)].filter(Boolean);
  if (!opcoes.length) return null;
  return opcoes.sort((x, y) => x.cm - y.cm)[0];
}

export function calcular(t, e) {
  const qtd = Math.max(1, n(e.quantidade));
  const m = 1 + n(t.margem_pct) / 100;
  let custo = 0;
  let total = 0;
  let detalhe = "";
  if (t.tipo === "dtf") {
    const lay = dtfComprimento(t, n(e.largura_cm), n(e.altura_cm), qtd);
    if (!lay) return { erro: `A estampa não cabe na largura útil (${n(t.largura_util_cm) || 57} cm)` };
    custo = (lay.cm / 100) * n(t.custo_metro);
    total = custo * m + n(t.extra_unidade) * qtd;
    detalhe = `${lay.porLinha} por linha · ${r2(lay.cm / 100)} m de filme · material ${r2(custo)} €`;
  } else if (t.tipo === "area") {
    const area = (n(e.largura_cm) * n(e.altura_cm)) / 10000 * qtd;
    custo = area * n(t.custo_m2);
    total = custo * m + n(t.setup);
    detalhe = `${r2(area)} m² · custo ${r2(custo)} €`;
  } else if (t.tipo === "tempo") {
    const minutos = n(t.setup_min) + n(e.minutos) * qtd;
    custo = (minutos / 60) * n(t.custo_hora) + n(e.material) * qtd;
    total = custo * m;
    detalhe = `${r2(minutos)} min de máquina · custo ${r2(custo)} €`;
  } else if (t.tipo === "fornecedor") {
    custo = n(e.custo) * qtd;
    total = custo * (1 + n(t.iva_pct) / 100) * m;
    detalhe = `custo ${r2(custo)} € + IVA ${n(t.iva_pct)}% + margem ${n(t.margem_pct)}%`;
  }
  if (n(t.minimo) && total < n(t.minimo)) {
    total = n(t.minimo);
    detalhe += ` · aplicado mínimo ${r2(n(t.minimo))} €`;
  }
  return { unit: r2(total / qtd), total: r2(r2(total / qtd) * qtd), custo: r2(custo), detalhe };
}

export const CAMPOS_ENTRADA = {
  dtf: [["largura_cm", "Largura da estampa (cm)"], ["altura_cm", "Altura (cm)"]],
  area: [["largura_cm", "Largura (cm)"], ["altura_cm", "Altura (cm)"]],
  tempo: [["minutos", "Minutos de máquina por peça"], ["material", "Material por peça (€)"]],
  fornecedor: [["custo", "Custo do fornecedor por unidade (€)"]],
};

export const CAMPOS_TECNICA = {
  dtf: [["largura_util_cm", "Largura útil (cm)"], ["custo_metro", "Custo do metro (€)"], ["margem_pct", "Margem (%)"], ["extra_unidade", "Extra por estampa (€)"], ["espaco_cm", "Espaço entre estampas (cm)"], ["minimo", "Mínimo (€)"]],
  area: [["custo_m2", "Custo por m² (€)"], ["margem_pct", "Margem (%)"], ["setup", "Preparação (€)"], ["minimo", "Mínimo (€)"]],
  tempo: [["custo_hora", "Custo por hora (€)"], ["margem_pct", "Margem (%)"], ["setup_min", "Preparação (min)"], ["minimo", "Mínimo (€)"]],
  fornecedor: [["iva_pct", "IVA (%)"], ["margem_pct", "Margem (%)"], ["minimo", "Mínimo (€)"]],
};
export const TIPOS_TECNICA = { dtf: "Ao metro linear (DTF)", area: "Por área (UV, vinil…)", tempo: "Por tempo de máquina (laser)", fornecedor: "Artigo de fornecedor" };
