// Lets the app open with no connection. Only this site's own files are cached;
// requests to Microsoft (sign-in, Graph) are never touched. Notes themselves
// live in IndexedDB (src/store.ts), not here.
const CACHE = "notes-app-shell-v3";

// ---------- Share into Notes (manifest "share_target") ----------
// Android's share sheet POSTs here. The share is kept in its own database
// (src/share.ts reads it) and the app opens with ?action=share&id=…; the app
// then shows it in the editor, so nothing is saved without the user seeing it.
const SHARE_DB = "notes-share";
const SHARE_STORE = "shares";

function saveShare(id, payload) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SHARE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(SHARE_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(SHARE_STORE, "readwrite");
      tx.objectStore(SHARE_STORE).put(payload, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const text = (key) => (typeof form.get(key) === "string" ? form.get(key).slice(0, 10000) : "");
    const files = form
      .getAll("files")
      .filter((f) => typeof f !== "string")
      .slice(0, 20)
      .map((f) => ({ name: f.name, type: f.type, blob: f }));
    const id = crypto.randomUUID();
    await saveShare(id, { title: text("title"), text: text("text"), url: text("url"), files, at: Date.now() });
    return Response.redirect(`/?action=share&id=${id}`, 303);
  } catch {
    return Response.redirect("/?action=share&id=failed", 303);
  }
}

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
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share") {
    event.respondWith(receiveShare(request));
    return;
  }
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
