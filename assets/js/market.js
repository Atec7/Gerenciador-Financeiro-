/* ═══════════ AÇÕES E ALERTAS ═══════════
   Market  → cotações da B3 pela API brapi.dev (chave grátis em brapi.dev; sem chave só
             funcionam PETR4, VALE3, MGLU3 e ITUB4). Cache no aparelho.
   Alerts  → verifica a cada 30 min (com o app aberto) e, no Android com o app instalado,
             também em segundo plano (Periodic Background Sync, no ritmo que o sistema permitir):
               · ações que você tem ou acompanha: variação forte no dia e preço-alvo
               · radar diário de ações (critérios objetivos — não é recomendação)
               · rendimento diário da renda fixa e mudança da Selic
             Cada alerta toca um som, mostra um cartão no app e uma notificação do sistema. */

const SANDBOX = ['PETR4', 'VALE3', 'MGLU3', 'ITUB4'];
/* grandes empresas da B3 — universo do radar quando a listagem da API não estiver disponível */
const RADAR_BASE = ['ITUB4', 'PETR4', 'VALE3', 'BBDC4', 'BBAS3', 'ABEV3', 'WEGE3', 'ITSA4', 'B3SA3', 'BBSE3', 'ELET3', 'SUZB3',
  'RENT3', 'EQTL3', 'PRIO3', 'CMIG4', 'TAEE11', 'EGIE3', 'VIVT3', 'SBSP3', 'KLBN11', 'CPLE6', 'GGBR4', 'RADL3', 'CXSE3'];
const MARKET_TYPES = ['Ações', 'Fundos imobiliários', 'Fundos'];
const TICKER_RE = /\b([A-Z]{4}\d{1,2}F?)\b/;

const Market = {
  KEY: 'fin_market',
  data: null, error: null, busy: false,
  load() { return this.data ||= LS.get(this.KEY) || { q: {}, radar: null }; },
  save() { LS.set(this.KEY, this.data); },
  cfg() { return DB.alerts || {}; },
  token() { return (this.cfg().token || '').trim(); },
  /** sem chave, só os 4 tickers de teste */
  allowed(t) { return !!this.token() || SANDBOX.includes(t); },
  quote(t) { return t ? this.load().q[t.toUpperCase()] || null : null; },

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
    return { ticker: t, qtd, price: q.price, chg: q.chg, valor: qtd * q.price, dia: qtd * q.price * (q.chg / (100 + q.chg)), time: q.time };
  },

  url(path, params = {}) {
    const u = new URL(`https://brapi.dev/api/${path}`);
    Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    if (this.token()) u.searchParams.set('token', this.token());
    return u.toString();
  },
  async get(path, params) {
    const res = await fetch(this.url(path, params), { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(this.token() ? 'Chave da brapi inválida ou sem acesso a este ativo' : 'Sem chave da brapi: só PETR4, VALE3, MGLU3 e ITUB4'), { auth: true });
    if (res.status === 429) throw new Error('Limite de consultas da brapi atingido; tente mais tarde');
    if (!res.ok) throw new Error(`brapi: erro ${res.status}`);
    return res.json();
  },

  /** atualiza cotações (em blocos; se um bloco falhar, tenta um a um) */
  async refresh(tickers) {
    tickers = [...new Set(tickers.map(t => t.toUpperCase()))].filter(t => this.allowed(t));
    if (!tickers.length) return {};
    const d = this.load(), out = {};
    const put = r => {
      if (!r?.symbol || r.regularMarketPrice == null) return;
      out[r.symbol] = d.q[r.symbol] = {
        price: +r.regularMarketPrice, chg: +(r.regularMarketChangePercent || 0), name: r.shortName || r.longName || r.symbol,
        pl: r.priceEarnings != null ? +r.priceEarnings : null, hi52: r.fiftyTwoWeekHigh != null ? +r.fiftyTwoWeekHigh : null,
        lo52: r.fiftyTwoWeekLow != null ? +r.fiftyTwoWeekLow : null, logo: r.logourl || null,
        time: r.regularMarketTime || new Date().toISOString(), at: new Date().toISOString()
      };
    };
    for (let i = 0; i < tickers.length; i += 10) {
      const chunk = tickers.slice(i, i + 10);
      try { (await this.get(`quote/${chunk.join(',')}`)).results?.forEach(put); this.error = null; }
      catch (e) {
        if (chunk.length === 1) { this.error = e.message; continue; }
        for (const t of chunk) { try { (await this.get(`quote/${t}`)).results?.forEach(put); } catch (e2) { this.error = e2.message; } }
      }
    }
    d.at = new Date().toISOString(); this.save();
    return out;
  },

  /** maiores empresas pela listagem da API (se o plano permitir) */
  async biggest(n = 30) {
    try {
      const r = await this.get('quote/list', { type: 'stock', sortBy: 'market_cap_basic', sortOrder: 'desc', limit: n });
      const l = (r.stocks || []).map(s => s.stock).filter(t => /^[A-Z]{4}\d{1,2}$/.test(t));
      return l.length >= 5 ? l : RADAR_BASE;
    } catch { return RADAR_BASE; }
  },

  /** Radar: entre grandes empresas, combina P/L baixo (positivo) e desconto em relação à máxima de 52 semanas.
      Critério simples e transparente para chamar atenção — não é recomendação de compra. */
  async radar() {
    const universe = this.token() ? await this.biggest() : SANDBOX;
    const q = await this.refresh(universe);
    const rows = Object.entries(q).map(([t, x]) => ({ t, ...x, desc: x.hi52 ? 1 - x.price / x.hi52 : null }))
      .filter(x => x.pl > 0 && x.pl < 40 && x.desc != null);
    if (!rows.length) return null;
    const rank = (arr, f) => { const s = [...arr].sort(f); return Object.fromEntries(s.map((x, i) => [x.t, i])); };
    const rPL = rank(rows, (a, b) => a.pl - b.pl), rDesc = rank(rows, (a, b) => b.desc - a.desc);
    const items = rows.map(x => ({ ...x, score: rPL[x.t] + rDesc[x.t] })).sort((a, b) => a.score - b.score).slice(0, 5)
      .map(({ t, name, price, chg, pl, desc, logo }) => ({ t, name, price, chg, pl, desc, logo }));
    const d = this.load(); d.radar = { at: new Date().toISOString(), day: today(), items, n: rows.length }; this.save();
    return d.radar;
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
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => Chime.unlock(), { once: true, passive: true }));

