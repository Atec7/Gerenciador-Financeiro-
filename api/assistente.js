/* Servidor do Assistente Pessoal (função da Vercel).
   O app de voz (/assistente/) manda comandos já interpretados para cá; daqui saem as chamadas
   para a SmartThings (TV Samsung) e para a nuvem do Gree+ (ar-condicionado).
   Toda chamada exige a senha do assistente (variável ASSISTENTE_SENHA na Vercel). */
import * as ST from './_lib/smartthings.js';
import * as Gree from './_lib/gree.js';
import { checkSenha, senha, hmac } from './_lib/store.js';

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
    return res.json({ ok: true, assistente: true, senhaConfigurada: !!senha() });
  }
  if (!senha()) return res.status(500).json({ ok: false, erro: 'Falta configurar a variável ASSISTENTE_SENHA na Vercel.', setup: 'senha-vercel' });
  const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
  const acao = q.acao || b.acao;

  // volta do login da Samsung (não tem a senha, mas traz um "state" assinado)
  if (acao === 'st-callback') {
    if (q.error) return html(res, 400, 'TV não conectada', `A Samsung respondeu: ${String(q.error_description || q.error)}`);
    const [nonce, sig] = String(q.state || '').split('.');
    if (!nonce || sig !== hmac(nonce) || Date.now() - Number(nonce) > 30 * 60e3) return html(res, 400, 'Link expirado', 'Comece a conexão da TV de novo pelo assistente.');
    try { const tv = await ST.callback(String(q.code || ''), host(req)); res.status(302).setHeader('Location', `/assistente/?conectado=tv&nome=${encodeURIComponent(tv?.nome || '')}`).end(); }
    catch (e) { html(res, 500, 'TV não conectada', e.message); }
    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST' });
  if (!checkSenha(req.headers['x-senha'] || b.senha)) return res.status(401).json({ ok: false, erro: 'Senha do assistente incorreta.' });

  try {
    switch (acao) {
      case 'status': {
        const [tv, ar] = await Promise.all([ST.configured().catch(() => false), Gree.configured().catch(() => false)]);
        return res.json({ ok: true, tv, ar });
      }
      case 'st-setup': {
        if (!b.pat) throw new Error('Cole o token da SmartThings.');
        const nonce = String(Date.now());
        return res.json({ ok: true, url: await ST.setup(String(b.pat).trim(), host(req), `${nonce}.${hmac(nonce)}`) });
      }
      case 'gree-setup': {
        if (!b.email || !b.password) throw new Error('Informe o e-mail e a senha do Gree+.');
        return res.json({ ok: true, ...(await Gree.setup(String(b.email).trim(), String(b.password), b.regiao || 'South American')) });
      }
      case 'cmd': {
        const c = b.cmd || {};
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
