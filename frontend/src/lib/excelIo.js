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

export async function importExcel(entity, file, dryRun = true, mode = "create") {
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
  const res = await fetch(`${API}/io/import/xlsx?${q}`, {
    method: "POST",
    headers,
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "Erro na importação");
  }
  return data;
}
