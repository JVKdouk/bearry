// Bearry app-shell service worker.
//
// `__BUILD_ID__` is replaced at deploy time with the Next.js build id, so every
// deployment ships a byte-different sw.js. The browser detects the change,
// installs the new worker, and (thanks to skipWaiting + clients.claim) takes
// control immediately — the page then auto-reloads (see ServiceWorker.tsx).
//
// Strategy:
//   • navigations  -> network-first (fresh HTML => fresh hashed chunk refs),
//                     falling back to the last good page when offline.
//   • same-origin static (/_next/static, icons) -> stale-while-revalidate
//                     (URLs are content-hashed, so cached copies are safe).
//   • cross-origin (the /api backend) -> never touched; the sync store owns it.

const BUILD = "__BUILD_ID__";
const CACHE = `bearry-shell-${BUILD}`;

/**
 * The app's own routes. Precaching them at install means the very first offline
 * visit works — including a cold, hard reload on a route the user hadn't opened
 * before losing connection. Without this, offline-first only held for pages that
 * happened to have been visited already.
 */
const APP_ROUTES = [
  "/today",
  "/lists",
  "/calendar",
  "/inbox",
  "/integrations",
  "/settings",
  "/login",
];

/** Last-resort shell when an unknown route is requested offline. */
const FALLBACK_ROUTE = "/today";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one failure (e.g. a route that 307s) can't abort the
      // whole install and leave the app with no offline shell at all.
      await Promise.all(
        ["/manifest.webmanifest", ...APP_ROUTES].map((url) =>
          cache.add(url).catch(() => {}),
        ),
      );
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Let the page tell a waiting worker to activate right away.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** Any cached app route, so an unvisited path still gets a bootable shell. */
async function firstCachedRoute(cache) {
  for (const route of APP_ROUTES) {
    const hit = await cache.match(new Request(route));
    if (hit) return hit;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache the API

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Cache per URL. The previous version stored every navigation under a
          // single key, so offline you got whichever page you happened to visit
          // last no matter which route you asked for — /calendar could render
          // the Today page's HTML.
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(new Request(url.pathname), copy))
            .catch(() => {});
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(new Request(url.pathname))) ||
            (await cache.match(new Request(FALLBACK_ROUTE))) ||
            // Every route is client-rendered from local state, so any cached
            // app shell can boot and route itself to the requested path.
            (await firstCachedRoute(cache)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Next's RSC payload requests are per-build and per-route-state; caching them
  // risks serving a payload that doesn't match the running build. Let them go to
  // the network untouched — when one fails offline, Next falls back to a full
  // navigation, which the handler above serves from the cached shell.
  if (url.searchParams.has("_rsc")) return;

  // Static assets: serve cache fast, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});

/* -------------------------------------------------------------------------- */
/* Push notifications                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A push arrives whether or not the app is open, so this handler has to stand
 * on its own — no store, no React, nothing but the payload.
 *
 * The browser will show its own generic "This site has been updated in the
 * background" notice if a push handler resolves without showing anything, so
 * every path here must end in showNotification, including the malformed-payload
 * one. A confusing notification we wrote beats a confusing one we didn't.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Bearry";
  const options = {
    body: payload.body || "You have a reminder.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Same tag replaces rather than stacks: a reminder for a task you already
    // have a notification about shouldn't produce two.
    tag: payload.tag || "bearry-reminder",
    renotify: true,
    data: { url: payload.url || "/today" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Clicking should land you on the thing, and should REUSE an open tab rather
 * than opening a second copy of the app — a reminder that leaves you with four
 * Bearry tabs is its own small punishment.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/today";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          // Navigate the existing tab, then focus it. Focusing without
          // navigating leaves you looking at whatever you were on before.
          if ("navigate" in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
