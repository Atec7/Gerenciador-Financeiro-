/* Sincroniza cotações da B3 (brapi.dev, API v2) com o Firebase do app.
   Roda no GitHub Actions. A chave fica SÓ no segredo BRAPI_TOKEN do repositório:
   o app nunca vê a chave, apenas lê o resultado gravado em /mercado.

   Grava:
     /mercado/cotacoes/{TICKER}  { price, chg, name, hi52, lo52, logo, time, at }
     /mercado/radar              { day, at, items[], n, crit }
     /mercado/status             { at, ok, mode, error, notFound[], tickers }

   Uso local:  BRAPI_TOKEN=... node .github/scripts/brapi-sync.mjs [--force] [--dry] [TICKERS...] */

const API = 'https://brapi.dev';
const DB = (process.env.FIREBASE_DB_URL || 'https://sistema-financeiro-51295-default-rtdb.firebaseio.com').replace(/\/$/, '');
const TOKEN = (process.env.BRAPI_TOKEN || '').trim();
const args = process.argv.slice(2);
const FORCE = args.includes('--force') || process.env.FORCE === 'true';
const DRY = args.includes('--dry');
const ONLY = args.filter(a => !a.startsWith('--')).map(s => s.toUpperCase());

const SANDBOX = ['PETR4', 'VALE3', 'MGLU3', 'ITUB4'];
const RADAR_BASE = ['ITUB4', 'PETR4', 'VALE3', 'BBDC4', 'BBAS3', 'ABEV3', 'WEGE3', 'ITSA4', 'B3SA3', 'BBSE3', 'ELET3', 'SUZB3',
  'RENT3', 'EQTL3', 'PRIO3', 'CMIG4', 'TAEE11', 'EGIE3', 'VIVT3', 'SBSP3', 'KLBN11', 'CPLE6', 'GGBR4', 'RADL3', 'CXSE3'];
const MARKET_TYPES = ['Ações', 'Fundos imobiliários', 'Fundos'];
const TICKER = /^[A-Z]{4}\d{1,2}F?$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const spNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, h: +p.hour + +p.minute / 60, wd: p.weekday };
};

class BrapiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ── brapi ── */
async function brapi(path, params = {}, attempt = 0) {
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Accept: 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) } });
  if (res.status === 429) {
    const wait = Math.min(num(res.headers.get('retry-after')) ?? 30, 120);
    if (attempt < 2) { console.warn(`429: aguardando ${wait}s (Retry-After)`); await sleep(wait * 1000); return brapi(path, params, attempt + 1); }
    throw new BrapiError(429, 'Limite de consultas da brapi atingido (429)');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new BrapiError(401, TOKEN ? 'Chave BRAPI_TOKEN inválida ou expirada (401)' : 'Sem BRAPI_TOKEN: só PETR4, VALE3, MGLU3 e ITUB4 (401)');
  if (res.status === 403) throw new BrapiError(403, body.message || 'Seu plano da brapi não inclui este dado (403)');
  if (res.status === 404) throw new BrapiError(404, body.message || 'Ativo não encontrado (404)');
  if (!res.ok) throw new BrapiError(res.status, body.message || `Erro ${res.status} na brapi`);
  return body;
}

/** GET /api/v2/stocks/quote?symbols=A,B,C — em blocos; um ticker inválido não derruba os outros */
async function quotes(tickers) {
  const out = {}, notFound = [];
  const put = r => {
    const d = r?.data, price = num(d?.regularMarketPrice);
    if (!r?.requestedSymbol || price == null) { if (r?.requestedSymbol) notFound.push(r.requestedSymbol); return; }
    out[r.requestedSymbol] = {
      price, chg: num(d.regularMarketChangePercent) ?? 0, name: d.shortName || d.longName || r.symbol,
      hi52: num(d.fiftyTwoWeekHigh), lo52: num(d.fiftyTwoWeekLow), prev: num(d.regularMarketPreviousClose),
      logo: d.logourl || null, time: d.regularMarketTime || null, symbol: r.symbol, at: new Date().toISOString()
    };
  };
  for (let i = 0; i < tickers.length; i += 10) {
    const chunk = tickers.slice(i, i + 10);
    try { (await brapi('/api/v2/stocks/quote', { symbols: chunk.join(',') })).results?.forEach(put); }
    catch (e) {
      if (e.status === 401 || e.status === 429) throw e;
      if (chunk.length === 1) { notFound.push(chunk[0]); continue; }
      for (const t of chunk) {   // 404/403 no bloco: tenta um a um
        try { (await brapi('/api/v2/stocks/quote', { symbols: t })).results?.forEach(put); }
        catch (e2) { if (e2.status === 401 || e2.status === 429) throw e2; notFound.push(t); }
      }
    }
  }
  return { out, notFound: [...new Set(notFound)] };
}

