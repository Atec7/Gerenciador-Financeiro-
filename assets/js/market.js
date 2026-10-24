/* ═══════════ AÇÕES E ALERTAS ═══════════
   Market  → cotações da B3 (brapi.dev, API v2). A chave NÃO fica no app: um job do GitHub Actions
             (.github/workflows/cotacoes.yml, segredo BRAPI_TOKEN) busca as cotações a cada 30 min
             no pregão e grava em /mercado no Firebase. O app só lê esse nó.
   Alerts  → ao chegar cotação nova (e, no Android com o app instalado, também em segundo plano):
               · ações que você tem ou acompanha: variação forte no dia e preço-alvo
               · radar diário de ações (critérios objetivos — não é recomendação)
               · rendimento diário da renda fixa e mudança da Selic
             Cada alerta toca um som, fala o conteúdo, mostra um cartão e uma notificação. */

const SANDBOX = ['PETR4', 'VALE3', 'MGLU3', 'ITUB4'];
const MARKET_TYPES = ['Ações', 'Fundos imobiliários', 'Fundos'];
const TICKER_RE = /\b([A-Z]{4}\d{1,2}F?)\b/;

const Market = {
  load() { const m = DB.mercado || {}; return { q: m.cotacoes || {}, radar: m.radar || null, at: m.status?.at || null, status: m.status || null }; },
  get error() { const st = this.load().status; return st && !st.ok ? st.error : null; },
  /** sem o segredo BRAPI_TOKEN no GitHub, o job só consegue os 4 tickers de teste */
  sandbox() { return this.load().status?.mode === 'sandbox'; },
  allowed(t) { return !this.sandbox() || SANDBOX.includes(t); },
  notFound(t) { return (this.load().status?.notFound || []).includes(t); },
  quote(t) { const q = t ? this.load().q[t.toUpperCase()] : null; return q && q.price != null ? q : null; },

  /** ticker de um investimento: campo próprio ou detectado no nome ("PETR4", "Itaú ITUB4") */
  tickerOf(inv) {
    const t = (inv.ticker || '').trim().toUpperCase();
    if (t) return t;
    if (!MARKET_TYPES.includes(inv.tipo)) return null;
    return String(inv.nome || '').toUpperCase().match(TICKER_RE)?.[1] || null;
  },
  /** posição a preço de mercado, se houver ticker, quantidade e cotação */
  position(inv) {
    const t = this.tickerOf(inv), qtd = Number(inv.qtd) || 0, q = this.quote(t);
    if (!t || !(qtd > 0) || !q?.price) return null;
    const chg = Number(q.chg) || 0;
    return { ticker: t, qtd, price: q.price, chg, valor: qtd * q.price, dia: qtd * q.price * (chg / (100 + chg)), time: q.time };
  }
};

/* ── Som: "ding" suave gerado no navegador (sem arquivo de áudio) ── */
const Chime = {
  ctx: null,
  unlock() {
    try { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); } catch {}
  },
  play(kind = 'info') {
    if (DB.alerts?.sound === false) return;
    try {
      this.unlock(); const c = this.ctx; if (!c) return;
      const notes = kind === 'down' ? [880, 659.25] : kind === 'star' ? [659.25, 830.61, 987.77] : [783.99, 1046.5];
      notes.forEach((f, i) => {
        const t = c.currentTime + i * 0.14, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.65);
      });
    } catch {}
  }
};
/* ── Voz: lê o alerta em português (funciona com o app aberto na tela) ── */
const Voice = {
  ok: 'speechSynthesis' in window,
  voice() {
    const vs = speechSynthesis.getVoices(), br = v => v.lang.replace('_', '-').toLowerCase();
    return vs.find(v => br(v) === 'pt-br' && /google|luciana|francisca|maria/i.test(v.name)) || vs.find(v => br(v) === 'pt-br') || vs.find(v => br(v).startsWith('pt')) || null;
  },
  /** deixa o texto natural para ouvir: tira emojis, lê valores em reais e porcentagens */
  clean(t) {
    return String(t)
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
      .replace(/([+−-])\s?R\$\s?/g, (m, s) => s === '+' ? 'mais R$ ' : 'menos R$ ').replace(/\(s\)/g, 's')
      .replace(/R\$\s?([\d.]+),(\d{2})/g, (m, i, c) => `${i.replace(/\./g, '')} reais${c !== '00' ? ` e ${+c} centavos` : ''}`)
      .replace(/(\d+),(\d+)%/g, '$1 vírgula $2 por cento').replace(/(\d+)%/g, '$1 por cento')
      .replace(/P\/L/g, 'P sobre L').replace(/±/g, 'mais ou menos ').replace(/≤/g, 'até').replace(/≥/g, 'a partir de')
      .replace(/\b([A-Z]{4})(\d{1,2})\b/g, (m, l, n) => `${l.split('').join(' ')} ${n}`)
      .replace(/\s+/g, ' ').trim();
  },
  say(title, body) {
    if (!this.ok || DB.alerts?.voice === false || document.hidden) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(this.clean(`${title}${/[.!?]$/.test(title) ? '' : '.'} ${body || ''}`));
      u.lang = 'pt-BR'; u.rate = 1.02; try { const v = this.voice(); if (v) u.voice = v; } catch {}
      setTimeout(() => speechSynthesis.speak(u), DB.alerts?.sound === false ? 0 : 700); // depois do "ding"
    } catch {}
  },
  /** iPhone/Android só liberam a fala depois de um toque do usuário */
  unlock() { if (!this.ok || this._u) return; this._u = true; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); speechSynthesis.getVoices(); } catch {} }
};
if (Voice.ok) speechSynthesis.onvoiceschanged = () => {};
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { Chime.unlock(); Voice.unlock(); }, { once: true, passive: true }));

