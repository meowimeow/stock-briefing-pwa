// 화면 틀만 저장해 두는 최소한의 서비스 워커. 데이터(/api)는 절대 저장하지 않는다.
const V = "np-v26";
const SHELL = ["/", "/js/main.js", "/js/core.js", "/js/ui.js", "/js/today.js", "/js/stocks.js", "/js/world.js", "/js/explore.js", "/js/company.js", "/js/upcoming.js", "/js/search.js", "/js/verify.js", "/js/lights.js", "/js/score.js", "/js/chart.js", "/js/live.js", "/js/stories.js", "/vendor/lightweight-charts.js", "/style.css", "/manifest.webmanifest", "/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  // 네트워크 우선: 업데이트가 바로 보이고, 오프라인이면 저장해 둔 틀을 쓴다.
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
