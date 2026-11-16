/**
 * Aparência editável (Definições → Aparência).
 * As cores são aplicadas como variáveis CSS em :root e usadas pelo Tailwind
 * (bg-brand, text-brand-fg, bg-sidebar, …) — ver tailwind.config.js.
 */
export const TEMA_DEFAULT = {
  cor_principal: "#111827",
  cor_destaque: "#2563eb",
  cor_menu: "#ffffff",
  cor_fundo: "#f8f9fa",
  cantos: "retos",
  usar_logo_empresa: false,
};

const RAIO = { retos: "0.25rem", suaves: "0.5rem", arredondados: "0.875rem" };

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(rgb, alvo, t) {
  return rgb.map((c, i) => Math.round(c + (alvo[i] - c) * t));
}

function luminancia([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** true se a cor é escura (texto por cima deve ser branco). */
export function corEscura(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? luminancia(rgb) < 0.4 : true;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const triplet = (rgb) => rgb.join(" ");

export function normalizarTema(t) {
  const out = { ...TEMA_DEFAULT };
  Object.keys(out).forEach((k) => {
    if (t && t[k] !== undefined && t[k] !== null && t[k] !== "") out[k] = t[k];
  });
  ["cor_principal", "cor_destaque", "cor_menu", "cor_fundo"].forEach((k) => {
    if (!hexToRgb(out[k])) out[k] = TEMA_DEFAULT[k];
  });
  if (!RAIO[out.cantos]) out.cantos = "retos";
  return out;
}

/** Aplica o tema às variáveis CSS do documento. */
export function aplicarTema(tema) {
  const t = normalizarTema(tema);
  const root = document.documentElement;
  const principal = hexToRgb(t.cor_principal);
  const destaque = hexToRgb(t.cor_destaque);
  const menu = hexToRgb(t.cor_menu);
  const fundo = hexToRgb(t.cor_fundo);
  const escuraP = luminancia(principal) < 0.4;
  const escuraM = luminancia(menu) < 0.4;
  const branco = [255, 255, 255];
  const preto = [17, 24, 39];

  const vars = {
    "--brand": triplet(principal),
    "--brand-hover": triplet(escuraP ? mix(principal, branco, 0.15) : mix(principal, [0, 0, 0], 0.12)),
    "--brand-fg": triplet(escuraP ? branco : preto),
    "--brand-soft": triplet(mix(principal, branco, 0.9)),
    "--accent-c": triplet(destaque),
    "--sidebar-bg": triplet(menu),
    "--sidebar-fg": triplet(escuraM ? [229, 231, 235] : [75, 85, 99]),
    "--sidebar-fg-strong": triplet(escuraM ? branco : preto),
    "--sidebar-muted": triplet(escuraM ? [156, 163, 175] : [156, 163, 175]),
    "--sidebar-hover": triplet(escuraM ? mix(menu, branco, 0.1) : mix(menu, [0, 0, 0], 0.05)),
    "--sidebar-border": triplet(escuraM ? mix(menu, branco, 0.12) : [229, 231, 235]),
    "--app-bg": triplet(fundo),
    "--radius": RAIO[t.cantos],
    // componentes shadcn (Dialog, Select, …) usam --primary em HSL
    "--primary": rgbToHsl(principal),
    "--primary-foreground": escuraP ? "0 0% 100%" : "222 47% 11%",
    "--ring": rgbToHsl(principal),
  };
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  return t;
}
