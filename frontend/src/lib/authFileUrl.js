import { useEffect, useState } from "react";
import { API, getToken } from "@/lib/api";

/** URL da API sem JWT na query (usar com Bearer / blob). */
export function fileApiUrl(path) {
  if (!path) return null;
  return `${API}/files/${path}`;
}

const blobCache = new Map(); // path -> objectUrl

/**
 * Resolve um path de storage para blob: URL com Authorization Bearer.
 * Cacheia por path para thumbs repetidos.
 */
export async function resolveAuthFileUrl(path) {
  if (!path) return null;
  if (blobCache.has(path)) return blobCache.get(path);
  const token = getToken();
  if (!token) throw new Error("Sessão expirada");
  const res = await fetch(fileApiUrl(path), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Erro ${res.status} ao carregar ficheiro`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  blobCache.set(path, url);
  return url;
}

/** Hook: src autenticado para <img> sem ?auth= na URL. */
export function useAuthFileUrl(path) {
  const [src, setSrc] = useState(() => (path && blobCache.get(path)) || null);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setSrc(null);
      return undefined;
    }
    if (blobCache.has(path)) {
      setSrc(blobCache.get(path));
      return undefined;
    }
    setSrc(null);
    resolveAuthFileUrl(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return src;
}
