/* Ar-condicionado Gree pela nuvem do app Gree+ (não oficial).
   Protocolo portado de https://github.com/davo22/greeclimate (cloud_api.py / mqtt_client.py / cipher.py):
   - login HTTPS em {regiao}grih.gree.com com corpo AES-128-ECB
   - lista casas e aparelhos (MAC + chave de cada aparelho)
   - comandos via MQTT (TLS, porta 1984) no tópico request/{mac}, payload criptografado com a chave do aparelho */
import crypto from 'node:crypto';
import mqtt from 'mqtt';
import { load, save } from './store.js';

export const REGIOES = {
  'South American': ['https://sagrih.gree.com', 'mqtt-sa.gree.com'],
  'Latin American': ['https://lagrih.gree.com', 'mqtt-la.gree.com'],
  'North American': ['https://nagrih.gree.com', 'mqtt-na.gree.com'],
  'Europe': ['https://eugrih.gree.com', 'mqtt-eu.gree.com'],
  'East South Asia': ['https://hkgrih.gree.com', 'mqtt-as.gree.com'],
  'Middle East': ['https://megrih.gree.com', 'mqtt-me.gree.com'],
  'India': ['https://ingrih.gree.com', 'mqtt-in.gree.com'],
  'Russia': ['https://rugrih.gree.com', 'mqtt-ru.gree.com'],
  'Australia': ['https://augrih.gree.com', 'mqtt-au.gree.com'],
  'China Mainland': ['https://grih.gree.com', 'mqtt.gree.com'],
};
const APP_ID = '4920681951525131286', APP_HASH = '0fa513124aa97781d1f3f40d61ca1a89', CLOUD_KEY = '#G$&^jgfujy6ujxt';
const MQTT_PORT = +(process.env.GREE_MQTT_PORT || 1984), MQTT_PROTO = process.env.GREE_MQTT_PROTO || 'mqtts';
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

/* AES-128-ECB: envio com PKCS7; na resposta do aparelho o preenchimento pode vir fora do padrão → corta após o último "}" */
export function ecbEncrypt(text, key) {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}
export function ecbDecrypt(b64, key, lenient = false) {
  const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  if (lenient) d.setAutoPadding(false);
  let s = Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  if (lenient) s = s.slice(0, s.lastIndexOf('}') + 1);
  return JSON.parse(s);
}

function body(payload, hashProps) {
  const now = new Date(), t = now.toISOString().slice(0, 19).replace('T', ' '), r = Math.floor(now.getTime() / 1000);
  return { api: { appId: APP_ID, r, t, vc: md5(`${APP_ID}_${APP_HASH}_${t}_${r}`) }, datVc: md5(`${APP_HASH}_${hashProps.map(p => String(payload[p])).join('_')}`), ...payload };
}
async function cloud(base, endpoint, data) {
  const res = await fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Gaen1: '5ac2bdf935bcca70', Charset: 'utf-8' },
    body: ecbEncrypt(JSON.stringify(data), CLOUD_KEY)
  });
  if (!res.ok) throw new Error(`Gree: HTTP ${res.status}`);
  const j = await res.json();
  if (!j?.enRes) throw new Error(`Gree: resposta inesperada${j?.msg ? ` (${j.msg})` : ''}`);
  return ecbDecrypt(j.enRes, CLOUD_KEY);
}

async function login(base, user, password) {
  const now = new Date(), t = now.toISOString().slice(0, 19).replace('T', ' ');
  const psw = md5(md5(md5(password) + password) + t);
  const d = await cloud(base, '/App/UserLoginV2', body({ psw, t, user }, ['user', 'psw', 't']));
  if (d.r && d.r !== 200) throw new Error(`Login no Gree+ falhou: ${d.msg || d.r}`);
  const uid = d.uid ?? d.data?.uid, token = d.token ?? d.data?.token;
  if (!uid || !token) throw new Error('Login no Gree+ falhou: resposta sem usuário/token');
  return { uid, token };
}
async function devices(base, uid, token) {
  const { home = [] } = await cloud(base, '/App/GetHomes', body({ token, uid }, ['token', 'uid']));
  const out = [];
  for (const h of home) {
    const d = await cloud(base, '/App/GetDevsInRoomsOfHomeV2', body({ token, homeId: h.id, uid }, ['token', 'uid', 'homeId']));
    for (const room of d.rooms || []) for (const dev of room.devs || [])
      out.push({ nome: String(dev.name || 'Ar').trim(), mac: String(dev.mac).trim(), key: String(dev.key).trim(), online: dev.online !== 0 });
  }
  // aparelhos repetidos com a mesma chave: fica o MAC terminado em "00" (o que responde)
  const byKey = {};
  out.forEach(d => (byKey[d.key] ||= []).push(d));
  return Object.values(byKey).flatMap(g => g.length === 1 ? g : (g.filter(d => d.mac.length > 12 && d.mac.endsWith('00')).length ? g.filter(d => d.mac.length > 12 && d.mac.endsWith('00')) : g));
}

/** conecta a conta Gree+; tenta a região escolhida e, se o usuário não existir lá, as da América */
export async function setup(email, password, regiao) {
  const tentativas = [regiao, 'South American', 'Latin American', 'North American'].filter((r, i, a) => r && REGIOES[r] && a.indexOf(r) === i);
  let lastErr;
  for (const r of tentativas) {
    try {
      const base = REGIOES[r][0], { uid, token } = await login(base, email, password);
      const devs = await devices(base, uid, token);
      await save('gree', { email, password, regiao: r, uid, token, devs });
      return { regiao: r, aparelhos: devs.map(d => d.nome) };
    } catch (e) { if (!lastErr || !/not exist|n[aã]o existe|not found/i.test(e.message)) lastErr = /not exist|n[aã]o existe|not found/i.test(e.message) && lastErr ? lastErr : e; }
  }
  if (!lastErr || /not exist|n[aã]o existe|not found/i.test(lastErr.message)) throw new Error('Conta não encontrada no Gree+. Confira o e-mail e a região escolhida no app Gree+.');
  throw lastErr;
}

