/* ═══════════════════════════════════════════════════════════
   APP — login, navegação, atalhos, tema, notificações e PWA.
   ═══════════════════════════════════════════════════════════ */

const App = {
  VIEWS: [
    { id: 'home',     title: 'Início',           icon: 'home',     group: 'Finanças', color: '#6366f1' },
    { id: 'tx',       title: 'Transações',       icon: 'list',     color: '#0ea5e9' },
    { id: 'bills',    title: 'Agenda de contas', icon: 'calendar', color: '#f97316' },
    { id: 'budget',   title: 'Orçamentos',       icon: 'pie',      color: '#14b8a6' },
    { id: 'invest',   title: 'Investimentos',    icon: 'up',       color: '#047857' },
    { id: 'goals',    title: 'Metas',            icon: 'target',   color: '#22c55e' },
    { id: 'receipts', title: 'Comprovantes',     icon: 'receipt',  color: '#eab308' },
    { id: 'notes',    title: 'Lembretes',        icon: 'bell',     group: 'Organização', color: '#ec4899' },
    { id: 'vault',    title: 'Senhas',           icon: 'lock',     color: '#a855f7' },
    { id: 'tools',    title: 'Ferramentas',      icon: 'calc',     color: '#64748b' },
    { id: 'settings', title: 'Ajustes',          icon: 'settings', group: 'Sistema', color: '#475569' }
  ],
  MONTH_VIEWS: ['home', 'tx', 'bills', 'budget', 'receipts'],
  ym: curYM(),
  view: null,
  installEvt: null,
  started: false,

  /* ── inicialização ── */
  init() {
    Sheet.init();
    Store.init();
    this.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('keydown', e => this.onKey(e));
    this.loginForm();
    this.registerSW();
    if (Auth.isLogged()) this.start();
    else { $('#auth').classList.remove('hidden'); if (matchMedia('(pointer:fine)').matches) $('#auth-user').focus(); }
  },

  loginForm() {
    if (LS.get('fin_last_user')) $('#auth-user').value = LS.get('fin_last_user');
    $('#auth-form').onsubmit = async e => {
      e.preventDefault();
      const u = $('#auth-user').value, p = $('#auth-pass').value;
      let acc = Auth.find(u, p);
      // conta criada ou senha alterada em outro aparelho
      if (!acc && Store.db) { try { await Auth.refresh(); acc = Auth.find(u, p); } catch {} }
      if (!acc) {
        $('#auth-err').textContent = 'Usuário ou senha incorretos.';
        const card = $('#auth-form'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        $('#auth-pass').value = ''; $('#auth-pass').focus();
        return;
      }
      LS.set('fin_last_user', u.trim().toUpperCase());
      Auth.login(acc, $('#auth-remember').checked);
      // limpa credenciais em texto puro salvas pelo sistema antigo
      ['pref_user', 'pref_pass', 'pref_remember'].forEach(k => localStorage.removeItem(k));
      this.start();
    };
  },

  start() {
    if (this.started) return; this.started = true;
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    document.body.classList.toggle('privacy', !!Settings.get('hideValues'));
    this.updatePrivacyIcon();
    Store.prefix = Auth.prefix();
    this.renderNav();
    startData();
    Alerts.start();
    // conta removida/bloqueada pelo administrador: encerra a sessão
    const acc = Auth.current();
    if (acc.id !== 'main') Auth.refresh().then(() => { const u = Auth.users()[acc.id]; if (!u || u.bloqueado) { Auth.logout(); location.reload(); } }).catch(() => {});

    Bus.on('data', what => { if (!['tools'].includes(this.view)) this.refresh(); if (what === 'notes') this.checkReminders(); if (what === 'tx') this.checkBills(); });
    Bus.on('sync', () => this.updateSync());
    Bus.on('settings', k => { if (['payday', 'saturdayBusiness'].includes(k)) this.refresh(); });
    this.updateSync();

    window.addEventListener('hashchange', () => this.show(location.hash.slice(1)));
    window.addEventListener('online', () => this.updateSync());
    window.addEventListener('offline', () => this.updateSync());
    window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 4), { passive: true });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this.installEvt = e; if (this.view === 'settings') this.refresh(); });

    // cofre: renova o tempo com uso e bloqueia sozinho
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (this.view === 'vault') Vault.touch(); }, { passive: true }));
    setInterval(() => {
      if (!Vault.isOpen() && DB.vault.length) { Vault.lock(); if (this.view === 'vault') toast('Cofre bloqueado por inatividade', 'info'); }
      this.checkReminders();
    }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (this.ym !== curYM() && !this._ymTouched) this.ym = curYM(); this.refresh(); this.checkReminders(); } });

    const first = location.hash.slice(1);
    this.show(this.VIEWS.some(v => v.id === first) ? first : Settings.get('startView'));
  },

  logout() {
    confirmDialog('Deseja sair do Fin neste aparelho?', { title: 'Sair', ok: 'Sair' }).then(ok => {
      if (!ok) return;
      Auth.logout(); location.hash = ''; location.reload();
    });
  },

  /* ── navegação ── */
  renderNav() {
    let html = '';
    this.VIEWS.forEach(v => {
      if (v.group) html += `<div class="nav-label">${v.group}</div>`;
      html += `<button class="nav-item" data-go="${v.id}">${icon(v.icon)}<span>${v.title}</span><span class="badge hidden" data-badge="${v.id}"></span></button>`;
    });
    $('#side-nav').innerHTML = html;
    $('#brand-user').textContent = Auth.current().nome;
  },
  go(id) { if (location.hash.slice(1) === id) this.show(id); else location.hash = id; },
  show(id) {
    if (!Views[id]) id = 'home';
    const changed = this.view !== id;
    this.view = id;
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + id));
    $$('[data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === id));
    const v = this.VIEWS.find(x => x.id === id);
    $('#view-title').textContent = v.title;
    document.title = `${v.title} · Fin`;
    this.render();
    if (changed) scrollTo({ top: 0 });
  },
  render() {
    const el = $('#v-' + this.view);
    try { Views[this.view].render(el); } catch (e) { console.error(e); el.innerHTML = `<div class="card">${empty('alert', 'Algo deu errado nesta tela', esc(e.message))}</div>`; }
    this.updateBadges();
  },
  /** re-renderiza a tela atual preservando o foco de campos de texto */
  refresh() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      if (!this.view) return;
      const a = document.activeElement, id = a?.id && $('#v-' + this.view).contains(a) ? a.id : null, pos = id ? a.selectionStart : null;
      this.render();
      if (id) { const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }
    });
  },
  setYM(ym) { this.ym = ym; this._ymTouched = ym !== curYM(); this.render(); },
  updateBadges() {
    const late = DB.tx.filter(t => t.type === 'expense' && txStatus(t) === 'Atrasado').length;
    const notes = DB.notes.filter(n => noteDue(n) && noteDue(n).slice(0, 10) <= today()).length;
    const set = (id, n) => { const b = $(`[data-badge="${id}"]`); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } };
    set('bills', late); set('notes', notes);
  },
  more() {
    const items = this.VIEWS.filter(v => !['home', 'tx', 'bills'].includes(v.id));
    Sheet.open({
      title: 'Menu',
      body: `<div class="more-grid">${items.map(v => `<button data-go="${v.id}"><span class="ic">${icon(v.icon)}</span>${v.title}</button>`).join('')}</div>
        <div class="row mt-lg" style="justify-content:center;gap:8px">
          <button class="btn sm" data-action="toggle-theme">${icon('moon', 'i-sm')} Tema</button>
          <button class="btn sm" data-action="logout">${icon('logout', 'i-sm')} Sair</button>
        </div>`
    });
  },

  /* ── eventos globais ── */
  onClick(e) {
    const t = e.target;
    const tp = t.closest('[data-toggle-pass]');
    if (tp) { const i = document.getElementById(tp.dataset.togglePass); i.type = i.type === 'password' ? 'text' : 'password'; tp.innerHTML = icon(i.type === 'password' ? 'eye' : 'eye-off'); return; }
    const pay = t.closest('[data-pay]');
    if (pay) { e.stopPropagation(); const x = DB.tx.find(z => z._key === pay.dataset.pay); if (x) Tx.togglePaid(x); return; }
    const act = t.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a.startsWith('ym-') || a === 'more') e.preventDefault();
      if (a === 'new-tx') { if (Sheet.el.open) Sheet._close(); openTxForm(null, this.view === 'bills' && Views.bills.sel ? { date: Views.bills.sel } : {}); }
      if (a === 'more') this.more();
      if (a === 'toggle-theme') this.toggleTheme();
      if (a === 'toggle-privacy') this.togglePrivacy();
      if (a === 'logout') { if (Sheet.el.open) Sheet.close(); this.logout(); }
      if (a === 'ym-prev') this.setYM(ymAdd(this.ym, -1));
      if (a === 'ym-next') this.setYM(ymAdd(this.ym, 1));
      if (a === 'ym-today') this.setYM(curYM());
      return;
    }
    const go = t.closest('[data-go]');
    if (go) { (Sheet.el.open ? Sheet.close() : Promise.resolve()).then(() => this.go(go.dataset.go)); return; }
    const tx = t.closest('[data-tx]');
    if (tx && !t.closest('a,input,select')) { const x = DB.tx.find(z => z._key === tx.dataset.tx); if (x) openTxForm(x); return; }
    const note = t.closest('[data-note]');
    if (note) { const n = DB.notes.find(z => z._key === note.dataset.note); if (n) Views.notes.form(n); }
  },
  onKey(e) {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (!this.started || typing || e.ctrlKey || e.metaKey || e.altKey || Sheet.el.open || $('#confirm').open) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); openTxForm(); }
    else if (k === '/') {
      e.preventDefault();
      if (this.view !== 'tx' && this.view !== 'notes' && this.view !== 'vault') this.go('tx');
      setTimeout(() => ($('#tx-q') && this.view === 'tx' ? $('#tx-q') : $(`#v-${this.view} input[type=search]`))?.focus(), 60);
    }
    else if (k === 'h') this.togglePrivacy();
    else if ((k === 'arrowleft' || k === 'arrowright') && this.MONTH_VIEWS.includes(this.view)) this.setYM(ymAdd(this.ym, k === 'arrowleft' ? -1 : 1));
  },

  /* ── tema e privacidade ── */
  applyTheme() {
    let t = Settings.get('theme');
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    $('meta[name=theme-color]').content = t === 'dark' ? '#0f1623' : '#ffffff';
    $$('[data-action="toggle-theme"] use').forEach(u => u.setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon'));
    if (this.view) this.refresh();
  },
  toggleTheme() {
    Settings.set('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    this.applyTheme();
  },
  togglePrivacy() {
    document.body.classList.toggle('privacy');
    this.updatePrivacyIcon();
    if (this.view === 'home') this.refresh();
  },
  updatePrivacyIcon() { $('#privacy-ic use')?.setAttribute('href', document.body.classList.contains('privacy') ? '#i-eye-off' : '#i-eye'); },

  updateSync() {
    const online = navigator.onLine, cls = Store.mode === 'local' ? 'off' : (Store.connected && online ? 'on' : 'off');
    const label = Store.mode === 'local' ? 'Modo local' : Store.connected && online ? 'Sincronizado' : 'Offline';
    ['#sync-dot', '#sync-dot-side'].forEach(s => { const d = $(s); if (d) { d.className = `sync-dot ${cls} ${s === '#sync-dot' ? 'only-mobile' : ''}`; d.title = label; } });
    if ($('#sync-label')) $('#sync-label').textContent = label;
    $('#offline-banner').classList.toggle('hidden', online);
  },

  /* ── notificações ── */
  async enableNotifications() {
    if (!('Notification' in window)) return toast('Seu navegador não suporta notificações', 'err');
    const p = await Notification.requestPermission();
    Settings.set('notify', p === 'granted');
    toast(p === 'granted' ? 'Notificações ativadas' : 'Permissão negada', p === 'granted' ? 'ok' : 'err');
    if (p === 'granted') { LS.del('fin_bills_day'); this.checkBills(); Alerts.registerBg(); }
  },
  async notify(title, body, tag, extra = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', ...extra };
    if (!tag) delete opts.renotify;
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) return reg.showNotification(title, opts); } catch {}
    try { new Notification(title, opts); } catch {}
  },
  checkReminders() {
    if (!this.started) return;
    const now = `${today()}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
    const done = new Set(LS.get('fin_notified', []));
    DB.notes.filter(n => noteDue(n) && noteDue(n) <= now && !done.has(n._key + '|' + n.quando)).forEach(n => {
      done.add(n._key + '|' + n.quando);
      // só avisa de lembretes das últimas 24h (evita avalanche de antigos)
      if (diffDays(n.quando.slice(0, 10), today()) > 1) return;
      toast(`Lembrete: ${n.titulo || 'sem título'}`, 'info', { action: 'Ver', onAction: () => Views.notes.form(n) });
      this.notify(n.titulo || 'Lembrete', n.texto || 'Você tem um lembrete agora', 'note-' + n._key);
    });
    LS.set('fin_notified', [...done].slice(-300));
  },
  checkBills() {
    if (!DB.loaded.tx || LS.get('fin_bills_day') === today()) return;
    const dueToday = DB.tx.filter(t => t.type === 'expense' && !isPaid(t) && t.date === today());
    const late = DB.tx.filter(t => t.type === 'expense' && txStatus(t) === 'Atrasado');
    if (!dueToday.length && !late.length) return;
    LS.set('fin_bills_day', today());
    const msg = [dueToday.length && `${dueToday.length} conta(s) vencem hoje (${fmt(sum(dueToday, t => t.amount))})`, late.length && `${late.length} em atraso`].filter(Boolean).join(' · ');
    this.notify('Contas a pagar', msg, 'bills');
  },

  /* ── PWA ── */
  registerSW() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
    }
  }
};

App.init();
