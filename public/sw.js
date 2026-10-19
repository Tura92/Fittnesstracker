// Service Worker: zeigt den Pausen-Alarm als Benachrichtigung, auch bei gesperrtem Display.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
