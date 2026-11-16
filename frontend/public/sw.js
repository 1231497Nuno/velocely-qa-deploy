/* Velocely — service worker simples para a app móvel funcionar com rede fraca:
   páginas e ficheiros da app: rede primeiro, cópia guardada se não houver rede;
   consultas de stock/app móvel (GET): rede primeiro, última resposta guardada como recurso.
   Os registos feitos sem rede ficam numa fila na própria app (lib/filaOffline.js). */
const CACHE = "velocely-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function guardavel(req) {
  if (req.method !== "GET") return false;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) return !u.pathname.startsWith("/sockjs") && !u.pathname.includes("hot-update");
  return /\/api\/(movel\/|stock(\?|\/|$)|localizacoes|stock\/localizacoes)/.test(u.pathname + u.search);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (!guardavel(req)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
      }
      return res;
    }).catch(async () => {
      const c = await caches.match(req, { ignoreVary: true });
      if (c) return c;
      if (req.mode === "navigate") {
        const idx = await caches.match("/m") || await caches.match("/");
        if (idx) return idx;
      }
      return new Response(JSON.stringify({ detail: "Sem rede" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }),
  );
});

// Alertas no telemóvel (Web Push)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data ? e.data.text() : "Velocely" }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "Velocely", {
    body: d.texto || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { link: d.link || "/tarefas" }, tag: d.link || undefined,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.link) || "/tarefas", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.location.origin));
    if (c) { c.focus(); return c.navigate ? c.navigate(url) : undefined; }
    return self.clients.openWindow(url);
  }));
});
