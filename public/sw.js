// Lets the app open with no connection. Only this site's own files are cached;
// requests to Microsoft (sign-in, Graph) are never touched. Notes themselves
// live in IndexedDB (src/store.ts), not here.
const CACHE = "notes-app-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/index.html"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // The page: newest when online, the saved copy when offline. Only a good
    // response for the app itself is saved, so an error page can't replace it.
    const isApp = url.pathname === "/" || url.pathname === "/index.html";
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && isApp) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Scripts, styles, icons: file names change with every build, so a saved copy is always right.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
