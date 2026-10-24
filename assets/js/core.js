/* ═══════════════════════════════════════════════════════════
   CORE — utilitários, datas, armazenamento (Firebase/local),
   configurações e hash de senha.
   ═══════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDXDB6jbRy3o1eXcdXqmd8zrplDk1IezqM",
  authDomain: "sistema-financeiro-51295.firebaseapp.com",
  projectId: "sistema-financeiro-51295",
  storageBucket: "sistema-financeiro-51295.appspot.com",
  messagingSenderId: "340721821688",
  appId: "1:340721821688:web:77485712a056405f5f180d",
  databaseURL: "https://sistema-financeiro-51295-default-rtdb.firebaseio.com"
};
const IMGBB_KEY = "95bb16ee776d7e20f26857cec98bd372";
/* chave da brapi.dev (cotações da B3) — colocada no código por decisão do dono do app.
   Para trocar: gere outra em brapi.dev/dashboard e substitua aqui. */
const BRAPI_TOKEN = "4w1EWRTF4Z9isjnxwBdTy3";

/* ── DOM ── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ── Event bus ── */
const Bus = {
  h: {},
  on(ev, f) { (this.h[ev] ||= []).push(f); },
  emit(ev, d) { (this.h[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
};

/* ── localStorage seguro ── */
const LS = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { v === null || v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('LS', e); } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ── Dinheiro ── */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = v => BRL.format(Number(v) || 0);
const money = (v, cls = '') => `<span class="money num ${cls}">${fmt(v)}</span>`;
const fmtNum = (v, d = 2) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** Aceita "1.234,56", "1234.56", "12,5", "R$ 10" */
function parseMoney(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').replace(/[^\d,.-]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}

/* ── Datas (strings YYYY-MM-DD, sem fuso) ── */
const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MONTHS_S = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const WEEK = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYMD = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const today = () => ymd(new Date());
const curYM = () => today().slice(0, 7);
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const fmtDateShort = s => { if (!s) return ''; const d = parseYMD(s); return `${d.getDate()} ${MONTHS_S[d.getMonth()]}`; };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  t.setDate(Math.min(d, daysInMonth(t.getFullYear(), t.getMonth())));
  return ymd(t);
}
const addDays = (s, n) => { const d = parseYMD(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYMD(b) - parseYMD(a)) / 86400000);
const ymAdd = (ym, n) => addMonths(ym + '-01', n).slice(0, 7);
const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const ymRange = ym => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${pad(daysInMonth(y, m - 1))}`]; };
function relDay(s) {
  const n = diffDays(today(), s);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  if (n === -1) return 'Ontem';
  if (n > 1 && n < 7) return cap(WEEK[parseYMD(s).getDay()]);
  return fmtDateShort(s) + (s.slice(0, 4) !== today().slice(0, 4) ? ' ' + s.slice(0, 4) : '');
}

/* ── Feriados nacionais / bancários ── */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(new Date(y, mo - 1, da));
}
const _holCache = {};
function holidays(y) {
  if (_holCache[y]) return _holCache[y];
  const e = easter(y);
  const list = {
    [`${y}-01-01`]: 'Confraternização Universal',
    [addDays(e, -48)]: 'Carnaval',
    [addDays(e, -47)]: 'Carnaval',
    [addDays(e, -2)]: 'Sexta-feira Santa',
    [`${y}-04-21`]: 'Tiradentes',
    [`${y}-05-01`]: 'Dia do Trabalho',
    [addDays(e, 60)]: 'Corpus Christi',
    [`${y}-09-07`]: 'Independência',
    [`${y}-10-12`]: 'Nossa Senhora Aparecida',
    [`${y}-11-02`]: 'Finados',
    [`${y}-11-15`]: 'Proclamação da República',
    [`${y}-11-20`]: 'Consciência Negra',
    [`${y}-12-25`]: 'Natal'
  };
  return (_holCache[y] = list);
}
const holidayName = s => holidays(+s.slice(0, 4))[s] || null;
function isBusinessDay(s, saturday = Settings.get('saturdayBusiness')) {
  const dw = parseYMD(s).getDay();
  if (dw === 0 || (dw === 6 && !saturday)) return false;
  return !holidayName(s);
}
/** N-ésimo dia útil do mês (ym = "YYYY-MM") */
function nthBusinessDay(ym, n) {
  let s = ym + '-01', c = 0;
  while (s.slice(0, 7) === ym) {
    if (isBusinessDay(s) && ++c === n) return s;
    s = addDays(s, 1);
  }
  return null;
}
function businessDaysBetween(a, b) {
  if (a > b) [a, b] = [b, a];
  let c = 0;
  for (let s = a; s <= b; s = addDays(s, 1)) if (isBusinessDay(s)) c++;
  return c;
}

/* ── SHA-256 (síncrono, funciona até em file://) ── */
const SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const l = bytes.length, nb = (l + 9 + 63) >> 6;
  const w = new Uint32Array(nb * 16);
  for (let i = 0; i < l; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  w[l >> 2] |= 0x80 << (24 - (l & 3) * 8);
  w[nb * 16 - 1] = l * 8;
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < nb; b++) {
    for (let t = 0; t < 64; t++) {
      if (t < 16) W[t] = w[b * 16 + t];
      else {
        const s0 = r(W[t - 15], 7) ^ r(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = r(W[t - 2], 17) ^ r(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
    }
    let [A, B, C, D, E, F, G, H] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (H + (r(E, 6) ^ r(E, 11) ^ r(E, 25)) + ((E & F) ^ (~E & G)) + SHA_K[t] + W[t]) | 0;
      const t2 = ((r(A, 2) ^ r(A, 13) ^ r(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    [A, B, C, D, E, F, G, H].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/* ── Configurações do dispositivo ── */
const Settings = {
  defaults: { theme: 'system', hideValues: false, lockMinutes: 5, saturdayBusiness: false, payday: 5, notify: false, startView: 'home' },
  data: Object.assign({}, LS.get('fin_settings', {})),
  get(k) { return k in this.data ? this.data[k] : this.defaults[k]; },
  set(k, v) { this.data[k] = v; LS.set('fin_settings', this.data); Bus.emit('settings', k); }
};

/* ── Armazenamento: Firebase Realtime DB com fallback local ── */
const Store = {
  db: null,
  connected: false,
  localSubs: [],
  /** Prefixo dos dados do usuário logado ('' = dados principais; 'usuarios/<id>/' = dados separados).
      Caminhos que começam com '/' são absolutos (ex.: '/config/users'). */
  prefix: '',
  P(path) { return path.startsWith('/') ? path.slice(1) : this.prefix + path; },

  init() {
    try {
      if (window.firebase) {
        firebase.initializeApp(FIREBASE_CONFIG);
        this.db = firebase.database();
        this.db.ref('.info/connected').on('value', s => { this.connected = !!s.val(); Bus.emit('sync'); });
      }
    } catch (e) { console.warn('Firebase indisponível, usando modo local.', e); this.db = null; }
    Bus.emit('sync');
  },
  get mode() { return this.db ? 'cloud' : 'local'; },

  /** Escuta um caminho. Entrega o cache local imediatamente (abre instantâneo/offline). */
  on(path, cb, { cache = true } = {}) {
    path = this.P(path);
    if (cache) { const c = LS.get('fin_cache:' + path); if (c != null) cb(c, true); }
    if (this.db) {
      this.db.ref(path).on('value',
        s => { const v = s.val(); if (cache) LS.set('fin_cache:' + path, v); cb(v, false); },
        err => { console.warn(path, err); toast(`Sem permissão para ler "${path}"`, 'err'); });
    } else {
      const f = () => cb(this._get(path), false);
      this.localSubs.push(f); f();
    }
  },
  newKey() { return this.db ? this.db.ref().push().key : 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
  push(path, data) { const k = this.newKey(); this.set(`${path}/${k}`, data); return k; },
  set(path, val) {
    path = this.P(path);
    if (this.db) return this.db.ref(path).set(clean(val));
    this._set(path, clean(val)); return Promise.resolve();
  },
  update(path, data) {
    path = this.P(path);
    if (this.db) return this.db.ref(path).update(data);
    Object.entries(data).forEach(([k, v]) => this._set(`${path}/${k}`, v));
    return Promise.resolve();
  },
  /** Atualização em vários caminhos de uma vez: { "a/b": 1, "c/d": null } */
  multi(updates) {
    updates = Object.fromEntries(Object.entries(updates).map(([p, v]) => [this.P(p), v]));
    if (this.db) return this.db.ref().update(updates);
    Object.entries(updates).forEach(([p, v]) => this._set(p, v));
    return Promise.resolve();
  },
  remove(path) { return this.set(path, null); },
  async get(path) {
    path = this.P(path);
    if (this.db) return (await this.db.ref(path).get()).val();
    return this._get(path);
  },

  /* árvore local (quando o Firebase não carrega) */
  _get(path) {
    let node = LS.get('fin_localdb', {});
    for (const p of path.split('/').filter(Boolean)) { if (node == null) return null; node = node[p]; }
    return node ?? null;
  },
  _set(path, val) {
    const root = LS.get('fin_localdb', {});
    const parts = path.split('/').filter(Boolean);
    let node = root;
    parts.slice(0, -1).forEach(p => { if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}; node = node[p]; });
    const last = parts[parts.length - 1];
    if (val === null || val === undefined) delete node[last]; else node[last] = val;
    LS.set('fin_localdb', root);
    this.localSubs.forEach(f => f());
  }
};
/** remove undefined (Firebase rejeita) */
function clean(v) {
  if (v === undefined) return null;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = {};
    Object.entries(v).forEach(([k, x]) => { if (x !== undefined && !k.startsWith('_')) o[k] = clean(x); });
    return o;
  }
  return v;
}

/* ── Carregamento sob demanda de bibliotecas pesadas ── */
const _scripts = {};
function loadScript(src) {
  return _scripts[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { delete _scripts[src]; rej(new Error('Falha ao carregar ' + src)); };
    document.head.appendChild(s);
  });
}
const LIBS = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
};
async function loadPDF() { await loadScript(LIBS.jspdf); await loadScript(LIBS.autotable); return window.jspdf.jsPDF; }

/* ── Download de arquivo ── */
function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ── Cópia para área de transferência ── */
async function copyText(text, label = 'Copiado!') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(label, 'ok');
}

/* ── Upload de imagem (imgbb, igual ao sistema antigo) ── */
async function uploadImage(file) {
  if (file.size > 32 * 1024 * 1024) throw new Error('Arquivo maior que 32 MB');
  const fd = new FormData(); fd.append('image', file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: 'POST', body: fd });
  const json = await res.json();
  if (!json?.data?.display_url) throw new Error(json?.error?.message || 'Falha no envio');
  return json.data.display_url;
}
function pickFile(accept = 'image/*') {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => res(i.files[0] || null); i.click();
  });
}

/* ── Gerador de senhas ── */
function genPassword(len = 16, { upper = true, lower = true, digits = true, symbols = true } = {}) {
  const sets = [lower && 'abcdefghijkmnpqrstuvwxyz', upper && 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits && '23456789', symbols && '!@#$%&*?-_=+'].filter(Boolean);
  if (!sets.length) return '';
  const all = sets.join(''), rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const out = sets.map(s => s[rnd(s.length)]);
  while (out.length < len) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}
function passwordStrength(p) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++; if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++; if (/[^\w]/.test(p)) s++;
  return Math.min(4, Math.max(1, s - (p.length < 6 ? 2 : 0)));
}

/* ── Cor estável a partir de um texto ── */
const PALETTE = ['#1d4ed8','#0369a1','#0f766e','#15803d','#a16207','#c2410c','#b91c1c','#be185d','#6d28d9','#475569'];
function colorFor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
