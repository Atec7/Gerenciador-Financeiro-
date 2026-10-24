/* TV Samsung pela SmartThings (API oficial).
   Os tokens pessoais (PAT) expiram em 24h, então usamos um app OAuth próprio:
   1) setup(pat): com um PAT criado pelo usuário, cria o app OAuth na conta dele (uma vez)
   2) o usuário autoriza no site da Samsung → callback troca o código por tokens
   3) os tokens são renovados sozinhos (refresh token) a cada uso */
import { load, save } from './store.js';

const API = 'https://api.smartthings.com';
const SCOPES = ['r:devices:*', 'x:devices:*', 'r:locations:*'];

async function st(path, { method = 'GET', token, body, form, basic } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (basic) headers.Authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
  if (body) headers['Content-Type'] = 'application/json';
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined });
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.message || (typeof data === 'string' ? data.slice(0, 200) : '') || `HTTP ${res.status}`;
    throw Object.assign(new Error(`SmartThings: ${msg}`), { status: res.status });
  }
  return data;
}

export const redirectUri = host => `https://${host}/api/assistente?acao=st-callback`;

/** cria o app OAuth na conta SmartThings do usuário usando um PAT (válido 24h; só é usado aqui) */
export async function setup(pat, host, state) {
  // já existe o app OAuth desta conta: só refaz a autorização (não precisa criar outro)
  const old = await load('st');
  if (old?.clientId && (!old.host || old.host === host)) { if (!old.host) await save('st', { ...old, host }); return authorizeUrl(old.clientId, host, state); }
  const suffix = Math.random().toString(36).slice(2, 8);
  const app = await st('/apps', {
    method: 'POST', token: pat, body: {
      appName: `assistente-pessoal-${suffix}`, displayName: 'Assistente Pessoal', description: 'Controle da TV pelo assistente de voz',
      singleInstance: true, appType: 'API_ONLY', classifications: ['CONNECTED_SERVICE'], principalType: 'LOCATION',
      apiOnly: {}, oauth: { clientName: 'Assistente Pessoal', scope: SCOPES, redirectUris: [redirectUri(host)] }
    }
  });
  if (!app?.oauthClientId) throw new Error('A SmartThings não devolveu as credenciais do app. Confira se o token tem a permissão "Apps".');
  await save('st', { clientId: app.oauthClientId, clientSecret: app.oauthClientSecret, appId: app.app?.appId, host });
  return authorizeUrl(app.oauthClientId, host, state);
}
export const authorizeUrl = (clientId, host, state = '') =>
  `${API}/oauth/authorize?${new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri(host), scope: SCOPES.join(' '), state })}`;

export async function callback(code, host) {
  const cfg = await load('st'); if (!cfg?.clientId) throw new Error('Configure a TV de novo pelo app.');
  const t = await st('/oauth/token', { method: 'POST', basic: `${cfg.clientId}:${cfg.clientSecret}`, form: { grant_type: 'authorization_code', code, client_id: cfg.clientId, redirect_uri: redirectUri(host) } });
  const next = { ...cfg, access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 86400) * 1000 };
  next.tv = await findTv(next.access);
  await save('st', next);
  return next.tv;
}

async function token() {
  const cfg = await load('st');
  if (!cfg?.refresh) throw Object.assign(new Error('A TV ainda não foi conectada. Abra as configurações do assistente.'), { setup: 'tv' });
  if (cfg.access && cfg.exp - Date.now() > 5 * 60e3) return cfg;
  const t = await st('/oauth/token', { method: 'POST', basic: `${cfg.clientId}:${cfg.clientSecret}`, form: { grant_type: 'refresh_token', client_id: cfg.clientId, refresh_token: cfg.refresh } })
    .catch(e => { throw Object.assign(new Error(e.status === 401 || e.status === 400 ? 'A autorização da Samsung expirou. Conecte a TV de novo nas configurações.' : e.message), { setup: 'tv' }); });
  const next = { ...cfg, access: t.access_token, refresh: t.refresh_token || cfg.refresh, exp: Date.now() + (t.expires_in || 86400) * 1000 };
  await save('st', next);
  return next;
}

/** primeira TV da conta (tem capacidade de canal/entrada ou nome com "TV") */
async function findTv(access) {
  const { items = [] } = await st('/v1/devices', { token: access });
  const caps = d => (d.components || []).flatMap(c => (c.capabilities || []).map(x => x.id));
  const tv = items.find(d => caps(d).includes('tvChannel') || caps(d).includes('samsungvd.mediaInputSource') || d.ocf?.ocfDeviceType === 'oic.d.tv')
    || items.find(d => /tv/i.test(`${d.label} ${d.name}`) && caps(d).includes('switch'));
  return tv ? { id: tv.deviceId, nome: tv.label || tv.name } : null;
}

