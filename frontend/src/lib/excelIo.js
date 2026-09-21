/**
 * Download Excel export / templates via API (blob).
 */
import { API, getToken } from "@/infrastructure/api";

async function downloadBlob(path, { method = "GET", body, filename } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  if (!res.ok) {
    let detail = "Erro no download";
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  const name = filename || m?.[1] || "velocely.xlsx";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportExcel(entities, ids) {
  return downloadBlob("/io/export/xlsx", {
    method: "POST",
    body: { entities, ...(ids ? { ids } : {}) },
  });
}

export function downloadImportTemplate(entity) {
  return downloadBlob(`/io/import/template/${entity}`);
}

export async function importExcel(entity, file, dryRun = true, mode = "create", { signal, onProgress } = {}) {
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const q = new URLSearchParams({
    entity,
    dry_run: String(dryRun),
    mode: mode || "create",
  });

  onProgress?.(dryRun ? "A enviar e validar o Excel…" : "A gravar na base de dados…");

  let res;
  try {
    res = await fetch(`${API}/io/import/xlsx?${q}`, {
      method: "POST",
      headers,
      body: fd,
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Importação cancelada ou tempo esgotado. Tente de novo (ficheiros grandes demoram).");
    }
    // API a dormir (Render) — 1 retry
    onProgress?.("API a acordar… a tentar de novo…");
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(`${API}/io/import/xlsx?${q}`, {
      method: "POST",
      headers,
      body: fd,
      signal,
    });
  }

  onProgress?.("A processar resposta…");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const msg = typeof detail === "string"
      ? detail
      : res.status === 504 || res.status === 502
        ? "O servidor demorou demasiado (timeout). Valide de novo — a API pode estar a acordar."
        : "Erro na importação";
    throw new Error(msg);
  }
  return data;
}
