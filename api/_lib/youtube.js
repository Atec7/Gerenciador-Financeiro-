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

/* várias TVs: { telas: [{ screenId, nome, deviceId, samsung }], ativa: screenId } (migra o formato antigo de uma TV só) */
async function carregar() {
  const c = await load('yt');
  if (!c) return { telas: [], ativa: null };
  if (c.screenId && !c.telas) return { telas: [{ screenId: c.screenId, nome: c.nome || 'TV', deviceId: c.deviceId, samsung: true }], ativa: c.screenId };
  return { telas: c.telas || [], ativa: c.ativa || c.telas?.[0]?.screenId || null };
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export async function telas() { const c = await carregar(); return { telas: c.telas.map(t => t.nome), ativa: c.telas.find(t => t.screenId === c.ativa)?.nome || null }; }
/** escolhe a TV ativa pelo nome ("quarto", "sala", "a do meu amigo") ou pela posição ("segunda") */
export async function escolher(nome) {
  const c = await carregar(); if (!c.telas.length) throw Object.assign(new Error('Nenhuma TV vinculada ao YouTube ainda.'), { setup: 'youtube' });
  const n = norm(nome).replace(/^(a |o )?(tv|televisao) (da|do|de) /, '').replace(/^(a |o )/, '');
  const pos = { primeira: 0, '1': 0, segunda: 1, '2': 1, terceira: 2, '3': 2, quarta: 3, '4': 3 }[n];
  const t = c.telas[pos] || c.telas.find(x => norm(x.nome) === n) || c.telas.find(x => norm(x.nome).includes(n) || n.includes(norm(x.nome)));
  if (!t) throw new Error(`Não achei a TV "${nome}". As que eu conheço são: ${c.telas.map(x => x.nome).join(', ')}.`);
  await save('yt', { telas: c.telas, ativa: t.screenId });
  return t.nome;
}
export async function remover(nome) {
  const c = await carregar(); const n = norm(nome);
  const resto = c.telas.filter(x => !(norm(x.nome) === n || norm(x.nome).includes(n)));
  if (resto.length === c.telas.length) throw new Error(`Não achei a TV "${nome}".`);
  await save('yt', { telas: resto, ativa: resto.some(x => x.screenId === c.ativa) ? c.ativa : resto[0]?.screenId || null });
}

/** pareia com o código de 12 números mostrado no YouTube da TV (qualquer marca); vira a TV ativa */
export async function pair(codigo, apelido) {
  const code = String(codigo || '').replace(/\D/g, '');
  if (code.length < 10) throw new Error('O código tem 12 números. Ele aparece no YouTube da TV, em Configurações, Vincular com código de TV.');
  const res = await post(`${BASE}/pairing/get_screen`, { pairing_code: code });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.screen?.screenId) throw new Error('O YouTube não aceitou esse código. Ele muda a cada poucos minutos: gere outro na TV e tente de novo.');
  const c = await carregar(), id = j.screen.screenId;
  const nome = String(apelido || '').trim() || j.screen.name || `TV ${c.telas.length + 1}`;
  const tela = { screenId: id, nome, deviceId: c.telas.find(t => t.screenId === id)?.deviceId || crypto.randomUUID(), samsung: /samsung/i.test(`${j.screen.name} ${apelido || ''}`) };
  await save('yt', { telas: [...c.telas.filter(t => t.screenId !== id), tela], ativa: id });
  return nome;
}
export async function configured() { const c = await carregar(); return c.telas.length > 0; }

/** abre uma sessão de controle: token novo → conecta → devolve função para mandar comandos */
async function session() {
  const c = await carregar(), cfg = c.telas.find(t => t.screenId === c.ativa) || c.telas[0];
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
  return { cmd, telaOnline, tela: cfg };
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
export async function telaDisponivel() { try { const s = await session(); return { online: s.telaOnline, nome: s.tela.nome, samsung: !!s.tela.samsung }; } catch (e) { if (e.setup) throw e; return { online: false }; } }

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
