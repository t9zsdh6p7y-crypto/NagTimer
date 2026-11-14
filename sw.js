const CACHE = "nag-v1-3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/theme.css",
  "./css/app.css",
  "./fonts/press-start-2p.woff2",
  "./js/app.js",
  "./js/util.js",
  "./js/timer.js",
  "./js/plan.js",
  "./js/setup-flow.js",
  "./js/checkin.js",
  "./js/nags.js",
  "./js/identity.js",
  "./js/history.js",
  "./js/nudge-sources.js",
  "./js/storage.js",
  "./js/audio.js",
  "./js/coach/interface.js",
  "./js/coach/engine.js",
  "./js/coach/dialogue.js",
  "./js/coach/persona.js",
  "./js/coach/speech.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match("./index.html"));
      return cached || fresh;
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: "notification-click", action });
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "show-notification") {
    event.waitUntil(
      self.registration.showNotification(data.title || "Nag", {
        body: data.body || "",
        tag: data.tag || "nag",
        renotify: true,
        requireInteraction: !!data.requireInteraction,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        vibrate: data.vibrate || undefined,
        data: { key: data.key },
      })
    );
  }
});
