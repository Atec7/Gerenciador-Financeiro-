/* Assistente Pessoal — microfone, interpretação (parser.js), chamadas ao servidor (/api/assistente) e resposta falada */
const $ = s => document.querySelector(s);
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const API = '/api/assistente';
const state = { senha: LS.get('as_senha', ''), speak: LS.get('as_speak', true), tv: false, ar: false, busy: false };

/* ── servidor ── */
async function api(body) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-senha': state.senha }, body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok || !data.ok) throw Object.assign(new Error(data.erro || (res.status === 404 ? 'Servidor do assistente não encontrado. Abra o app pelo endereço da Vercel.' : `Erro ${res.status}`)), { setup: data.setup, status: res.status });
  return data;
}

/* ── fala ── */
function say(text) {
  if (!state.speak || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'pt-BR'; u.rate = 1.03;
    const v = speechSynthesis.getVoices().find(v => /pt[-_]BR/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}

/* ── conversa ── */
function log(text, who = 'bot', err = false) {
  const li = document.createElement('li');
  li.className = `${who}${err ? ' err' : ''}`;
  li.innerHTML = `${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}<small>${new Date().toTimeString().slice(0, 5)}</small>`;
  $('#log').prepend(li);
  while ($('#log').children.length > 30) $('#log').lastChild.remove();
}
const answer = (text, err = false) => { log(text, 'bot', err); say(text); };

function describe(alvo, e) {
  if (!e) return alvo === 'tv' ? 'Não encontrei a TV.' : 'Não encontrei o ar.';
  if (alvo === 'tv') return `A TV está ${e.ligada ? 'ligada' : 'desligada'}${e.ligada && e.volume != null ? `, volume ${e.volume}` : ''}${e.mudo ? ', no mudo' : ''}.`;
  return e.ligado ? `O ar está ligado em ${e.temperatura} graus${e.modo ? `, modo ${({ frio: 'frio', quente: 'quente', seco: 'desumidificar', ventilar: 'ventilar', auto: 'automático' })[e.modo]}` : ''}${e.ambiente != null ? `. A temperatura ambiente é ${e.ambiente} graus` : ''}.` : `O ar está desligado${e.ambiente != null ? `. A temperatura ambiente é ${e.ambiente} graus` : ''}.`;
}

async function handle(text) {
  text = String(text || '').trim(); if (!text) return;
  log(text, 'me');
  const c = Comandos.parse(text);
  if (!c) return answer('Não entendi. Tente “liga a TV”, “ar em 22 graus” ou “volume 15”.', true);
  if (c.erro) return answer(c.erro, true);
  if (!state.senha) { answer('Antes, coloque a senha do assistente nas configurações.', true); return openCfg(); }
  setBusy(true);
  try {
    if (c.estado) { const { estado } = await api({ acao: 'estado', alvo: c.alvo }); answer(describe(c.alvo, estado)); }
    else { await api({ acao: 'cmd', cmd: c }); answer(Comandos.reply(c)); }
  } catch (e) {
    answer(e.message, true);
    if (e.setup || e.status === 401) openCfg();
  } finally { setBusy(false); }
}

/* ── microfone ── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
function setBusy(b) { state.busy = b; $('#mic').classList.toggle('busy', b); }
function listen() {
  if (state.busy) return;
  if (!SR) { $('#heard').textContent = 'Este navegador não reconhece voz. Use o Chrome (Android) ou Safari (iPhone), ou escreva o comando.'; return; }
  if (listening) { rec?.stop(); return; }
  speechSynthesis?.cancel();
  rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  let final = '';
  rec.onstart = () => { listening = true; $('#mic').classList.add('listening'); $('#heard').textContent = 'Ouvindo…'; $('#heard').classList.add('live'); };
  rec.onresult = e => {
    let interim = '';
    for (const r of e.results) (r.isFinal ? (final = r[0].transcript) : (interim += r[0].transcript));
    $('#heard').textContent = final || interim;
  };
  rec.onerror = e => { $('#heard').textContent = e.error === 'not-allowed' ? 'Libere o microfone para este site nas configurações do navegador.' : e.error === 'no-speech' ? 'Não ouvi nada. Toque e fale de novo.' : `Erro no microfone (${e.error}).`; };
  rec.onend = () => {
    listening = false; $('#mic').classList.remove('listening'); $('#heard').classList.remove('live');
    if (final) handle(final);
  };
  try { rec.start(); } catch {}
}

/* ── configurações ── */
function openCfg() { $('#senha').value = state.senha; $('#speak').checked = state.speak; if (!$('#cfg').open) $('#cfg').showModal(); }
function setStatus(id, text, ok) { const el = $(id); el.textContent = text; el.className = `status ${ok === true ? 'ok' : ok === false ? 'err' : ''}`; }
function renderDevices() {
  [['tv', state.tv, 'conectada', 'não conectada'], ['ar', state.ar, 'conectado', 'não conectado']].forEach(([k, on, a, b]) => {
    $(`#dev-${k}`).classList.toggle('on', !!on); $(`#dev-${k} small`).textContent = on ? a : b;
  });
}
async function refreshStatus() {
  if (!state.senha) { $('#hello').textContent = 'Comece pelas configurações (engrenagem).'; return; }
  try {
    const s = await api({ acao: 'status' }); state.tv = s.tv; state.ar = s.ar; renderDevices();
    setStatus('#st-senha', 'Senha correta ✓', true);
    setStatus('#st-tv', s.tv ? 'TV conectada ✓' : '', s.tv || null);
    setStatus('#st-ar', s.ar ? 'Ar conectado ✓' : '', s.ar || null);
    $('#hello').textContent = s.tv || s.ar ? 'Olá! Toque no microfone e fale.' : 'Conecte a TV e o ar nas configurações.';
  } catch (e) { setStatus('#st-senha', e.message, false); $('#hello').textContent = e.message; }
}

$('#btn-cfg').onclick = openCfg;
$('#cfg').addEventListener('click', e => { if (e.target === $('#cfg') || e.target.closest('[data-close]')) $('#cfg').close(); });
$('#save-senha').onclick = async () => { state.senha = $('#senha').value.trim(); LS.set('as_senha', state.senha); setStatus('#st-senha', 'Verificando…'); await refreshStatus(); };
$('#speak').onchange = e => { state.speak = e.target.checked; LS.set('as_speak', state.speak); };
$('#con-tv').onclick = async () => {
  const pat = $('#pat').value.trim(); if (!pat) return setStatus('#st-tv', 'Cole o token primeiro.', false);
  $('#con-tv').disabled = true; setStatus('#st-tv', 'Criando o acesso na SmartThings…');
  try { const { url } = await api({ acao: 'st-setup', pat }); setStatus('#st-tv', 'Abrindo o login da Samsung…'); location.href = url; }
  catch (e) { setStatus('#st-tv', e.message, false); }
  finally { $('#con-tv').disabled = false; }
};
$('#con-ar').onclick = async () => {
  const email = $('#g-email').value.trim(), password = $('#g-pass').value;
  if (!email || !password) return setStatus('#st-ar', 'Preencha e-mail e senha.', false);
  $('#con-ar').disabled = true; setStatus('#st-ar', 'Entrando no Gree+…');
  try {
    const r = await api({ acao: 'gree-setup', email, password, regiao: $('#g-reg').value });
    setStatus('#st-ar', r.aparelhos.length ? `Conectado ✓ (${r.aparelhos.join(', ')})` : 'Conta conectada, mas nenhum ar encontrado. Conecte o ar no app Gree+.', r.aparelhos.length > 0);
    $('#g-pass').value = ''; refreshStatus();
  } catch (e) { setStatus('#st-ar', e.message, false); }
  finally { $('#con-ar').disabled = false; }
};

$('#mic').onclick = listen;
$('#type-form').onsubmit = e => { e.preventDefault(); const v = $('#type').value; $('#type').value = ''; handle(v); };
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => handle(b.dataset.q));
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};

// volta do login da Samsung
const qs = new URLSearchParams(location.search);
if (qs.get('conectado') === 'tv') {
  history.replaceState(null, '', location.pathname);
  const nome = qs.get('nome');
  setTimeout(() => answer(nome ? `TV conectada: ${nome}. Pode pedir para ligar.` : 'Conta Samsung conectada, mas não achei a TV. Confira se ela aparece no app SmartThings.', !nome), 400);
}
renderDevices(); refreshStatus();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
