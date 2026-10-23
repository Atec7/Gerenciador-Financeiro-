/* Service worker do Fin: abre offline e instala como app.
   Arquivos do app: rede primeiro (sempre a versão mais nova), cache como reserva.
   Bibliotecas de CDN: cache primeiro (são versionadas). */
const VERSION = 'fin-v2.3.0';
const APP_FILES = [
  './', './index.html', './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/core.js', './assets/js/rates.js', './assets/js/data.js', './assets/js/ui.js', './assets/js/app.js',
  './assets/js/views/home.js', './assets/js/views/transactions.js', './assets/js/views/bills.js',
  './assets/js/views/budget.js', './assets/js/views/invest.js', './assets/js/views/goals.js', './assets/js/views/receipts.js',
  './assets/js/views/notes.js', './assets/js/views/vault.js', './assets/js/views/tools.js',
  './assets/js/views/settings.js',
  './assets/icons/icon.svg', './assets/icons/icon-192.png', './assets/icons/icon-512.png'
];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|www\.gstatic\.com\/firebasejs|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
  }
});

// clicar na notificação abre/foca o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.tag === 'bills' ? './index.html#bills' : e.notification.tag?.startsWith('note-') ? './index.html#notes' : './index.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => x.url.includes(self.registration.scope));
    if (c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
