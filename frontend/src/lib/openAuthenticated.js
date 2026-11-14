import { API, getToken } from "@/lib/api";

/**
 * Abre um PDF/ficheiro autenticado sem pôr o JWT na URL (?auth=).
 * Faz fetch com Bearer, cria blob URL e abre noutra tab.
 */
export async function openAuthenticated(url, { filename } = {}) {
  const token = getToken();
  if (!token) throw new Error("Sessão expirada");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = `Erro ${res.status} ao abrir ficheiro`;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") msg = j.detail;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const win = window.open(objectUrl, "_blank", "noopener,noreferrer");
  if (!win) {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "documento.pdf";
    a.rel = "noopener";
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return objectUrl;
}

export function pdfDocumentoUrl(docId) {
  return `${API}/financeiro/documentos/${docId}/pdf`;
}

export function reciboEncomendaUrl(eid, pid) {
  return `${API}/encomendas/${eid}/pagamentos/${pid}/recibo`;
}
