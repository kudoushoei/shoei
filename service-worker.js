const CACHE_NAME = "body-tracker-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/db.js",
  "./js/store.js",
  "./js/zip.js",
  "./js/gemini.js",
  "./js/healthImport.js",
  "./js/charts.js",
  "./js/icons.js",
  "./js/views.js",
  "./js/app.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // アプリを積極的に更新中のため、まずネットワークから最新を取りに行き、
  // オフライン時のみキャッシュにフォールバックする(network-first)。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
