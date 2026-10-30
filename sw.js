// Service worker: deixa o app abrir offline. Altere VERSION a cada deploy para forçar atualização.
const VERSION = 'stratify-v7';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/store.js', 'js/finance.js', 'js/sync.js', 'js/charts.js', 'js/icons.js', 'js/category-icons.js', 'js/utils.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rede primeiro (pega atualizações), cache como fallback. API do GitHub nunca é cacheada.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || request.url.includes('api.github.com')) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