const Alerts = {
  SKEY: 'fin_alerts_state', LKEY: 'fin_alerts_log', timer: null, running: false,
  state() { return this._s ||= LS.get(this.SKEY) || { done: {} }; },
  saveState() { const s = this.state(), cut = Date.now() - 4 * 86400e3; Object.keys(s.done).forEach(k => { if (s.done[k] < cut) delete s.done[k]; }); LS.set(this.SKEY, s); },
  log() { return LS.get(this.LKEY, []) || []; },
  on(k) { return (DB.alerts || {})[k] !== false; },
  move() { return Number((DB.alerts || {}).move) || 3; },

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.run(), 15 * 60e3);
    setTimeout(() => this.run(), 3000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.run(); });
    Bus.on('data', w => {
      if (w === 'rates') this.checkFixed();
      if (w === 'market') this.run();
      if (w === 'invest' || w === 'config' || w === 'market') this.syncBg();
    });
    this.registerBg();
  },

  /** ações que você tem (com ticker) + lista de acompanhamento */
  watched() {
    const own = {};
    DB.invest.forEach(i => { const t = Market.tickerOf(i); if (t) (own[t] ||= []).push(i); });
    const watch = (DB.alerts || {}).watch || {};
    return { own, watch, tickers: [...new Set([...Object.keys(own), ...Object.keys(watch)])] };
  },

  /** confere as cotações já gravadas pelo job e dispara o que for novo */
  async run() {
    if (this.running || !App.started || !DB.loaded.invest) return;
    this.running = true;
    try {
      await this.mergeBgState();
      const { own, watch } = this.watched();
      if (this.on('stocks') && DB.mercado) this.checkStocks(own, watch);
      const r = Market.load().radar;
      if (this.on('radar') && r?.day === today() && r.items?.length && this.once(`radar|${r.day}`)) {
        const top = r.items.slice(0, 3).map(x => x.pl ? `${x.t} (P/L ${fmtNum(x.pl, 1)})` : `${x.t} (${fmtNum(x.desc * 100, 0)}% abaixo da máxima)`).join(', ');
        this.fire({ kind: 'star', title: '⭐ Radar de ações do dia', body: `Em destaque: ${top}. Veja os critérios na aba Investimentos.`, tag: 'inv-radar' });
      }
      this.checkFixed();
    } catch (e) { console.warn('Alertas', e); }
    finally { this.running = false; }
  },

  once(key) { const s = this.state(); if (s.done[key]) return false; s.done[key] = Date.now(); this.saveState(); return true; },

  checkStocks(own, watch) {
    const m = this.move(), day = today();
    Object.keys({ ...own, ...watch }).forEach(t => {
      const q = Market.quote(t); if (!q || (q.time || q.at || '').slice(0, 10) < addDays(day, -3)) return;
      const chg = Number(q.chg) || 0, lvl = Math.floor(Math.abs(chg) / m), up = chg >= 0;
      if (lvl >= 1 && this.once(`mv|${t}|${day}|${up ? '+' : '-'}${lvl}`)) {
        const invs = own[t] || [], pos = invs.map(i => Market.position(i)).filter(Boolean);
        const qtd = sum(pos, p => p.qtd), val = sum(pos, p => p.valor), dia = sum(pos, p => p.dia);
        const body = qtd ? `Suas ${fmtNum(qtd, qtd % 1 ? 2 : 0)} cotas valem ${fmt(val)} (${dia >= 0 ? '+' : '−'}${fmt(Math.abs(dia))} hoje).`
          : `Cotação agora: ${fmt(q.price)}.${invs.length ? ' Informe a quantidade de cotas para ver o valor da sua posição.' : ''}`;
        this.fire({ kind: up ? 'up' : 'down', title: `${up ? '📈' : '📉'} ${t} ${up ? 'subiu' : 'caiu'} ${fmtNum(Math.abs(chg), 2)}% hoje`, body, tag: `inv-${t}` });
      }
      const w = watch[t];
      if (w?.compra && q.price <= w.compra && this.once(`buy|${t}|${day}`))
        this.fire({ kind: 'star', title: `🎯 ${t} chegou no seu preço de compra`, body: `Está em ${fmt(q.price)} (seu alvo: ${fmt(w.compra)}).`, tag: `inv-${t}-alvo` });
      if (w?.venda && q.price >= w.venda && this.once(`sell|${t}|${day}`))
        this.fire({ kind: 'up', title: `🏁 ${t} atingiu seu preço de venda`, body: `Está em ${fmt(q.price)} (seu alvo: ${fmt(w.venda)}).`, tag: `inv-${t}-alvo` });
    });
  },

  /** renda fixa: quanto rendeu desde a última verificação + mudança da Selic */
  checkFixed() {
    if (!App.started || !DB.loaded.invest || Rates.status() !== 'live') return;
    const s = this.state(), list = DB.invest.map(i => Invest.stats(i)).filter(st => st.auto && st.rule?.kind !== 'mercado');
    if (list.length && this.on('invest')) {
      const saldo = sum(list, st => st.saldo), aplicado = sum(list, st => st.aplicado), snap = s.snap;
      if (snap && snap.date < today()) {
        const ganho = (saldo - snap.saldo) - (aplicado - snap.aplicado);
        if (ganho >= 0.01) this.fire({ kind: 'up', title: `💰 Seus investimentos renderam ${fmt(ganho)}`, body: `${diffDays(snap.date, today()) > 1 ? `Desde ${fmtDate(snap.date)}` : 'Desde ontem'} · renda fixa agora soma ${fmt(saldo)}.`, tag: 'inv-rend' });
      }
      if (!snap || snap.date < today()) s.snap = { date: today(), saldo, aplicado };
    }
    const selic = Math.round(Rates.annual('selic') * 10000) / 100;
    if (s.selic != null && Math.abs(selic - s.selic) >= 0.1 && this.on('invest')) {
      const sub = selic > s.selic;
      this.fire({ kind: sub ? 'up' : 'down', title: `🏦 A Selic ${sub ? 'subiu' : 'caiu'} para ${fmtNum(selic, 2)}% a.a.`, body: `Era ${fmtNum(s.selic, 2)}%. Investimentos atrelados ao CDI passam a render ${sub ? 'mais' : 'menos'}.`, tag: 'inv-selic' });
    }
    s.selic = selic; this.saveState();
  },

  /** mostra o alerta: som + cartão no app + notificação do sistema */
  fire({ kind = 'info', title, body, tag }) {
    const log = this.log(); log.unshift({ kind, title, body, at: new Date().toISOString() }); LS.set(this.LKEY, log.slice(0, 40));
    if (!document.hidden) this.card({ kind, title, body });
    App.notify(title, body, tag, { vibrate: [120, 60, 120], renotify: true, silent: false, kind });
    Bus.emit('data', 'alerts');
  },

  card({ kind, title, body }) {
    let box = $('#alert-cards');
    if (!box) { box = document.createElement('div'); box.id = 'alert-cards'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `alert-card ${kind}`;
    el.innerHTML = `<div class="ac-icon">${icon(kind === 'down' ? 'down' : kind === 'star' ? 'target' : kind === 'up' ? 'up' : 'bell')}</div>
      <div class="ac-body"><b>${esc(title)}</b><span>${esc(body)}</span></div><button class="ac-x" aria-label="Fechar">${icon('x', 'i-sm')}</button>`;
    el.onclick = e => { el.remove(); if (!e.target.closest('.ac-x')) location.hash = 'invest'; };
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 9000);
  },

  test() { this.fire({ kind: 'up', title: '📈 Alertas funcionando!', body: 'É assim que você vai ser avisado das suas ações e investimentos.', tag: 'inv-test' }); },

  /* ── segundo plano (Android, app instalado): o service worker lê esta configuração ── */
  async syncBg() {
    if (!('caches' in window)) return;
    try {
      const { own, watch, tickers } = this.watched(), c = await caches.open('fin-alerts');
      const old = await (await c.match('cfg'))?.json().catch(() => null);
      const items = tickers.filter(t => Market.allowed(t)).map(t => ({ t, qtd: sum(own[t] || [], i => Number(i.qtd) || 0), compra: watch[t]?.compra || null, venda: watch[t]?.venda || null }));
      const cfg = { enabled: this.on('stocks'), db: FIREBASE_CONFIG.databaseURL, move: this.move(), items, done: { ...(old?.done || {}), ...this.state().done } };
      await c.put('cfg', new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } }));
    } catch {}
  },
  async mergeBgState() {
    try { const r = await (await caches.open('fin-alerts')).match('cfg'); const d = r && (await r.json()).done; if (d) Object.assign(this.state().done, d); } catch {}
  },
  async registerBg() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (!reg?.periodicSync) return;
      const p = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (p.state === 'granted') await reg.periodicSync.register('fin-alerts', { minInterval: 60 * 60e3 });
    } catch {}
  },

  /* ── configuração (salva na nuvem, vale para todos os aparelhos) ── */
  saveCfg(patch) { DB.alerts = { ...(DB.alerts || {}), ...patch }; return Store.update('config/alerts', patch); }
};
