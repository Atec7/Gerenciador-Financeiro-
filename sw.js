/* Service worker do Fin: abre offline e instala como app.
   Arquivos do app: rede primeiro (sempre a versão mais nova), cache como reserva.
   Bibliotecas de CDN: cache primeiro (são versionadas). */
const VERSION = 'fin-v2.6.0';
const APP_FILES = [
  './', './index.html', './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/core.js', './assets/js/rates.js', './assets/js/market.js', './assets/js/data.js', './assets/js/ui.js', './assets/js/app.js',
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
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'fin-alerts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
  const tag = e.notification.tag || '';
  const target = tag === 'bills' ? './index.html#bills' : tag.startsWith('note-') ? './index.html#notes' : tag.startsWith('inv') ? './index.html#invest' : './index.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => x.url.includes(self.registration.scope));
    if (c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});

/* ── Alertas de ações em segundo plano (Android, app instalado).
   O sistema decide a frequência (Periodic Background Sync). A configuração vem do app (cache "fin-alerts"). */
self.addEventListener('periodicsync', e => { if (e.tag === 'fin-alerts') e.waitUntil(bgAlerts()); });
async function bgAlerts() {
  const c = await caches.open('fin-alerts'), r = await c.match('cfg');
  if (!r) return;
  const cfg = await r.json();
  if (!cfg.enabled || !cfg.items?.length) return;
  const now = new Date(), h = now.getHours() + now.getMinutes() / 60, dw = now.getDay();
  if (dw === 0 || dw === 6 || h < 10 || h > 18.6) return;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // cotações gravadas pelo job do GitHub (brapi v2) no Firebase — o app não usa chave da brapi
  if (!cfg.db) return;
  const res = await fetch(`${cfg.db.replace(/\/$/, '')}/mercado/cotacoes.json`).catch(() => null);
  if (!res?.ok) return;
  const cot = (await res.json().catch(() => null)) || {};
  const data = { results: Object.entries(cot).map(([t, q]) => ({ symbol: t, regularMarketPrice: q?.price, regularMarketChangePercent: q?.chg })) };
  const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const pct = v => Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const move = cfg.move || 3, done = cfg.done || {}, shows = [];
  const once = k => { if (done[k]) return false; done[k] = Date.now(); return true; };
  for (const q of data.results || []) {
    const it = cfg.items.find(i => i.t === q.symbol); if (!it || q.regularMarketPrice == null) continue;
    const price = +q.regularMarketPrice, chg = +(q.regularMarketChangePercent || 0), up = chg >= 0, lvl = Math.floor(Math.abs(chg) / move);
    if (lvl >= 1 && once(`mv|${it.t}|${day}|${up ? '+' : '-'}${lvl}`)) {
      const val = it.qtd * price, dia = val * (chg / (100 + chg));
      shows.push([`${up ? '📈' : '📉'} ${it.t} ${up ? 'subiu' : 'caiu'} ${pct(chg)}% hoje`,
        it.qtd ? `Suas cotas valem ${brl(val)} (${dia >= 0 ? '+' : '−'}${brl(Math.abs(dia))} hoje).` : `Cotação agora: ${brl(price)}.`, `inv-${it.t}`]);
    }
    if (it.compra && price <= it.compra && once(`buy|${it.t}|${day}`)) shows.push([`🎯 ${it.t} chegou no seu preço de compra`, `Está em ${brl(price)} (seu alvo: ${brl(it.compra)}).`, `inv-${it.t}-alvo`]);
    if (it.venda && price >= it.venda && once(`sell|${it.t}|${day}`)) shows.push([`🏁 ${it.t} atingiu seu preço de venda`, `Está em ${brl(price)} (seu alvo: ${brl(it.venda)}).`, `inv-${it.t}-alvo`]);
  }
  cfg.done = done;
  await c.put('cfg', new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } }));
  await Promise.all(shows.map(([title, body, tag]) => self.registration.showNotification(title, {
    body, tag, renotify: true, silent: false, vibrate: [120, 60, 120], icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png'
  })));
}
