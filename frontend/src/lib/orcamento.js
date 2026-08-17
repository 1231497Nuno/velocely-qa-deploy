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

export function orcEditavel(o) {
  const s = orcStatus(o);
  return s === "rascunho" || s === "negociado";
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
  }
  return null;
}

