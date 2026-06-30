// Bump CACHE when static assets change (Full V3 panel)
const CACHE = "sd-panel-v26";
const PRECACHE = [
  "./sd-dashboard.full.html",
  "./sd-dashboard.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./js/void-boot.js",
  "./js/void-gallery-db.js",
  "./js/void-gen-flow.js",
  "./js/void-jszip-loader.js",
  "./js/void-pwa.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (url.includes("127.0.0.1:8188") || url.includes("localhost:8188")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type !== "basic") return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      });
    })
  );
});