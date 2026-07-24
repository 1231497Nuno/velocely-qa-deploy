/** Formatadores de domínio (valores de negócio para UI). */

let CURRENCY = "€";
export const setCurrency = (s) => {
  if (s) CURRENCY = s;
};

export const eur = (v) =>
  `${new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v || 0))} ${CURRENCY}`;

export const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pt-PT");
  } catch {
    return d;
  }
};
