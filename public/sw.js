// Service Worker: hält die App ohne Netz verfügbar und zeigt den Pausen-Alarm als
// Benachrichtigung, auch bei gesperrtem Display.

const PAGES = "pages-v1";
const STATIC = "static-v1";
// Seiten, die im Studio ohne Empfang aufgehen sollen
const OFFLINE_PAGES = ["/", "/einheit", "/logbuch", "/plan", "/auswertung"];
// Bei schwachem Empfang nicht ewig warten, sondern die gespeicherte Seite zeigen
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precache().catch(() => undefined));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Die App meldet sich nach dem Start; dann Seiten und Dateien der aktuellen Version sichern
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "precache") event.waitUntil(precache().catch(() => undefined));
});

async function precache() {
  const pages = await caches.open(PAGES);
  const assets = new Set();
  for (const path of OFFLINE_PAGES) {
    const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    // Ohne Login landet man auf /login; das nicht als Trainingsseite speichern
    if (!res.ok || res.redirected) continue;
    const html = await res.clone().text();
    await pages.put(path, res);
    for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
  }
  const statics = await caches.open(STATIC);
  for (const url of assets) {
    if (await statics.match(url)) continue;
    const res = await fetch(url).catch(() => null);
    if (res && res.ok) await statics.put(url, res);
  }
}

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || ["/icon.svg", "/apple-icon", "/manifest.webmanifest"].includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Daten holt und speichert die App selbst; Fehler dort sind gewollt sichtbar
  if (url.pathname.startsWith("/api/")) return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(page(request, url));
  } else if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    // Ohne Netz eine Fehlerantwort statt Warten: Next lädt die Seite dann komplett neu,
    // und die kommt aus dem Speicher
    event.respondWith(fetch(request).catch(() => new Response("offline", { status: 503 })));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(STATIC)).put(request, res.clone());
  return res;
}

async function page(request, url) {
  const cache = await caches.open(PAGES);
  const network = fetch(request).then(async (res) => {
    if (res.ok && !res.redirected && OFFLINE_PAGES.includes(url.pathname)) await cache.put(url.pathname, res.clone());
    return res;
  });
  network.catch(() => undefined);
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // kein Netz
  }
  const cached = (await cache.match(url.pathname)) || (await cache.match("/"));
  if (cached) return cached;
  return network.catch(() => new Response("Offline und diese Seite ist nicht gespeichert.", { status: 503 }));
}

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Pause vorbei", body: "" };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || "rest-timer",
      renotify: true,
      requireInteraction: true,
      icon: "/apple-icon",
      badge: "/apple-icon",
      vibrate: [400, 200, 400, 200, 400],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
