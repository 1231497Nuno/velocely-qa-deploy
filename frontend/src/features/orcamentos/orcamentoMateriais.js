/** Expande a receita (BOM) de um artigo para linhas de material do orçamento. */

import { isMateriaPrima } from "@/features/artigos/artigoTipos";
import { custoUnitarioArtigo, custoConsumoMedida } from "@/features/artigos/artigoCustoPlaca";

function newMatId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `mat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isM2(un) {
  return ["m²", "m2"].includes((un || "").toLowerCase().replace("m2", "m²"));
}

/** Artigo matéria-prima / consumível vendido directamente na linha do orçamento. */
export function expandMateriaPrimaParaLinhaOrc(artigo, { linhaId, quantidadeLinha = 1 } = {}) {
  if (!artigo?.id || !linhaId || !isMateriaPrima(artigo)) return [];
  const qtdLinha = Number(quantidadeLinha) > 0 ? Number(quantidadeLinha) : 1;
  const un = (artigo.unidade || "un").trim() || "un";
  const m2 = isM2(un);
  const custoUnit = custoUnitarioArtigo(artigo);
  // 1 peça por unidade da linha; em m² o custo = L×A × €/m² × peças
  const qtdUnit = 1;
  const quantidade = qtdUnit * qtdLinha;
  const custo = m2
    ? 0 // até haver L×A; matCusto calcula pela área
    : Math.round(quantidade * custoUnit * 100) / 100;
  return [{
    id: newMatId(),
    consumivel_id: artigo.id,
    material_id: artigo.id,
    nome: artigo.nome || "",
    unidade: un,
    custo_unitario: custoUnit,
    quantidade,
    quantidade_unit: qtdUnit,
    comprimento_mm: 0,
    largura_mm: 0,
    modo_m2: m2 ? "dimensoes" : "area",
    margem: 0,
    custo,
    valor: 0,
    da_receita: true,
    eh_materia_prima_linha: true,
    artigo_origem_id: artigo.id,
    artigo_origem_nome: artigo.nome || "",
    linha_origem_id: linhaId,
  }];
}

function medsFromBom(mat) {
  if (Array.isArray(mat?.medidas) && mat.medidas.length > 0) return mat.medidas;
  return [
    {
      quantidade: mat?.quantidade ?? 0,
      comprimento_mm: mat?.comprimento_mm ?? 0,
      largura_mm: mat?.largura_mm ?? 0,
    },
  ];
}

/**
 * @param {object} artigo - artigo completo (com materiais e preco_venda)
 * @param {{ linhaId: string, quantidadeLinha?: number, custosById?: Record<string, number> }} opts
 */
export function expandReceitaParaMateriaisOrc(artigo, { linhaId, quantidadeLinha = 1, custosById = {} } = {}) {
  if (!artigo?.id || !linhaId) return [];
  const qtdLinha = Number(quantidadeLinha) > 0 ? Number(quantidadeLinha) : 1;
  const out = [];
  for (const mat of artigo.materiais || []) {
    const mid = mat.material_id || mat.consumivel_id;
    if (!mid) continue;
    for (const med of medsFromBom(mat)) {
      const qtdUnit = Number(med.quantidade) || 0;
      const custoUnit =
        Number(mat.custo_unitario) > 0
          ? Number(mat.custo_unitario)
          : (Number(custosById[mid]) || 0);
      const comprimento_mm = Number(med.comprimento_mm) || 0;
      const largura_mm = Number(med.largura_mm) || 0;
      const quantidade = qtdUnit * qtdLinha;
      const un = (mat.unidade || "un").toLowerCase().replace("m2", "m²");
      const custo = custoConsumoMedida({
        unidade: un,
        custo_unitario: custoUnit,
        quantidade,
        comprimento_mm,
        largura_mm,
        modo_m2: med.modo_m2,
      });
      out.push({
        id: newMatId(),
        consumivel_id: mid,
        material_id: mid,
        nome: mat.material_nome || mat.nome || "",
        unidade: mat.unidade || "un",
        custo_unitario: custoUnit,
        quantidade,
        quantidade_unit: qtdUnit,
        comprimento_mm,
        largura_mm,
        modo_m2: med.modo_m2 || (comprimento_mm > 0 && largura_mm > 0 ? "dimensoes" : "area"),
        margem: 0,
        custo,
        valor: 0,
        da_receita: true,
        artigo_origem_id: artigo.id,
        artigo_origem_nome: artigo.nome || "",
        linha_origem_id: linhaId,
      });
    }
  }
  return out;
}

/** Resolve custo unitário dos componentes da receita (artigo MP ou consumível). */
export async function resolverCustosComponentes(materialIds, { api, consumiveis = [] } = {}) {
  const custosById = {};
  const ids = [...new Set((materialIds || []).filter(Boolean))];
  await Promise.all(ids.map(async (id) => {
    const c = consumiveis.find((x) => x.id === id);
    if (c) {
      custosById[id] = custoUnitarioArtigo(c);
      return;
    }
    if (!api) return;
    try {
      const a = await api.get(`/artigos/${id}`);
      custosById[id] = custoUnitarioArtigo(a);
    } catch {
      /* ignore */
    }
  }));
  return custosById;
}

/** Remove materiais da receita ligados a uma linha do orçamento. */
export function semMateriaisDaLinha(materiais, linhaId) {
  if (!linhaId) return materiais || [];
  return (materiais || []).filter((m) => m.linha_origem_id !== linhaId);
}

/** Reescala quantidades dos materiais da receita quando muda a qtd da linha. */
export function reescalarMateriaisDaLinha(materiais, linhaId, quantidadeLinha) {
  const q = Number(quantidadeLinha) > 0 ? Number(quantidadeLinha) : 0;
  return (materiais || []).map((m) => {
    if (!m.da_receita || m.linha_origem_id !== linhaId) return m;
    const unit = m.quantidade_unit != null ? Number(m.quantidade_unit) : Number(m.quantidade) || 0;
    return { ...m, quantidade_unit: unit, quantidade: unit * q };
  });
}
