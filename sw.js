// ── 版本號 ── 每次更新 sd-dashboard.html 就把這裡改一下（v1 → v2 → v3…）
const CACHE = "sd-panel-v6";
const PRECACHE = [
  "./sd-dashboard.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
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
  // 刪除所有舊版 cache
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  // ComfyUI API 請求（127.0.0.1:8188）直接走網路，不快取
  if (url.includes("127.0.0.1") || url.includes("8188")) return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(resp => {
        if (resp.ok) {
          caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      });
    })
  );
});
