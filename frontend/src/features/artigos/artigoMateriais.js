/** Unidades e custo de linhas da receita (BOM) de um artigo produzido.
 * Um material pode ter várias medidas/consumos (cortes ou áreas diferentes).
 */

import { custoUnitarioArtigo } from "@/features/artigos/artigoCustoPlaca";

function newMedidaId() {
  return `med-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isUnidadeArea(u) {
  const n = String(u || "").trim().toLowerCase().replace("m2", "m²");
  return n === "m²";
}

/**
 * Modo de entrada para uma medida m²: "area" (qtd em m²) ou "dimensoes" (L×A).
 * Nunca os dois editáveis em simultâneo.
 */
export function modoAreaMedida(med, unidade) {
  if (!isUnidadeArea(unidade)) return "area";
  if (med?.modo_m2 === "area" || med?.modo_m2 === "dimensoes") return med.modo_m2;
  const comp = Number(med?.comprimento_mm) || 0;
  const larg = Number(med?.largura_mm) || 0;
  return comp > 0 && larg > 0 ? "dimensoes" : "area";
}

/** @deprecated use modoAreaMedida — mantido para compat */
export function modoAreaLinha(m) {
  const med = (m?.medidas && m.medidas[0]) || m;
  return modoAreaMedida(med, m?.unidade);
}

export function emptyMedida(unidade = "un") {
  return {
    id: newMedidaId(),
    quantidade: isUnidadeArea(unidade) ? 1 : "",
    comprimento_mm: "",
    largura_mm: "",
    // Em m²: por omissão pede dimensões (L×A) — o custo usa a área × €/m²
    modo_m2: isUnidadeArea(unidade) ? "dimensoes" : "area",
  };
}

/** Quantidade efectiva de uma medida na unidade do material. */
export function medidaQtdEfetiva(med, unidade) {
  const qtd = Number(med?.quantidade) || 0;
  if (!isUnidadeArea(unidade)) return qtd;
  if (modoAreaMedida(med, unidade) !== "dimensoes") return qtd;
  const comp = Number(med?.comprimento_mm) || 0;
  const larg = Number(med?.largura_mm) || 0;
  if (comp > 0 && larg > 0) {
    return (comp / 1000) * (larg / 1000) * (qtd > 0 ? qtd : 1);
  }
  return 0;
}

export function medidaCusto(med, unidade, custoUnitario) {
  const custo = Number(custoUnitario) || 0;
  return Math.round(medidaQtdEfetiva(med, unidade) * custo * 100) / 100;
}

/** Lista de medidas de uma linha (legado flat → 1 medida). */
export function medidasDaLinha(m) {
  if (Array.isArray(m?.medidas) && m.medidas.length > 0) {
    return m.medidas.map((med) => ({
      id: med.id || newMedidaId(),
      quantidade: med.quantidade ?? "",
      comprimento_mm: med.comprimento_mm ?? "",
      largura_mm: med.largura_mm ?? "",
      modo_m2: modoAreaMedida(med, m.unidade),
    }));
  }
  const hasFlat =
    Number(m?.quantidade) > 0 ||
    Number(m?.comprimento_mm) > 0 ||
    Number(m?.largura_mm) > 0 ||
    m?.quantidade === "" ||
    m?.quantidade === 0;
  if (!m?.material_id && !hasFlat) return [emptyMedida(m?.unidade)];
  return [
    {
      id: newMedidaId(),
      quantidade: m?.quantidade ?? "",
      comprimento_mm: m?.comprimento_mm ?? "",
      largura_mm: m?.largura_mm ?? "",
      modo_m2: modoAreaMedida(m, m?.unidade),
    },
  ];
}

/** Quantidade efectiva total da linha (soma das medidas). */
export function materialQtdEfetiva(m) {
  return medidasDaLinha(m).reduce((s, med) => s + medidaQtdEfetiva(med, m?.unidade), 0);
}

/** Custo total da linha na receita (soma das medidas). */
export function materialLinhaCusto(m) {
  const custo = Number(m?.custo_unitario) || 0;
  return Math.round(
    medidasDaLinha(m).reduce((s, med) => s + medidaQtdEfetiva(med, m?.unidade) * custo, 0) * 100,
  ) / 100;
}

export function labelQuantidade(unidade, { pecas = false } = {}) {
  const u = (unidade || "un").trim() || "un";
  if (pecas && isUnidadeArea(u)) return "Nº de peças";
  return `Quantidade (${u})`;
}

export function emptyMaterialLinha() {
  return {
    material_id: "",
    material_nome: "",
    unidade: "un",
    custo_unitario: 0,
    quantidade: "",
    comprimento_mm: "",
    largura_mm: "",
    medidas: [emptyMedida("un")],
  };
}

/** Ao escolher o componente, herda unidade e custo (€/m² da placa se aplicável). */
export function patchFromComponente(componente, prev = null) {
  if (!componente) {
    return {
      material_id: "",
      material_nome: "",
      unidade: "un",
      custo_unitario: 0,
      quantidade: "",
      comprimento_mm: "",
      largura_mm: "",
      medidas: [emptyMedida("un")],
    };
  }
  const un = componente.unidade || "un";
  const custoU = custoUnitarioArtigo(componente);
  const medidas = prev?.medidas?.length
    ? prev.medidas.map((med) => ({
        ...med,
        modo_m2: isUnidadeArea(un) ? (med.modo_m2 || "dimensoes") : "area",
        ...(isUnidadeArea(un) ? {} : { comprimento_mm: "", largura_mm: "" }),
      }))
    : [emptyMedida(un)];
  return {
    material_id: componente.id,
    material_nome: componente.nome || "",
    unidade: un,
    custo_unitario: custoU,
    quantidade: "",
    comprimento_mm: "",
    largura_mm: "",
    medidas,
  };
}

/**
 * Normaliza a receita: agrupa o mesmo material_id numa só linha com várias medidas.
 * Linhas legadas (flat) viram medidas.
 */
export function normalizeMateriaisReceita(list) {
  const out = [];
  const indexByMat = new Map();
  for (const raw of list || []) {
    if (!raw?.material_id) {
      out.push({
        ...emptyMaterialLinha(),
        ...raw,
        medidas: medidasDaLinha(raw),
      });
      continue;
    }
    const medidas = medidasDaLinha(raw);
    const existingIdx = indexByMat.get(raw.material_id);
    if (existingIdx != null) {
      out[existingIdx] = {
        ...out[existingIdx],
        material_nome: raw.material_nome || out[existingIdx].material_nome,
        unidade: raw.unidade || out[existingIdx].unidade,
        custo_unitario: Number(raw.custo_unitario ?? out[existingIdx].custo_unitario) || 0,
        medidas: [...out[existingIdx].medidas, ...medidas],
      };
      continue;
    }
    indexByMat.set(raw.material_id, out.length);
    out.push({
      id: raw.id,
      material_id: raw.material_id,
      material_nome: raw.material_nome || "",
      unidade: raw.unidade || "un",
      custo_unitario: Number(raw.custo_unitario) || 0,
      quantidade: "",
      comprimento_mm: "",
      largura_mm: "",
      medidas,
    });
  }
  return out;
}

/** Serializa medida para API (área XOR dimensões). */
export function serializeMedida(med, unidade) {
  const porDim =
    isUnidadeArea(unidade) &&
    (med.modo_m2 === "dimensoes" ||
      ((Number(med.comprimento_mm) > 0 || Number(med.largura_mm) > 0) && med.modo_m2 !== "area"));
  return {
    ...(med.id ? { id: med.id } : {}),
    quantidade: Number(med.quantidade) || 0,
    comprimento_mm: porDim ? Number(med.comprimento_mm) || 0 : 0,
    largura_mm: porDim ? Number(med.largura_mm) || 0 : 0,
  };
}

/** Serializa linha de material para API. */
export function serializeMaterialLinha(m) {
  const medidas = (m.medidas?.length ? m.medidas : medidasDaLinha(m))
    .map((med) => serializeMedida(med, m.unidade))
    .filter((med) => med.quantidade > 0 || med.comprimento_mm > 0 || med.largura_mm > 0);
  // Se ficou vazio mas há material seleccionado, guarda 1 medida a zeros (rascunho)
  const finalMedidas = medidas.length > 0 ? medidas : [{ quantidade: 0, comprimento_mm: 0, largura_mm: 0 }];
  const first = finalMedidas[0];
  return {
    ...(m.id ? { id: m.id } : {}),
    material_id: m.material_id,
    material_nome: m.material_nome || "",
    unidade: m.unidade || "un",
    custo_unitario: Number(m.custo_unitario) || 0,
    // Agregado legado (1ª medida / total qtd) para leitores antigos
    quantidade: finalMedidas.length === 1 ? first.quantidade : materialQtdEfetiva({ ...m, medidas: finalMedidas }),
    comprimento_mm: finalMedidas.length === 1 ? first.comprimento_mm : 0,
    largura_mm: finalMedidas.length === 1 ? first.largura_mm : 0,
    medidas: finalMedidas,
  };
}

export function setModoMedida(med, modo) {
  if (modo === "dimensoes") {
    return {
      ...med,
      modo_m2: "dimensoes",
      quantidade: med.quantidade && Number(med.quantidade) > 0 && !Number(med.comprimento_mm) ? 1 : (med.quantidade || 1),
      comprimento_mm: med.comprimento_mm || "",
      largura_mm: med.largura_mm || "",
    };
  }
  const comp = Number(med.comprimento_mm) || 0;
  const larg = Number(med.largura_mm) || 0;
  let areaCalc = med.quantidade || "";
  if (comp > 0 && larg > 0) {
    const pecas = Number(med.quantidade) > 0 ? Number(med.quantidade) : 1;
    areaCalc = Math.round((comp / 1000) * (larg / 1000) * pecas * 10000) / 10000;
  }
  return {
    ...med,
    modo_m2: "area",
    quantidade: areaCalc,
    comprimento_mm: "",
    largura_mm: "",
  };
}