const parentMac = mac => (mac.length > 12 && mac.endsWith('00') ? mac.slice(0, -2) : mac);

/** abre o MQTT, publica e espera a resposta do aparelho (alguns não respondem a comandos) */
function mqttRequest(cfg, dev, pack, { wait = 3000, needReply = false } = {}) {
  return new Promise((resolve, reject) => {
    const host = REGIOES[cfg.regiao][1], parent = parentMac(dev.mac);
    const client = mqtt.connect(`${MQTT_PROTO}://${process.env.GREE_MQTT_HOST || host}:${MQTT_PORT}`, {
      username: String(cfg.uid), password: cfg.token, clientId: `app_${crypto.randomBytes(8).toString('hex')}`,
      protocolVersion: 4, clean: true, rejectUnauthorized: false, connectTimeout: 8000, reconnectPeriod: 0, keepalive: 30
    });
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); client.end(true); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => needReply ? finish(new Error('O ar não respondeu. Ele está ligado na tomada e no Wi-Fi?')) : finish(null, null), wait + 8000);
    client.on('error', e => finish(Object.assign(new Error(/auth|Not authorized|bad user/i.test(e.message) ? 'auth' : `Gree MQTT: ${e.message}`), { auth: /auth|Not authorized|bad user/i.test(e.message) })));
    client.on('connect', () => {
      client.subscribe([`response/${parent}/#`, `status/${parent}/#`], { qos: 1 }, err => {
        if (err) return finish(err);
        const msg = { cid: String(1e9 + Math.floor(Math.random() * 9e9)), i: 0, pack: ecbEncrypt(JSON.stringify(pack), dev.key), t: 'pack', tcid: dev.mac, uid: cfg.uid };
        client.publish(`request/${parent}`, JSON.stringify(msg), { qos: 1 }, e2 => {
          if (e2) return finish(e2);
          if (!needReply) setTimeout(() => finish(null, null), wait);
        });
      });
    });
    client.on('message', (topic, payload) => {
      try {
        const m = JSON.parse(payload.toString());
        if (!m.pack) return;
        const d = ecbDecrypt(m.pack, dev.key, true);
        if (d.t === 'dat' && Array.isArray(d.cols)) return finish(null, Object.fromEntries(d.cols.map((c, i) => [c, d.dat?.[i]])));
        if (d.t === 'res' && !needReply) return finish(null, d);
      } catch { /* mensagem de outro tipo */ }
    });
  });
}

async function withLogin(fn) {
  let cfg = await load('gree');
  if (!cfg?.uid) throw Object.assign(new Error('O ar ainda não foi conectado. Abra as configurações do assistente.'), { setup: 'ar' });
  const dev = cfg.devs?.[0];
  if (!dev) throw new Error('Nenhum ar-condicionado encontrado na sua conta Gree+.');
  try { return await fn(cfg, dev); }
  catch (e) {
    if (!e.auth) throw e;
    // token expirado: entra de novo com a senha guardada (criptografada) e repete
    const base = REGIOES[cfg.regiao][0], { uid, token } = await login(base, cfg.email, cfg.password);
    cfg = { ...cfg, uid, token }; await save('gree', cfg);
    return fn(cfg, dev);
  }
}

const MODOS = { auto: 0, frio: 1, seco: 2, ventilar: 3, quente: 4 };
const VELOC = { auto: 0, baixa: 1, media: 3, alta: 5 };
/** comando do app → { opt, p } do protocolo Gree */
export function packFor(c) {
  const o = [], p = [];
  const set = (k, v) => { o.push(k); p.push(v); };
  switch (c.acao) {
    case 'ligar': set('Pow', 1); break;
    case 'desligar': set('Pow', 0); break;
    case 'temperatura': set('Pow', 1); set('SetTem', Math.max(16, Math.min(30, Math.round(c.valor)))); set('TemUn', 0); break;
    case 'modo': if (!(c.valor in MODOS)) throw new Error('Modo desconhecido.'); set('Pow', 1); set('Mod', MODOS[c.valor]); break;
    case 'ventilacao': if (!(c.valor in VELOC)) throw new Error('Velocidade desconhecida.'); set('WdSpd', VELOC[c.valor]); break;
    default: throw new Error('Comando de ar desconhecido.');
  }
  return { t: 'cmd', opt: o, p };
}

export async function command(c) {
  return withLogin(async (cfg, dev) => { await mqttRequest(cfg, dev, packFor(c)); return dev.nome; });
}
export async function status() {
  return withLogin(async (cfg, dev) => {
    const s = await mqttRequest(cfg, dev, { t: 'status', cols: ['Pow', 'Mod', 'SetTem', 'TemSen', 'WdSpd'] }, { needReply: true });
    const modo = Object.keys(MODOS).find(k => MODOS[k] === s?.Mod);
    return { nome: dev.nome, ligado: s?.Pow === 1, temperatura: s?.SetTem ?? null, ambiente: s?.TemSen != null ? s.TemSen - 40 : null, modo };
  });
}
export async function configured() { const c = await load('gree'); return !!c?.uid; }
