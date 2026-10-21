export function orcTemNumero(o) {
  return !!String(o?.numero || "").trim();
}

export function orcVersao(o) {
  const v = Number(o?.versao);
  if (v > 0) return v;
  return orcTemNumero(o) ? 1 : 0;
}

export function orcNumeroLabel(o) {
  const n = String(o?.numero || "").trim();
  if (!n) return "Rascunho";
  const v = orcVersao(o);
  return v > 1 ? `${n} V${v}` : n;
}

/** Estados comerciais actuais + aliases de documentos antigos. */
export function orcStatus(o) {
  const s = o?.status || "rascunho";
  if (s === "finalizado") return "criado";
  if (s === "aceite") return "ganho";
  if (s === "rejeitado") return "perdido";
  return s;
}

export function orcLinhaPronta(l) {
  if (!l) return false;
  if (l.artigo_id) return true;
  if ((l.tipo_linha === "descritor" || l.descricao_livre) && String(l.artigo_nome || "").trim()) return true;
  return !!String(l.artigo_nome || "").trim();
}

export function orcIsGanho(o) {
  const s = orcStatus(o);
  return s === "ganho";
}

/** Grelha editável só em rascunho ou após «Criar nova versão» (negociado). */
export function orcEditavel(o) {
  const s = orcStatus(o);
  return s === "rascunho" || s === "negociado";
}

/** Precisa de nova versão para alterar quantidades/linhas (já enviado/criado). */
export function orcPrecisaNovaVersao(o) {
  const s = orcStatus(o);
  return orcTemNumero(o) && (s === "criado" || s === "enviado" || s === "perdido");
}

export function ymdHoje() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ymd(v) {
  const s = String(v || "").trim().slice(0, 10);
  return s.length === 10 && s[4] === "-" ? s : "";
}

export function addDaysYmd(ymdStr, days) {
  const base = ymd(ymdStr) || ymdHoje();
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function orcExpirado(o) {
  if (o?.expirado) return true;
  const v = ymd(o?.validade);
  if (!v) return false;
  return v < ymdHoje();
}

export function orcErroDatas(o, { aoFinalizar = false } = {}) {
  const data = ymd(o?.data);
  const validade = ymd(o?.validade);
  if (data && validade && validade < data) {
    return "A validade não pode ser anterior à data do orçamento";
  }
  if (aoFinalizar) {
    const hoje = ymdHoje();
    if (!data) return "Indique a data do orçamento";
    if (data !== hoje) return "A data do orçamento tem de ser o dia de hoje";
    if (!validade) return "Indique a validade do orçamento";
  }
  return null;
}

/**
 * Semáforo de rentabilidade.
 * verde ≥ saudavel; amarelo ≥ risco; vermelho < risco.
 */
export function orcSemaforoMargem(margemPct, { saudavel = 40, risco = 20 } = {}) {
  const m = Number(margemPct) || 0;
  if (m >= saudavel) return { nivel: "verde", label: "Margem saudável", className: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" };
  if (m >= risco) return { nivel: "amarelo", label: "Margem de risco", className: "text-amber-700", bg: "bg-amber-50 border-amber-200" };
  return { nivel: "vermelho", label: "Margem crítica", className: "text-red-700", bg: "bg-red-50 border-red-200" };
}

/** Templates de notas padrão (fallback se empresa não tiver). */
export const NOTAS_TEMPLATES_DEFAULT = [
  {
    id: "cmyk",
    nome: "Variação CMYK",
    texto: "As cores em impressão CMYK podem variar até 10% relativamente à prova digital / ecrã.",
  },
  {
    id: "dtf",
    nome: "Lavagem DTF",
    texto: "Instruções de lavagem DTF: lavar do avesso, não usar máquina de secar, não passar a ferro directamente sobre a estampa.",
  },
  {
    id: "prazo",
    nome: "Prazo e materiais",
    texto: "Prazos sujeitos à confirmação de stock de materiais. Alterações à arte após aprovação podem implicar custos e prazos adicionais.",
  },
];
