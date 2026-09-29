/**
 * Regras de cálculo/UI de linhas de orçamento por tipo de artigo.
 * Espelha a lógica da ficha de artigo (artigoTipos + backend models).
 */

import { isMateriaPrima, isProduzido, normalizarTipo } from "@/features/artigos/artigoTipos";
import { isDiversosArtigo } from "@/components/LinhaTipoIcon";
import { expandMateriaPrimaParaLinhaOrc, semMateriaisDaLinha } from "@/features/orcamentos/orcamentoMateriais";
import { custoUnitarioArtigo } from "@/features/artigos/artigoCustoPlaca";

export const MODO_LINHA = {
  DIVERSOS: "diversos",
  MATERIA_PRIMA: "materia_prima",
  SERVICO: "servico",
  COMPRA: "compra",
  PRODUCAO: "producao",
};

/** Modo de cálculo efectivo da linha (persiste em `modo_calculo`). */
export function modoCalculoLinha(l, artigo) {
  if (l?.modo_calculo && Object.values(MODO_LINHA).includes(l.modo_calculo)) {
    return l.modo_calculo;
  }
  if (!artigo && !l?.artigo_id) return MODO_LINHA.COMPRA;
  if (l?.descricao_livre || l?.tipo_linha === "descritor" || isDiversosArtigo(artigo)) {
    return MODO_LINHA.DIVERSOS;
  }
  if (l?.eh_materia_prima || isMateriaPrima(artigo)) {
    return MODO_LINHA.MATERIA_PRIMA;
  }
  const tipo = normalizarTipo(artigo);
  if (tipo === "servico") return MODO_LINHA.SERVICO;
  if (tipo === "ativo" && isProduzido(artigo)) return MODO_LINHA.PRODUCAO;
  return MODO_LINHA.COMPRA;
}

export function tipoLinhaFromArtigo(artigo) {
  if (isDiversosArtigo(artigo)) return "descritor";
  if (normalizarTipo(artigo) === "servico") return "servico";
  return "produto";
}

export function regrasModo(modo) {
  switch (modo) {
    case MODO_LINHA.DIVERSOS:
      return {
        expandReceita: false,
        expandMateriaPrima: false,
        roteiroFromArtigo: false,
        precoManual: true,
        margemZero: true,
        precoOrigem: "manual",
        forcarCalculado: false,
        showFullBreakdown: false,
        showConsumoBreakdown: false,
        showSimpleCusto: false,
        showOps: false,
        showMateriaisTab: false,
        showMedidas: false,
        allowAddMaterial: false,
        usaReceitaMateriais: false,
        usaOperacoes: false,
        compraZero: false,
      };
    case MODO_LINHA.MATERIA_PRIMA:
      return {
        expandReceita: false,
        expandMateriaPrima: true,
        roteiroFromArtigo: false,
        precoManual: false,
        margemZero: false,
        precoOrigem: "catalogo",
        forcarCalculado: true,
        showFullBreakdown: false,
        showConsumoBreakdown: true,
        showSimpleCusto: false,
        showOps: false,
        showMateriaisTab: true,
        showMedidas: true,
        allowAddMaterial: false,
        usaReceitaMateriais: true,
        usaOperacoes: false,
        compraZero: true,
      };
    case MODO_LINHA.SERVICO:
      return {
        expandReceita: false,
        expandMateriaPrima: false,
        roteiroFromArtigo: false,
        precoManual: false,
        margemZero: false,
        precoOrigem: "catalogo",
        forcarCalculado: false,
        showFullBreakdown: false,
        showConsumoBreakdown: false,
        showSimpleCusto: true,
        showOps: false,
        showMateriaisTab: false,
        showMedidas: false,
        allowAddMaterial: false,
        usaReceitaMateriais: false,
        usaOperacoes: false,
        compraZero: false,
        custoLabel: "Custo serviço",
      };
    case MODO_LINHA.PRODUCAO:
      return {
        expandReceita: true,
        expandMateriaPrima: false,
        roteiroFromArtigo: true,
        precoManual: false,
        margemZero: false,
        precoOrigem: "catalogo",
        forcarCalculado: false,
        showFullBreakdown: true,
        showConsumoBreakdown: false,
        showSimpleCusto: false,
        showOps: true,
        showMateriaisTab: true,
        showMedidas: true,
        allowAddMaterial: true,
        usaReceitaMateriais: true,
        usaOperacoes: true,
        compraZero: false,
      };
    case MODO_LINHA.COMPRA:
    default:
      return {
        expandReceita: false,
        expandMateriaPrima: false,
        roteiroFromArtigo: false,
        precoManual: false,
        margemZero: false,
        precoOrigem: "catalogo",
        forcarCalculado: false,
        showFullBreakdown: false,
        showConsumoBreakdown: false,
        showSimpleCusto: true,
        showOps: false,
        showMateriaisTab: false,
        showMedidas: false,
        allowAddMaterial: false,
        usaReceitaMateriais: false,
        usaOperacoes: false,
        compraZero: false,
        custoLabel: "Compra",
      };
  }
}