const Alerts = {
  SKEY: 'fin_alerts_state', LKEY: 'fin_alerts_log', timer: null, running: false,
  state() { return this._s ||= LS.get(this.SKEY) || { done: {} }; },
  saveState() { const s = this.state(), cut = Date.now() - 4 * 86400e3; Object.keys(s.done).forEach(k => { if (s.done[k] < cut) delete s.done[k]; }); LS.set(this.SKEY, s); },
  log() { return LS.get(this.LKEY, []) || []; },
  on(k) { return (DB.alerts || {})[k] !== false; },
  move() { return Number((DB.alerts || {}).move) || 3; },

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.run(), 30 * 60e3);
    setTimeout(() => this.run(), 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.run(); });
    Bus.on('data', w => { if (w === 'rates') this.checkFixed(); if (w === 'invest' || w === 'config') this.syncBg(); });
    this.registerBg();
  },

  /** horário de pregão (dias úteis, 10h–18h30) — fora dele as cotações não mudam */
  marketOpen() { const n = new Date(), h = n.getHours() + n.getMinutes() / 60; return isBusinessDay(today(), false) && h >= 10 && h <= 18.6; },

  /** ações que você tem (com ticker) + lista de acompanhamento */
  watched() {
    const own = {};
    DB.invest.forEach(i => { const t = Market.tickerOf(i); if (t) (own[t] ||= []).push(i); });
    const watch = (DB.alerts || {}).watch || {};
    return { own, watch, tickers: [...new Set([...Object.keys(own), ...Object.keys(watch)])] };
  },

  async run(force = false) {
    if (this.running || !App.started || !DB.loaded.invest) return;
    this.running = true;
    try {
      await this.mergeBgState();
      const { own, watch, tickers } = this.watched();
      const stale = !Market.load().at || Date.now() - new Date(Market.load().at) > 25 * 60e3;
      if (tickers.length && (force || (stale && (this.marketOpen() || !Market.load().at)))) {
        await Market.refresh(tickers);
        if (this.on('stocks')) this.checkStocks(own, watch);
        Bus.emit('data', 'market');
      }
      // radar uma vez por dia útil, depois que o pregão abre
      const r = Market.load().radar, h = new Date().getHours();
      if (this.on('radar') && isBusinessDay(today(), false) && h >= 11 && r?.day !== today()) {
        const rad = await Market.radar();
        if (rad?.items.length) {
          const top = rad.items.slice(0, 3).map(x => `${x.t} (P/L ${fmtNum(x.pl, 1)})`).join(', ');
          this.fire({ kind: 'star', title: '⭐ Radar de ações do dia', body: `Em destaque: ${top}. Veja os critérios na aba Investimentos.`, tag: 'inv-radar' });
        }
        Bus.emit('data', 'market');
      }
      this.checkFixed();
      this.syncBg();
    } catch (e) { console.warn('Alertas', e); }
    finally { this.running = false; }
  },

  once(key) { const s = this.state(); if (s.done[key]) return false; s.done[key] = Date.now(); this.saveState(); return true; },

  checkStocks(own, watch) {
    const m = this.move(), day = today();
    Object.keys({ ...own, ...watch }).forEach(t => {
      const q = Market.quote(t); if (!q || (q.time || '').slice(0, 10) < addDays(day, -3)) return;
      const lvl = Math.floor(Math.abs(q.chg) / m), up = q.chg >= 0;
      if (lvl >= 1 && this.once(`mv|${t}|${day}|${up ? '+' : '-'}${lvl}`)) {
        const invs = own[t] || [], pos = invs.map(i => Market.position(i)).filter(Boolean);
        const qtd = sum(pos, p => p.qtd), val = sum(pos, p => p.valor), dia = sum(pos, p => p.dia);
        const body = qtd ? `Suas ${fmtNum(qtd, qtd % 1 ? 2 : 0)} cotas valem ${fmt(val)} (${dia >= 0 ? '+' : '−'}${fmt(Math.abs(dia))} hoje).`
          : `Cotação agora: ${fmt(q.price)}.${invs.length ? ' Informe a quantidade de cotas para ver o valor da sua posição.' : ''}`;
        this.fire({ kind: up ? 'up' : 'down', title: `${up ? '📈' : '📉'} ${t} ${up ? 'subiu' : 'caiu'} ${fmtNum(Math.abs(q.chg), 2)}% hoje`, body, tag: `inv-${t}` });
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
    Chime.play(kind);
    if (!document.hidden) this.card({ kind, title, body });
    App.notify(title, body, tag, { vibrate: [120, 60, 120], renotify: true, silent: false });
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
      const cfg = { enabled: this.on('stocks'), token: Market.token(), move: this.move(), items, done: { ...(old?.done || {}), ...this.state().done } };
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
