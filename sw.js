// Guarda la app en el teléfono para que abra sin señal.
const VERSION = "suinda-v6";
const PROPIOS = ["./", "./index.html", "./app.js", "./config.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll([...PROPIOS, SUPABASE_JS])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;          // datos: siempre directo

  if (url.origin === location.origin) {
    // Archivos de la app: intenta la red (para recibir actualizaciones) y, si no hay señal en 4 s, usa lo guardado
    e.respondWith(redPrimero(req));
  } else {
    // Librerías y tipografías: lo guardado primero
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
      return res;
    })));
  }
});

async function redPrimero(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(req, { cache: "no-cache" }),   // siempre pregunta si hay una versión nueva
      new Promise((_, no) => setTimeout(() => no(new Error("lento")), 4000))
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (req.mode === "navigate" ? cache.match("./index.html") : Response.error());
  }
}

// Avisos al celular (se activan en la próxima etapa)
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: "Suindá", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Suindá", {
    body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./#dias" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data.url || "./"));
});
