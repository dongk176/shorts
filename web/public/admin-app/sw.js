/* Scope is deliberately limited to /admin-app/. Never cache admin API data. */
const CACHE = "easycut-admin-offline-v1";
const OFFLINE = "/admin-app/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("easycut-admin-offline-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/admin-app/") || event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
  } else if (["script", "style"].includes(event.request.destination)) {
    event.respondWith(fetch(event.request, { cache: "no-cache" }));
  }
});
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use a non-sensitive fallback. */ }
  const eventId = typeof payload.eventId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(payload.eventId) ? payload.eventId : "";
  const title = typeof payload.title === "string" ? payload.title.slice(0,100) : "EasyCut";
  const body = typeof payload.body === "string" ? payload.body.slice(0,180) : "새로운 운영 알림이 있어요.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/admin-app/icon-192.png",
    badge: "/admin-app/icon-192.png",
    tag: eventId || "easycut-admin",
    data: { url: "/admin-app/index.html#inbox", eventId },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = windows.find((client) => new URL(client.url).pathname.startsWith("/admin-app/"));
    if (target) {
      await target.navigate("/admin-app/index.html#inbox");
      return target.focus();
    }
    return self.clients.openWindow("/admin-app/index.html#inbox");
  })());
});