export function flagsLinhaFromModo(modo) {
  return {
    modo_calculo: modo,
    eh_materia_prima: modo === MODO_LINHA.MATERIA_PRIMA,
    eh_servico: modo === MODO_LINHA.SERVICO,
    eh_producao: modo === MODO_LINHA.PRODUCAO,
  };
}

/** Custos iniciais ao seleccionar artigo, conforme modo. */
export function custosIniciaisFromArtigo(a, modo) {
  const custoArt = custoUnitarioArtigo(a);
  const custoMats = Number(a?.custo_materiais) || 0;
  const custoOps = Number(a?.custo_maquinas || 0) + Number(a?.custo_mao_obra || 0);

  if (modo === MODO_LINHA.MATERIA_PRIMA) {
    return {
      custo_compra_unit: 0,
      custo_materiais_unit: 0,
      custo_operacoes_unit: 0,
      custo_base_unit: 0,
      custo_producao_unit: custoArt,
    };
  }
  if (modo === MODO_LINHA.SERVICO || modo === MODO_LINHA.COMPRA) {
    return {
      custo_compra_unit: custoArt,
      custo_materiais_unit: 0,
      custo_operacoes_unit: 0,
      custo_base_unit: custoArt,
      custo_producao_unit: custoArt,
    };
  }
  if (modo === MODO_LINHA.PRODUCAO) {
    const base = Math.round((custoArt + custoMats) * 100) / 100;
    const total = Number(a?.custo_producao_total) || (custoArt + custoMats + custoOps);
    return {
      custo_compra_unit: custoArt,
      custo_materiais_unit: custoMats,
      custo_operacoes_unit: custoOps,
      custo_base_unit: base,
      custo_producao_unit: total,
    };
  }
  return {
    custo_compra_unit: 0,
    custo_materiais_unit: 0,
    custo_operacoes_unit: 0,
    custo_base_unit: 0,
    custo_producao_unit: 0,
  };
}

export function precoVendaInicialFromArtigo(a, modo, margemArt) {
  if (modo === MODO_LINHA.DIVERSOS) return 0;
  let preco = Number(a?.preco_venda);
  if (!Number.isFinite(preco) || preco <= 0) {
    const custoProd = Number(a?.custo_producao_total);
    if (Number.isFinite(custoProd) && custoProd > 0) {
      preco = Math.round(custoProd * (1 + Number(margemArt) / 100) * 100) / 100;
    } else {
      const custos = custosIniciaisFromArtigo(a, modo);
      const base = modo === MODO_LINHA.MATERIA_PRIMA
        ? custoUnitarioArtigo(a)
        : custos.custo_producao_unit;
      preco = Math.round(base * (1 + Number(margemArt) / 100) * 100) / 100;
    }
  }
  return preco;
}

/** Sincroniza flags/modo em linhas existentes ao carregar orçamento. */
export function migrarLinhasOrc(orc, artigos = []) {
  if (!orc?.linhas?.length) return orc;
  let materiais = [...(orc.materiais || [])];
  let linhas = [...orc.linhas];
  let changed = false;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const a = artigos.find((x) => x.id === l.artigo_id);
    if (!a) continue;

    const modo = modoCalculoLinha(l, a);
    const flags = flagsLinhaFromModo(modo);
    const tipoLinha = tipoLinhaFromArtigo(a);
    const next = {
      ...l,
      ...flags,
      tipo_linha: l.descricao_livre ? "descritor" : tipoLinha,
    };
    if (
      next.modo_calculo !== l.modo_calculo
      || next.eh_materia_prima !== l.eh_materia_prima
      || next.eh_servico !== l.eh_servico
      || next.eh_producao !== l.eh_producao
    ) {
      linhas[i] = next;
      changed = true;
    }

    if (modo !== MODO_LINHA.MATERIA_PRIMA) continue;
    const linhaId = l.id;
    if (!linhaId) continue;

    const temConsumo = materiais.some(
      (m) => m.da_receita && m.linha_origem_id === linhaId && m.eh_materia_prima_linha,
    );
    if (!temConsumo) {
      materiais = [
        ...semMateriaisDaLinha(materiais, linhaId),
        ...expandMateriaPrimaParaLinhaOrc(a, { linhaId, quantidadeLinha: l.quantidade || 1 }),
      ];
      changed = true;
    }
  }

  if (!changed) return orc;
  return { ...orc, linhas, materiais };
}