/** Radar: com P/L (screener, planos pagos) ou só pelo desconto em relação à máxima de 52 semanas (plano grátis) */
async function radar() {
  let universe = RADAR_BASE, pl = {};
  if (TOKEN) {
    try {
      const r = await brapi('/api/v2/stocks/screener', { trailingPEMin: 0, trailingPEMax: 25, sortBy: 'marketCap', sortOrder: 'desc', limit: 40 });
      const list = (r.results || []).filter(x => TICKER.test(x.symbol) && num(x.metrics?.trailingPE) > 0);
      if (list.length >= 5) { universe = list.map(x => x.symbol); list.forEach(x => pl[x.symbol] = num(x.metrics.trailingPE)); }
    } catch (e) { if (e.status !== 403) console.warn('screener:', e.message); }
  } else universe = SANDBOX;
  const { out } = await quotes(universe);
  const rows = Object.entries(out).map(([t, q]) => ({ t, ...q, pl: pl[t] ?? null, desc: q.hi52 ? 1 - q.price / q.hi52 : null })).filter(x => x.desc != null);
  if (!rows.length) return null;
  const withPL = rows.some(x => x.pl != null);
  const rank = f => Object.fromEntries([...rows].sort(f).map((x, i) => [x.t, i]));
  const rD = rank((a, b) => b.desc - a.desc), rP = withPL ? rank((a, b) => (a.pl ?? 1e9) - (b.pl ?? 1e9)) : null;
  const items = rows.map(x => ({ ...x, score: rD[x.t] + (rP ? rP[x.t] : 0) })).sort((a, b) => a.score - b.score).slice(0, 5)
    .map(({ t, name, price, chg, pl, desc, logo }) => ({ t, name, price, chg, pl, desc, logo }));
  return { day: spNow().day, at: new Date().toISOString(), items, n: rows.length, crit: withPL ? 'pl+desconto' : 'desconto' };
}

/* ── Firebase (REST) ── */
async function fb(path, method = 'GET', body) {
  const res = await fetch(`${DB}/${path}.json`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Firebase ${method} ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}
/** tickers das carteiras (dados principais + contas com dados separados) e das listas "Acompanhando" */
async function collectTickers() {
  const set = new Set();
  const scan = (inv, watch) => {
    Object.values(inv || {}).forEach(i => {
      let t = String(i?.ticker || '').toUpperCase();
      if (!t && MARKET_TYPES.includes(i?.tipo)) t = String(i?.nome || '').toUpperCase().match(/\b([A-Z]{4}\d{1,2}F?)\b/)?.[1] || '';
      if (TICKER.test(t)) set.add(t);
    });
    Object.keys(watch || {}).forEach(t => TICKER.test(t) && set.add(t));
  };
  scan(await fb('Investimentos'), await fb('config/alerts/watch'));
  const users = await fb('usuarios', 'GET').catch(() => null);
  for (const id of Object.keys(users || {})) scan(users[id]?.Investimentos, users[id]?.config?.alerts?.watch);
  return [...set];
}

/* ── principal ── */
async function main() {
  const now = spNow(), pregao = !['Sat', 'Sun'].includes(now.wd) && now.h >= 9.9 && now.h <= 18.9;
  if (!pregao && !FORCE && !ONLY.length) { console.log('Fora do horário do pregão; nada a fazer.'); return; }
  console.log(`Modo: ${TOKEN ? 'com BRAPI_TOKEN' : 'sem chave (sandbox)'} · ${now.day} ${now.h.toFixed(2)}h`);

  let tickers = ONLY.length ? ONLY : await collectTickers();
  if (!TOKEN) tickers = tickers.filter(t => SANDBOX.includes(t));
  const status = { at: new Date().toISOString(), mode: TOKEN ? 'token' : 'sandbox', tickers: tickers.length, ok: true, error: null, notFound: [] };
  const patch = {};
  try {
    if (tickers.length) {
      const { out, notFound } = await quotes(tickers);
      Object.entries(out).forEach(([t, q]) => patch[`cotacoes/${t}`] = q);
      status.notFound = notFound;
      console.log(JSON.stringify(out, null, 2));
      if (notFound.length) console.warn('Não encontrados:', notFound.join(', '));
    }
    const cur = ONLY.length ? null : await fb('mercado/radar').catch(() => null);
    if (!ONLY.length && cur?.day !== now.day && now.h >= 10.5 && !['Sat', 'Sun'].includes(now.wd)) {
      const r = await radar(); if (r) { patch.radar = r; console.log('Radar:', r.items.map(x => x.t).join(', '), `(${r.crit})`); }
    }
  } catch (e) {
    status.ok = false; status.error = e.message; console.error('Erro:', e.message);
  }
  patch.status = status;
  if (DRY) { console.log('[dry] não gravou no Firebase'); return; }
  await fb('mercado', 'PATCH', patch);
  console.log(`Gravado em /mercado: ${Object.keys(patch).filter(k => k.startsWith('cotacoes/')).length} cotação(ões).`);
  if (!status.ok) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