export const APPS = {
  netflix: '3201907018807', youtube: '111299001912', prime: '3201910019365', disney: '3201901017640', spotify: '3201606009684',
  globoplay: '3201908019041', appletv: '3201807016597', max: '3202301029760', pluto: '3201808016802', deezer: '3201608010191', twitch: '3202203026841'
};
/* teclas do controle remoto (capacidade samsungvd.remoteControl) */
const TECLAS = { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', OK: 'OK', BACK: 'BACK', HOME: 'HOME', MENU: 'MENU' };

/** traduz o comando do app para comandos SmartThings */
export function commandsFor(c) {
  const k = (capability, command, args) => ({ component: 'main', capability, command, ...(args ? { arguments: args } : {}) });
  switch (c.acao) {
    case 'ligar': return [k('switch', 'on')];
    case 'desligar': return [k('switch', 'off')];
    case 'volume': return [k('audioVolume', 'setVolume', [Math.max(0, Math.min(100, Math.round(c.valor)))])];
    case 'volume+': return Array.from({ length: c.vezes || 3 }, () => k('audioVolume', 'volumeUp'));
    case 'volume-': return Array.from({ length: c.vezes || 3 }, () => k('audioVolume', 'volumeDown'));
    case 'mudo': return [k('audioMute', 'mute')];
    case 'som': return [k('audioMute', 'unmute')];
    case 'canal': return [k('tvChannel', 'setTvChannel', [String(c.valor)])];
    case 'canal+': return [k('tvChannel', 'channelUp')];
    case 'canal-': return [k('tvChannel', 'channelDown')];
    case 'entrada': return [k('mediaInputSource', 'setInputSource', [String(c.valor).toUpperCase()])];
    case 'app': { const id = APPS[c.valor]; if (!id) throw new Error(`Não sei abrir "${c.valor}" na TV.`); return [k('custom.launchapp', 'launchApp', [id])]; }
    case 'tecla': { const t = TECLAS[c.valor]; if (!t) throw new Error('Tecla desconhecida.'); return Array.from({ length: Math.min(c.vezes || 1, 10) }, () => k('samsungvd.remoteControl', 'send', [t, 'PRESS_AND_RELEASED'])); }
    case 'play': return [k('mediaPlayback', 'play')];
    case 'pause': return [k('mediaPlayback', 'pause')];
    default: throw new Error('Comando de TV desconhecido.');
  }
}

export async function command(c) {
  const cfg = await token();
  if (!cfg.tv) { cfg.tv = await findTv(cfg.access); await save('st', cfg); }
  if (!cfg.tv) throw new Error('Não encontrei nenhuma TV na sua conta SmartThings. Adicione a TV no app SmartThings.');
  try {
    const commands = commandsFor(c);
    try { await st(`/v1/devices/${cfg.tv.id}/commands`, { method: 'POST', token: cfg.access, body: { commands } }); }
    catch (e1) {
      if (c.acao !== 'tecla' || e1.status !== 422) throw e1;
      await st(`/v1/devices/${cfg.tv.id}/commands`, { method: 'POST', token: cfg.access, body: { commands: commands.map(x => ({ ...x, arguments: [x.arguments[0]] })) } });
    }
  } catch (e) {
    if (e.status === 409 || e.status === 422 || /invalid device state|offline/i.test(e.message)) {
      const h = await saude(cfg).catch(() => null);
      if (h === 'OFFLINE') throw new Error(c.acao === 'ligar'
        ? 'A Samsung está vendo a TV desconectada, então não consigo ligar. Ligue pelo controle uma vez e ative, na TV, Configurações, Geral, Rede, Ligar com celular.'
        : 'A TV está desligada ou sem internet para a Samsung. Ligue a TV e confira se ela está no Wi-Fi. Depois tente de novo.');
      throw new Error(`A TV recusou esse comando agora (${c.acao}). Ela pode não ter esse recurso ou estar ocupada; tente de novo com a TV ligada.`);
    }
    throw e;
  }
  return cfg.tv.nome;
}

async function saude(cfg) { const h = await st(`/v1/devices/${cfg.tv.id}/health`, { token: cfg.access }); return h?.state || null; }

/** diagnóstico (sem dados sensíveis): saúde, capacidades e estado da TV */
export async function diag() {
  const cfg = await token(); const out = { tv: cfg.tv?.nome || null };
  if (!cfg.tv) { out.tvs = (await st('/v1/devices', { token: cfg.access })).items?.map(d => ({ nome: d.label || d.name, tipo: d.ocf?.ocfDeviceType || d.deviceTypeName })); return out; }
  out.saude = await saude(cfg).catch(e => `erro: ${e.message}`);
  const d = await st(`/v1/devices/${cfg.tv.id}`, { token: cfg.access }).catch(e => ({ erro: e.message }));
  out.modelo = d.ocf?.modelNumber || d.deviceTypeName || null; out.tipo = d.ocf?.ocfDeviceType || null;
  out.capacidades = (d.components || []).find(c => c.id === 'main')?.capabilities?.map(c => c.id) || [];
  const s = await st(`/v1/devices/${cfg.tv.id}/status`, { token: cfg.access }).catch(e => ({ erro: e.message }));
  const m = s?.components?.main || {};
  out.estado = { switch: m.switch?.switch?.value ?? null, volume: m.audioVolume?.volume?.value ?? null, entrada: m.mediaInputSource?.inputSource?.value ?? m['samsungvd.mediaInputSource']?.inputSource?.value ?? null };
  return out;
}
export async function status() {
  const cfg = await token();
  if (!cfg.tv) return null;
  const s = await st(`/v1/devices/${cfg.tv.id}/status`, { token: cfg.access });
  const m = s?.components?.main || {};
  return { nome: cfg.tv.nome, ligada: m.switch?.switch?.value === 'on', volume: m.audioVolume?.volume?.value ?? null, mudo: m.audioMute?.mute?.value === 'muted' };
}
export async function configured() { const c = await load('st'); return !!c?.refresh; }
