/* Guarda as credenciais do assistente no Firebase do app, CRIPTOGRAFADAS (AES-256-GCM)
   com uma chave derivada da senha do assistente. Quem ler o banco vê só texto embaralhado.
   A senha vem da variável ASSISTENTE_SENHA na Vercel ou, se ela não existir, é conferida contra
   SENHA_HASH abaixo — só a "impressão digital" (scrypt) da senha fica no código, nunca a senha. */
import crypto from 'node:crypto';

const DB = (process.env.FIREBASE_DB_URL || 'https://sistema-financeiro-51295-default-rtdb.firebaseio.com').replace(/\/$/, '');
const ROOT = 'assistente';

const SENHA_HASH = '58dbd8243903f812b3bd20bc8533feb8381acc80a44fc89b95113f4541c6934c';
const HASH_OPTS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let reqSenha = ''; // senha já conferida da requisição atual (deriva a chave de criptografia)

export const configured = () => !!((process.env.ASSISTENTE_SENHA || '').trim() || SENHA_HASH);
const key = () => crypto.scryptSync(reqSenha, 'fin-assistente-v1', 32);

export function encrypt(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
export function decrypt(s) {
  if (!s) return null;
  try {
    const [iv, tag, data] = s.split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
  } catch { return null; } // senha trocada ou dado corrompido
}

async function fb(path, method = 'GET', body) {
  const res = await fetch(`${DB}/${ROOT}/${path}.json`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`Firebase ${res.status}`);
  return res.json();
}
export async function load(name) { return decrypt(await fb(name)); }
export async function save(name, obj) { await fb(name, 'PUT', obj == null ? null : encrypt(obj)); }

/** confere a senha enviada pelo app (sem vazar tempo); se certa, ela vira a chave desta requisição */
export function checkSenha(s) {
  s = String(s || '').trim(); reqSenha = '';
  if (!s) return false;
  const env = (process.env.ASSISTENTE_SENHA || '').trim();
  let ok;
  if (env) { const a = Buffer.from(s), b = Buffer.from(env); ok = a.length === b.length && crypto.timingSafeEqual(a, b); }
  else ok = crypto.timingSafeEqual(crypto.scryptSync(s, 'fin-assistente-senha-v1', 32, HASH_OPTS), Buffer.from(SENHA_HASH, 'hex'));
  if (ok) reqSenha = s;
  return ok;
}
export const hmac = v => crypto.createHmac('sha256', key()).update(String(v)).digest('base64url');
