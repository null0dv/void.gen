const CACHE='void-pocket-v5';
const ASSETS=['/','/style.css','/app.js?v=4','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('void-pocket-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||event.request.method!=='GET'||!ASSETS.some(asset=>new URL(asset,location.origin).pathname===url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const key=url.pathname==='/'?'/':url.pathname+url.search;
    try{
      const response=await fetch(event.request);
      if(response.ok){await cache.put(key,response.clone());return response;}
      const saved=await cache.match(key);if(saved)return saved;
      throw new Error('Service unavailable');
    }catch{
      const saved=await cache.match(key);if(saved)return saved;
      if(event.request.mode==='navigate')return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#111;color:#eee;font:18px system-ui;padding:32px"><h1>VOID 電腦服務未連線</h1><p>請在電腦執行 Start-VOID-Full.cmd，確認 Tailscale 已連線，再重新整理。</p><button onclick="location.reload()">重新連線</button>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
      return new Response('VOID service offline',{status:503});
    }
  })());
});
