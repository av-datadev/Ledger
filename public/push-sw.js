/* Push handling, pulled into the generated service worker via Workbox's
 * importScripts (see vite.config.ts).
 *
 * Kept as a separate script rather than switching the PWA to injectManifest:
 * the generated worker's precache and update behaviour was tuned specifically
 * so installed phones actually pick up new builds, and that is not worth
 * rewriting to add a push listener.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Brick Book";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Same tag replaces an earlier notification about the same thing rather
    // than stacking five of them for one conversation.
    tag: data.tag || "brick-book",
    renotify: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Prefer surfacing the app the person already has open — opening a
        // second copy of an installed PWA is disorienting.
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
      }),
  );
});
