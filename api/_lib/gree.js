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

/* Cifra V2 (AES-128-GCM) — usada por aparelhos Gree mais novos; a V1 é AES-128-ECB */
const GCM_NONCE = Buffer.from([0x54, 0x40, 0x78, 0x44, 0x49, 0x67, 0x5a, 0x51, 0x6c, 0x5e, 0x63, 0x13]), GCM_AAD = Buffer.from('qualcomm-test');
export function gcmEncrypt(text, key) {
  const c = crypto.createCipheriv('aes-128-gcm', Buffer.from(key, 'utf8'), GCM_NONCE); c.setAAD(GCM_AAD);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { pack: enc.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
export function gcmDecrypt(b64, tag, key) {
  const d = crypto.createDecipheriv('aes-128-gcm', Buffer.from(key, 'utf8'), GCM_NONCE); d.setAAD(GCM_AAD);
  if (tag) d.setAuthTag(Buffer.from(tag, 'base64'));
  let s = d.update(Buffer.from(b64, 'base64')).toString('utf8');
  if (tag) d.final();
  return JSON.parse(s.slice(0, s.lastIndexOf('}') + 1));
}
const decodePack = (m, key) => {
  if (m.tag) return gcmDecrypt(m.pack, m.tag, key);
  try { return ecbDecrypt(m.pack, key, true); } catch { return gcmDecrypt(m.pack, null, key); }
};

/** Uma sessão MQTT curta: conecta, publica um ou mais pedidos e espera as respostas.
    Falha de verdade se não conseguir conectar (antes, um comando "sumia" sem aviso). */
function mqttSession(cfg, dev, run, { host, log } = {}) {
  return new Promise((resolve, reject) => {
    const h = process.env.GREE_MQTT_HOST || host || cfg.mqttHost || REGIOES[cfg.regiao][1], parent = parentMac(dev.mac);
    const t0 = Date.now(), L = (...a) => log?.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${a.join(' ')}`);
    const client = mqtt.connect(`${MQTT_PROTO}://${h}:${MQTT_PORT}`, {
      username: String(cfg.uid), password: cfg.token, clientId: `app_${crypto.randomBytes(8).toString('hex')}`,
      protocolVersion: 4, clean: true, rejectUnauthorized: false, connectTimeout: 8000, reconnectPeriod: 0, keepalive: 30
    });
    let done = false, connected = false;
    const waiters = [];
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { client.end(true); } catch {} err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(connected ? new Error('timeout') : Object.assign(new Error(`Não consegui conectar na nuvem da Gree (${h}).`), { noConnect: true })), 22000);
    client.on('error', e => { L('erro', e.message); const auth = /auth|Not authorized|bad user|password/i.test(e.message); finish(Object.assign(new Error(auth ? 'auth' : `Nuvem da Gree: ${e.message}`), { auth, noConnect: !connected })); });
    client.on('close', () => { if (!connected) L('conexão fechada antes de conectar'); else if (!done) L('conexão fechada pelo servidor'); });
    if (log) client.on('packetreceive', pk => { if (['puback', 'suback', 'connack'].includes(pk.cmd)) L('pacote', pk.cmd, pk.cmd === 'connack' ? `rc=${pk.returnCode ?? pk.reasonCode}` : `id=${pk.messageId}`); });
    client.on('message', (topic, payload) => {
      let m; try { m = JSON.parse(payload.toString()); } catch { L('msg', topic, '(não é JSON)'); return; }
      let d = null; if (m.pack) { try { d = decodePack(m, dev.key); } catch (e) { L('msg', topic, `t=${m.t}`, 'não decifrou', m.tag ? '(GCM)' : '(ECB)'); } }
      L('msg', topic.replace(parent, 'MAC'), `t=${m.t}`, d ? `→ ${d.t}${d.cols ? ` [${d.cols.length} campos]` : ''}${d.opt ? ` ${JSON.stringify(d.opt)}=${JSON.stringify(d.p)}` : ''}${d.r != null ? ` r=${d.r}` : ''}` : '',
        `campos:${Object.keys(m).filter(k => k !== 'pack').join(',')}`, m.tag ? 'GCM' : '', m.uid && m.uid !== cfg.uid ? 'de outro uid' : '');
      waiters.splice(0).forEach(w => w({ topic, m, d }));
    });
    client.on('connect', () => {
      connected = true; L('conectado em', h);
      const topics = log ? [`response/${parent}/#`, `status/${parent}/#`, `connect/${parent}`, `response/${parent}`, `status/${parent}`, `request/${parent}`, `response/${dev.mac}/#`]
                         : [`response/${parent}/#`, `status/${parent}/#`, `connect/${parent}`];
      const sub = t => new Promise(r => client.subscribe(t, { qos: 1 }, (err, g) => r(err ? `ERRO(${err.message})` : g?.[0]?.qos === 128 ? 'RECUSADA' : 'ok')));
      (async () => {
        const res = [];
        for (const t of topics) res.push(`${t.replace(parent, 'MAC')}=${await sub(t)}`);
        if (log) L('inscrições:', res.join(' | '));
        if (!client.connected) return finish(new Error('o servidor da Gree fechou a conexão nas inscrições'));
        const api = {
          send(pack, cipher = cfg.cipher || 1) {
            const enc = cipher === 2 ? gcmEncrypt(JSON.stringify(pack), dev.key) : { pack: ecbEncrypt(JSON.stringify(pack), dev.key) };
            const msg = { cid: String(1e9 + Math.floor(Math.random() * 9e9)), i: 0, ...enc, t: 'pack', tcid: dev.mac, uid: cfg.uid };
            L('enviando', pack.t, pack.opt ? JSON.stringify(pack.opt) + '=' + JSON.stringify(pack.p) : '', `cifra V${cipher}`);
            return new Promise((ok, ko) => client.publish(`request/${parent}`, JSON.stringify(msg), { qos: 1 }, e => e ? ko(e) : ok()));
          },
          /** espera uma mensagem decifrada que satisfaça o filtro */
          next(filter, ms) {
            return new Promise(res => {
              const to = setTimeout(() => res(null), ms);
              const w = x => { if (x.d && filter(x.d)) { clearTimeout(to); res(x.d); } else waiters.push(w); };
              waiters.push(w);
            });
          }
        };
        try { finish(null, await run(api)); } catch (e) { finish(e); }
      })();
    });
  });
}
const datToObj = d => Object.fromEntries(d.cols.map((c, i) => [c, d.dat?.[i]]));

