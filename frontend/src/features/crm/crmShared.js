import { MessageSquare, Phone, Mail, MessageCircle, Users, MapPin, Bot } from "lucide-react";

export const TIPOS_INTERACAO = [
  { key: "nota", label: "Nota", icon: MessageSquare },
  { key: "chamada", label: "Chamada", icon: Phone },
  { key: "email", label: "Email", icon: Mail },
  { key: "mensagem", label: "Mensagem", icon: MessageCircle },
  { key: "reuniao", label: "Reunião", icon: Users },
  { key: "visita", label: "Visita", icon: MapPin },
];

export const INTERACAO_SISTEMA = { key: "sistema", label: "Automático", icon: Bot };

export function tipoInteracao(key) {
  return TIPOS_INTERACAO.find((t) => t.key === key) || INTERACAO_SISTEMA;
}

export const TIPOS_ESTADO = [
  { key: "aberto", label: "Em aberto" },
  { key: "ganho", label: "Ganho" },
  { key: "perdido", label: "Perdido" },
];

export const CORES_FALLBACK = [
  "#64748b", "#2563eb", "#0891b2", "#7c3aed", "#d97706", "#ea580c", "#16a34a", "#dc2626", "#0f172a",
];

export const btnPrimary =
  "bg-brand text-brand-fg hover:bg-brand-hover rounded-sm px-4 py-2 text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-50";
export const btnSecondary =
  "border border-gray-300 bg-white hover:bg-gray-50 rounded-sm px-3 py-2 text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-50";
export const inputCls =
  "w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black";
export const labelCls = "block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1";

export function apiError(e, fallback = "Ocorreu um erro") {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => (x.msg || "").replace("Value error, ", "")).join("; ") || fallback;
  return typeof d === "string" ? d : fallback;
}

export function tituloLead(lead) {
  return lead?.empresa || lead?.nome || "Lead";
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** "2026-11-16T10:30" (input datetime-local) ⇄ ISO */
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function acaoAtrasada(lead) {
  if (!lead?.proxima_acao_at || lead?.estado_tipo !== "aberto") return false;
  return new Date(lead.proxima_acao_at).getTime() < Date.now();
}

export function linkWhatsApp(tel) {
  let n = String(tel || "").replace(/\D/g, "");
  if (!n) return null;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 9) n = `351${n}`;
  return `https://wa.me/${n}`;
}

export function iniciais(nome) {
  return String(nome || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

const VIEW_KEY = "velocely_crm_view";
export function lerVista() {
  try {
    return localStorage.getItem(VIEW_KEY) === "lista" ? "lista" : "quadro";
  } catch {
    return "quadro";
  }
}
export function gravarVista(v) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* sem storage disponível */
  }
}
