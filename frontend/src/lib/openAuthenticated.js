import { API, getToken } from "@/lib/api";

/**
 * Abre um PDF/ficheiro autenticado sem pôr o JWT na URL (?auth=).
 * Faz fetch com Bearer, cria blob URL e mostra-o no visualizador da app (PDF/imagem) ou descarrega-o.
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
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const nome = filename || (m ? decodeURIComponent(m[1]) : "") || "documento.pdf";
  const tipo = blob.type || res.headers.get("content-type") || "";
  const objectUrl = URL.createObjectURL(blob);
  // Pré-visualização dentro da app (não depende de pop-ups, que o browser bloqueia depois de um pedido assíncrono)
  const previsualizavel = /pdf|^image\/|^text\//i.test(tipo) || /\.(pdf|png|jpe?g|gif|webp|txt)$/i.test(nome);
  if (previsualizavel && typeof window.__velocelyVerFicheiro === "function") {
    window.__velocelyVerFicheiro({ url: objectUrl, nome, tipo });
    return objectUrl;
  }
  descarregarUrl(objectUrl, nome);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return objectUrl;
}

/** Descarrega um URL (blob) com o nome indicado. */
export function descarregarUrl(url, nome) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome || "documento.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function pdfDocumentoUrl(docId) {
  return `${API}/financeiro/documentos/${docId}/pdf`;
}

export function reciboEncomendaUrl(eid, pid) {
  return `${API}/encomendas/${eid}/pagamentos/${pid}/recibo`;
}