/** lê o estado do aparelho; descobre sozinho a cifra (V1/V2) e guarda a que funcionou */
async function readState(cfg, dev, log) {
  return mqttSession(cfg, dev, async api => {
    for (const cipher of cfg.cipher ? [cfg.cipher, 3 - cfg.cipher] : [1, 2]) {
      await api.send({ t: 'status', cols: ['Pow', 'Mod', 'SetTem', 'TemSen', 'WdSpd'] }, cipher);
      const d = await api.next(x => x.t === 'dat' && Array.isArray(x.cols), 6000);
      if (d) { if (cfg.cipher !== cipher) { cfg.cipher = cipher; await save('gree', cfg); } return datToObj(d); }
    }
    return null;
  }, { log });
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
  return withLogin(async (cfg, dev) => {
    const r = await mqttSession(cfg, dev, async api => {
      await api.send(packFor(c));
      return api.next(x => x.t === 'res' || x.t === 'dat', 5000);
    });
    if (!r && !cfg.cipher) {
      // nenhuma resposta e cifra ainda desconhecida: descobre a cifra lendo o estado e reenvia
      const st = await readState(cfg, dev);
      if (!st) throw new Error('O ar não respondeu pela nuvem da Gree. Ele liga pelo app Gree+?');
      await mqttSession(cfg, dev, async api => { await api.send(packFor(c)); return api.next(x => x.t === 'res', 4000); });
    }
    return dev.nome;
  });
}
export async function status() {
  return withLogin(async (cfg, dev) => {
    const s = await readState(cfg, dev);
    if (!s) throw new Error('O ar não respondeu pela nuvem da Gree. Ele liga pelo app Gree+?');
    const modo = Object.keys(MODOS).find(k => MODOS[k] === s.Mod);
    return { nome: dev.nome, ligado: s.Pow === 1, temperatura: s.SetTem ?? null, ambiente: s.TemSen != null ? s.TemSen - 40 : null, modo };
  });
}
/** Diagnóstico passo a passo (sem dados sensíveis): login, conexão MQTT, leitura do estado nas duas cifras */
export async function diag({ testar = false, servidor = 0, ouvir = false } = {}) {
  const out = { passos: [] }, P = x => out.passos.push(x);
  let cfg = await load('gree');
  if (!cfg?.uid) return { ...out, erro: 'ar não configurado (ou senha diferente da usada na configuração)' };
  if (ouvir) {
    // só escuta o canal do ar por 40 s, enquanto a pessoa liga/desliga pelo app Gree+
    const log = [];
    try {
      const base = REGIOES[cfg.regiao][0], { uid, token } = await login(base, cfg.email, cfg.password);
      cfg = { ...cfg, uid, token }; await save('gree', cfg);
      await mqttSession(cfg, cfg.devs[0], api => new Promise(r => setTimeout(r, 40000)), { log });
    } catch (e) { log.push(`erro: ${e.message}`); }
    return { modo: 'ouvir 40 s', log };
  }
  out.regiao = cfg.regiao; out.cifraSalva = cfg.cipher || null;
  out.aparelhos = (cfg.devs || []).map(d => ({ nome: d.nome, online: d.online, macTam: d.mac.length, macFim00: d.mac.endsWith('00'), chaveTam: d.key.length }));
  if (servidor === 0) try {
    const base = REGIOES[cfg.regiao][0], { uid, token } = await login(base, cfg.email, cfg.password);
    cfg = { ...cfg, uid, token }; await save('gree', cfg); P('login: ok');
    const devs = await devices(base, uid, token);
    out.aparelhosAgora = devs.map(d => ({ nome: d.nome, online: d.online, macTam: d.mac.length, mudouMac: !cfg.devs.some(x => x.mac === d.mac) }));
    if (devs.length) { cfg.devs = devs; await save('gree', cfg); }
  } catch (e) { P(`login: ERRO ${e.message}`); return out; }
  const dev = cfg.devs[0];
  const hosts = [REGIOES[cfg.regiao][1], ...new Set(Object.values(REGIOES).map(r => r[1]))].filter((h, i, a) => a.indexOf(h) === i);
  out.servidores = hosts; out.testando = hosts[servidor] || hosts[0];
  for (const h of [hosts[servidor] || hosts[0]]) {
    const log = [];
    try {
      const st = await mqttSession(cfg, dev, async api => {
        for (const cipher of [1, 2]) {
          await api.send({ t: 'status', cols: ['Pow', 'Mod', 'SetTem', 'TemSen'] }, cipher);
          const d = await api.next(x => x.t === 'dat' && Array.isArray(x.cols), 5000);
          if (d) return { cipher, estado: datToObj(d) };
        }
        return null;
      }, { host: h, log });
      P({ mqtt: h, resultado: st ? `RESPONDEU com cifra V${st.cipher}` : 'conectou, mas o ar não respondeu', estado: st?.estado || null, log });
      if (st) {
        cfg.cipher = st.cipher; cfg.mqttHost = h; await save('gree', cfg);
        if (testar) { const lg = []; await mqttSession(cfg, dev, async api => { await api.send(packFor({ acao: 'ligar' }), st.cipher); return api.next(x => x.t === 'res', 5000); }, { host: h, log: lg }); P({ teste: 'ligar', log: lg }); }
        break;
      }
    } catch (e) { P({ mqtt: h, resultado: `ERRO ${e.message}`, log }); }
  }
  return out;
}
export async function configured() { const c = await load('gree'); return !!c?.uid; }
