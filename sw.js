// オフライン対応: アプリ本体をキャッシュし、裏で更新を確認する（stale-while-revalidate）
// アプリを更新したら VERSION を上げる
const VERSION = 'yotei-v1';
const FILES = [
  './', './index.html', './style.css', './manifest.json',
  './js/app.js', './js/util.js', './js/db.js', './js/occur.js', './js/ics.js', './js/data.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  const isApp = req.mode === 'navigate' && (url.pathname === scopePath || url.pathname === scopePath + 'index.html');
  if (req.mode === 'navigate' && !isApp) return; // アプリ以外のページは素通し
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const key = isApp ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: isApp });
    const fresh = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
