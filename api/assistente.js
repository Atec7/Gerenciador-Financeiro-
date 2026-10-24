/* Servidor do Assistente Pessoal (função da Vercel).
   O app de voz (/assistente/) manda comandos já interpretados para cá; daqui saem as chamadas
   para a SmartThings (TV Samsung) e para a nuvem do Gree+ (ar-condicionado).
   Toda chamada exige a senha do assistente (variável ASSISTENTE_SENHA na Vercel). */
import * as ST from './_lib/smartthings.js';
import * as Gree from './_lib/gree.js';
import * as YT from './_lib/youtube.js';
import { checkSenha, configured, hmac } from './_lib/store.js';

const host = req => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
const html = (res, status, title, msg) => res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8')
  .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:system-ui;padding:32px;max-width:480px;margin:auto;line-height:1.5"><h2>${title}</h2><p>${msg}</p><p><a href="/assistente/">Voltar ao assistente</a></p></body>`);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  // "ping": o robô (aberto no GitHub Pages durante a configuração) confere se o servidor existe — sem dados sensíveis
  if (q.acao === 'ping' || req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return res.json({ ok: true, assistente: true, senhaConfigurada: configured() });
  }
  if (!configured()) return res.status(500).json({ ok: false, erro: 'Falta configurar a variável ASSISTENTE_SENHA na Vercel.', setup: 'senha-vercel' });
  const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
  const acao = q.acao || b.acao;

  // volta do login da Samsung (não tem a senha, mas traz um "state" assinado)
  // volta do login da Samsung: repassa o código ao robô, que conclui a conexão enviando a senha
  // (a Samsung pode descartar o ?acao= do endereço de retorno e devolver só ?code=&state=)
  if (acao === 'st-callback' || (req.method === 'GET' && !acao && (q.code || q.error))) {
    if (q.error) return html(res, 400, 'TV não conectada', `A Samsung respondeu: ${String(q.error_description || q.error)}`);
    return res.status(302).setHeader('Location', `/assistente/?st_code=${encodeURIComponent(String(q.code || ''))}&st_state=${encodeURIComponent(String(q.state || ''))}`).end();
  }

  // diagnóstico do ar (GET, com a senha): mostra cada etapa até o aparelho, sem dados sensíveis
  if (acao === 'diag-ar') {
    if (!checkSenha(req.headers['x-senha'] || q.senha)) { await new Promise(r => setTimeout(r, 1500)); return res.status(401).json({ ok: false, erro: 'Senha incorreta.' }); }
    const t0 = Date.now();
    const limite = new Promise(r => setTimeout(() => r({ erro: 'diagnóstico passou de 55 s' }), 55000));
    let r;
    try { r = { ok: true, ...(await Promise.race([Gree.diag({ testar: q.testar === '1', servidor: Number(q.servidor) || 0, ouvir: q.ouvir === '1' }), limite])) }; }
    catch (e) { r = { ok: false, erro: e.message, onde: String(e.stack || '').split('\n').slice(0, 3).join(' | ') }; }
    r.msTotal = Date.now() - t0; r.em = new Date().toISOString();
    // guarda o resultado (sem dados sensíveis) para leitura posterior em /assistente/diag
    await fetch(`${(process.env.FIREBASE_DB_URL || 'https://sistema-financeiro-51295-default-rtdb.firebaseio.com').replace(/\/$/, '')}/assistente/diag.json`, { method: 'PUT', body: JSON.stringify(r) }).catch(() => {});
    return res.json(r);
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST' });
  if (!checkSenha(req.headers['x-senha'] || b.senha)) { await new Promise(r => setTimeout(r, 1500)); return res.status(401).json({ ok: false, erro: 'Senha do assistente incorreta.' }); }

  try {
    switch (acao) {
      case 'status': {
        const [tv, ar, youtube] = await Promise.all([ST.configured().catch(() => false), Gree.configured().catch(() => false), YT.configured().catch(() => false)]);
        return res.json({ ok: true, tv, ar, youtube });
      }
      case 'st-setup': {
        if (!b.pat) throw new Error('Cole o token da SmartThings.');
        const nonce = String(Date.now());
        return res.json({ ok: true, url: await ST.setup(String(b.pat).trim(), host(req), `${nonce}.${hmac(nonce)}`) });
      }
      case 'st-code': {
        const [nonce, sig] = String(b.state || '').split('.');
        if (!nonce || sig !== hmac(nonce) || Date.now() - Number(nonce) > 30 * 60e3) throw new Error('O login da Samsung expirou. Vamos conectar a TV de novo.');
        const tv = await ST.callback(String(b.code || ''), host(req));
        return res.json({ ok: true, tv });
      }
      case 'yt-pair': return res.json({ ok: true, nome: await YT.pair(b.codigo) });
      case 'gree-setup': {
        if (!b.email || !b.password) throw new Error('Informe o e-mail e a senha do Gree+.');
        return res.json({ ok: true, ...(await Gree.setup(String(b.email).trim(), String(b.password), b.regiao || 'South American')) });
      }
      case 'cmd': {
        const c = b.cmd || {};
        if (c.alvo === 'tv' && c.acao === 'youtube') {
          // pesquisa, garante o app YouTube aberto na TV e manda tocar
          const [video, aberto] = await Promise.all([YT.search(String(c.valor || '')), YT.telaDisponivel()]);
          if (!aberto) { await ST.command({ acao: 'app', valor: 'youtube' }).catch(() => {}); await new Promise(r => setTimeout(r, 9000)); }
          await YT.play(video.id);
          return res.json({ ok: true, video });
        }
        if (c.alvo === 'tv' && c.acao === 'yt') {
          try { await YT.controle(c.valor); }
          catch (e) { if (!e.setup || !['pausar', 'continuar'].includes(c.valor)) throw e; await ST.command({ acao: c.valor === 'pausar' ? 'pause' : 'play' }); }
          return res.json({ ok: true });
        }
        if (c.alvo === 'tv') return res.json({ ok: true, nome: await ST.command(c) });
        if (c.alvo === 'ar') return res.json({ ok: true, nome: await Gree.command(c) });
        throw new Error('Aparelho desconhecido.');
      }
      case 'estado': {
        if (b.alvo === 'tv') return res.json({ ok: true, estado: await ST.status() });
        if (b.alvo === 'ar') return res.json({ ok: true, estado: await Gree.status() });
        throw new Error('Aparelho desconhecido.');
      }
      default: throw new Error('Ação desconhecida.');
    }
  } catch (e) {
    console.error(acao, e);
    res.status(e.status === 401 ? 401 : 400).json({ ok: false, erro: e.message, setup: e.setup || null });
  }
}
