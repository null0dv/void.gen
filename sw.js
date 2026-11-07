// Bump CACHE when static assets change (Full V3 panel)
const CACHE = "sd-panel-desktop-v66-preview";
const PRECACHE = [
  "./js/void-image-drop.js?v=1",
  "./void-layout.css?v=5",
  "./js/void-layout.js?v=2",
  "./js/void-studio.js?v=14",
  "./js/void-motion-graph.js?v=1",
  "./js/void-rng-bridge.js?v=2",
  "./js/void-shared-gallery.js?v=10",
  "./js/void-mobile-link.js?v=1",
  "./js/void-recognition.js?v=3",
  "./js/void-engines.js?v=9",
  "./void-desktop.css?v=29.3",
  "./js/void-desktop.js?v=32.1-recognition",
  "./sd-dashboard.full.html",
  "./sd-dashboard.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./js/void-boot.js",
  "./js/void-gallery-db.js?v=34",
  "./js/void-gen-flow.js?v=29.3",
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

function isPanelHtml(url) {
  return /sd-dashboard(\.full)?\.html/i.test(url);
}

self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (/\/void-motion\.(html|css)|\/js\/void-motion(-graph|-gallery)?\.js/.test(url)) return;
  if (url.includes("127.0.0.1:8188") || url.includes("localhost:8188")) return;
  if (url.includes("127.0.0.1:8899") || url.includes("localhost:8899")) return;
  if (e.request.method !== "GET") return;

  // HTML: network-first so desktop shortcut always picks up panel updates
  if (isPanelHtml(url)) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

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
