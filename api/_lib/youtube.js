/* YouTube na TV pela "Lounge API" — o mesmo canal que o celular usa para mandar vídeos para a TV.
   Pareamento único: no app YouTube da TV, Configurações → "Vincular com código de TV" → código de 12 números.
   Protocolo portado de pyytlounge (https://github.com/FabioGNR/pyytlounge). Funciona pela internet. */
import crypto from 'node:crypto';
import { load, save } from './store.js';

const BASE = 'https://www.youtube.com/api/lounge';
const NAME = 'Robô Assistente';
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
const post = (url, data, params) => fetch(params ? `${url}?${form(params)}` : url, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(data)
});

/** pareia com o código de 12 números mostrado no YouTube da TV */
export async function pair(codigo) {
  const code = String(codigo || '').replace(/\D/g, '');
  if (code.length < 10) throw new Error('O código tem 12 números. Ele aparece no YouTube da TV, em Configurações, Vincular com código de TV.');
  const res = await post(`${BASE}/pairing/get_screen`, { pairing_code: code });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.screen?.screenId) throw new Error('O YouTube não aceitou esse código. Ele muda a cada poucos minutos: gere outro na TV e tente de novo.');
  await save('yt', { screenId: j.screen.screenId, nome: j.screen.name, deviceId: crypto.randomUUID() });
  return j.screen.name || 'TV';
}
export async function configured() { const c = await load('yt'); return !!c?.screenId; }

/** abre uma sessão de controle: token novo → conecta → devolve função para mandar comandos */
async function session() {
  const cfg = await load('yt');
  if (!cfg?.screenId) throw Object.assign(new Error('O YouTube da TV ainda não está ligado a mim.'), { setup: 'youtube' });
  const tr = await post(`${BASE}/pairing/get_lounge_token_batch`, { screen_ids: cfg.screenId });
  const tj = await tr.json().catch(() => null), token = tj?.screens?.[0]?.loungeToken;
  if (!token) throw Object.assign(new Error('Perdi a ligação com o YouTube da TV. Vamos vincular de novo.'), { setup: 'youtube' });

  const cr = await post(`${BASE}/bc/bind?RID=1&VER=8&CVER=1&auth_failure_option=send_error`, {
    app: 'web', 'mdx-version': 3, name: NAME, id: cfg.deviceId, device: 'REMOTE_CONTROL', capabilities: 'que,dsdtr,atp,vsp',
    magnaKey: 'cloudPairedDevice', ui: 'false', deviceContext: 'user_agent=dunno&window_width_points=&window_height_points=&os_name=android&ms=',
    theme: 'cl', loungeIdToken: token
  });
  const text = await cr.text();
  if (cr.status === 401) throw Object.assign(new Error('O YouTube recusou a conexão. Vamos vincular de novo.'), { setup: 'youtube' });
  if (!cr.ok) throw new Error(`YouTube: erro ${cr.status}`);
  let sid = null, gsession = null, aid = null, telaOnline = false;
  for (const ev of parseChunks(text)) {
    const [id, [type, ...args]] = ev; aid = id;
    if (type === 'c') sid = args[0];
    else if (type === 'S') gsession = args[0];
    else if (type === 'loungeStatus') { try { telaOnline = JSON.parse(args[0].devices).some(d => d.type === 'LOUNGE_SCREEN'); } catch {} }
  }
  if (!sid) throw new Error('YouTube: não consegui abrir a sessão.');
  let ofs = 1;
  const cmd = async (name, params = {}) => {
    const body = { count: 1, ofs, req0__sc: name }; Object.entries(params).forEach(([k, v]) => body[`req0_${k}`] = v); ofs++;
    const r = await post(`${BASE}/bc/bind`, body, { name: NAME, loungeIdToken: token, SID: sid, AID: aid, gsessionid: gsession, device: 'REMOTE_CONTROL', app: 'youtube-desktop', VER: 8, v: 2, RID: ofs });
    if (!r.ok) throw new Error(`YouTube: o comando falhou (${r.status}).`);
  };
  return { cmd, telaOnline };
}
/* respostas vêm em blocos: uma linha com o tamanho e, nas seguintes, um JSON (lido até fechar) */
function parseChunks(text) {
  const out = [], lines = text.split('\n'); let buf = null;
  for (const line of lines) {
    if (buf === null) { if (/^\d+$/.test(line.trim())) buf = ''; continue; }
    buf += (buf ? '\n' : '') + line;
    try { JSON.parse(buf).forEach(e => out.push(e)); buf = null; } catch { /* JSON ainda incompleto */ }
  }
  return out;
}

/** está com o app YouTube aberto na TV? */
export async function telaDisponivel() { try { return (await session()).telaOnline; } catch (e) { if (e.setup) throw e; return false; } }

export async function play(videoId) { const s = await session(); await s.cmd('setPlaylist', { videoId, currentTime: 0, currentIndex: 0, videoIds: videoId }); return s.telaOnline; }
const SIMPLES = { pausar: 'pause', continuar: 'play', proximo: 'next', anterior: 'previous' };
export async function controle(acao) { if (!SIMPLES[acao]) throw new Error('Comando do YouTube desconhecido.'); const s = await session(); await s.cmd(SIMPLES[acao]); }

/** pesquisa no YouTube (sem chave de API): devolve o primeiro vídeo da busca */
export async function search(q) {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=pt-BR&gl=BR`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'CONSENT=YES+1' }
  });
  const html = await res.text();
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (m) {
    try {
      const found = []; const walk = o => { if (!o || typeof o !== 'object' || found.length >= 5) return; if (o.videoRenderer?.videoId) found.push(o.videoRenderer); else Object.values(o).forEach(walk); };
      walk(JSON.parse(m[1]));
      const v = found.find(x => !x.badges?.some(b => /live|ao vivo/i.test(JSON.stringify(b)))) || found[0];
      if (v) return { id: v.videoId, titulo: (v.title?.runs || []).map(r => r.text).join('') || q, canal: v.ownerText?.runs?.[0]?.text || '' };
    } catch { /* cai no plano B */ }
  }
  const id = html.match(/"videoId":"([\w-]{11})"/)?.[1];
  if (!id) throw new Error(`Não encontrei "${q}" no YouTube.`);
  return { id, titulo: q, canal: '' };
}
