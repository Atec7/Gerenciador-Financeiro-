/* Robô assistente — conversa por voz, configuração guiada e comandos da TV e do ar.
   Peças: Robot (rosto, robot.js) · Comandos (entende comandos, parser.js) · Voz (fala/ouve) · Passos (roteiro de configuração) */
const $ = s => document.querySelector(s);
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const S = {
  senha: LS.get('as_senha', ''), speak: LS.get('as_speak', true), conversa: LS.get('as_conversa', false),
  apiUrl: LS.get('as_api', ''), aqui: null, senhaVercel: null, tv: false, ar: false, started: false, emptyListens: 0
};
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const wait = ms => new Promise(r => setTimeout(r, ms));
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

/* ── servidor ── */
async function ping(base = '') {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(`${base}/api/assistente?acao=ping`, { cache: 'no-store', signal: ctl.signal }); const j = await r.json(); return j.assistente ? j : null; }
  catch { return null; } finally { clearTimeout(t); }
}
async function api(body) {
  const res = await fetch('/api/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-senha': S.senha }, body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok || !data.ok) throw Object.assign(new Error(data.erro || `Erro ${res.status}`), { setup: data.setup, status: res.status });
  return data;
}

/* ── Voz: falar (boca mexendo) e ouvir ── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const Voz = {
  rec: null, ouvindo: false,
  voice() { const vs = speechSynthesis.getVoices(); return vs.find(v => /pt[-_]BR/i.test(v.lang) && /google|luciana|francisca|daniel|felipe/i.test(v.name)) || vs.find(v => /pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)); },
  /** fala o texto; o balão mostra a frase e a boca do robô acompanha */
  say(text, { mood } = {}) {
    $('#bubble').innerHTML = esc(text);
    log(text, 'bot', mood === 'sad');
    if (mood) Robot.mood(mood, mood === 'happy' || mood === 'sad' ? 4500 : 0);
    return new Promise(resolve => {
      const done = () => { Robot.talk(false); resolve(); };
      if (!S.speak || !('speechSynthesis' in window)) { Robot.talk(true); setTimeout(done, Math.min(6000, 600 + text.split(' ').length * 260)); return; }
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/_/g, ' sublinhado ').replace(/\+/g, ' mais').replace(/vercel\.app/gi, 'vercel ponto app').replace(/[^\p{L}\p{N}\s.,!?;:%°$-]/gu, ''));
        u.lang = 'pt-BR'; u.rate = 1.05; u.pitch = 1.15; const v = this.voice(); if (v) u.voice = v;
        u.onstart = () => Robot.talk(true); u.onboundary = () => Robot.word();
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(() => { if (!speechSynthesis.speaking) done(); }, 1500); // alguns aparelhos não avisam o início
        setTimeout(done, 20000);
      } catch { done(); }
    });
  },
  /** para de ouvir sem processar o que estava sendo dito */
  cancel() {
    const r = this.rec; if (!r || !this.ouvindo) return;
    this.rec = null; this.ouvindo = false; $('#mic').classList.remove('listening'); if (Robot.current === 'listening') Robot.mood('idle');
    try { r.abort ? r.abort() : r.stop(); } catch {}
    r._resolve?.('');
  },
  /** ouve uma frase; devolve o texto (ou '' se não ouviu nada) */
  listen() {
    return new Promise(resolve => {
      if (!SR) { $('#heard').textContent = 'Este navegador não reconhece voz. Use o Chrome (Android) ou o Safari (iPhone), ou escreva.'; return resolve(''); }
      this.cancel(); // descarta uma escuta antiga ainda aberta
      try { speechSynthesis.cancel(); } catch {}
      const rec = this.rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      let final = '', interim = '';
      rec.onstart = () => { this.ouvindo = true; Robot.mood('listening'); $('#mic').classList.add('listening'); $('#heard').textContent = 'Estou ouvindo…'; };
      rec._resolve = resolve;
      rec.onresult = e => { if (rec !== this.rec) return; interim = ''; for (const r of e.results) r.isFinal ? (final = r[0].transcript) : (interim += r[0].transcript); $('#heard').textContent = `“${final || interim}”`; };
      rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { $('#heard').textContent = 'Libere o microfone para este site nas configurações do navegador.'; S.conversa = false; syncConv(); } };
      rec.onend = () => { if (rec !== this.rec) return; this.ouvindo = false; $('#mic').classList.remove('listening'); if (Robot.current === 'listening') Robot.mood('idle'); if (!final && !interim) $('#heard').textContent = ''; resolve((final || interim).trim()); };
      try { rec.start(); } catch { resolve(''); }
    });
  }
};

/* ── conversa ── */
function log(text, who = 'bot', err = false) {
  const li = document.createElement('li'); li.className = `${who}${err ? ' err' : ''}`;
  li.innerHTML = `${esc(text)}<small>${new Date().toTimeString().slice(0, 5)}</small>`;
  $('#log').prepend(li); while ($('#log').children.length > 40) $('#log').lastChild.remove();
}
/** o robô fala e, no modo conversa (ou quando faz uma pergunta), já escuta a resposta */
async function falar(text, opts = {}) {
  await Voz.say(text, opts);
  if (opts.listen === false) return;
  if ((S.conversa || opts.listen) && !(passo?.field)) ouvir();
}
async function ouvir() {
  const t = await Voz.listen();
  if (!t) { if (S.conversa && ++S.emptyListens >= 2) { S.emptyListens = 0; S.conversa = false; syncConv(); Robot.mood('sleep', 3000); $('#heard').textContent = 'Modo conversa pausado. Toque em mim para falar.'; } return; }
  S.emptyListens = 0; responder(t);
}

/* ── papo básico ── */
const PIADAS = ['Por que o robô foi ao médico? Porque estava com um vírus!', 'Qual é o prato favorito do robô? Micro-chips!', 'O que o robô disse para a tomada? Você me dá energia!'];
function papo(t) {
  const n = norm(t);
  if (/\b(tchau|ate mais|ate logo|pode parar|para de ouvir|chega|silencio|dormir)\b/.test(n)) { S.conversa = false; syncConv(); return { text: 'Tá bom! Quando precisar, é só tocar em mim.', mood: 'sleep', listen: false }; }
  if (/\b(oi|ola|e ai|eai|bom dia|boa tarde|boa noite|hey)\b/.test(n) && n.split(' ').length <= 4) return { text: `${/bom dia/.test(n) ? 'Bom dia' : /boa tarde/.test(n) ? 'Boa tarde' : /boa noite/.test(n) ? 'Boa noite' : 'Oi'}! Em que posso ajudar? Posso ligar a TV, o ar, ou te ajudar a me configurar.`, mood: 'happy' };
  if (/\b(obrigad|valeu|brigad)/.test(n)) return { text: 'De nada! Estou aqui para isso.', mood: 'happy' };
  if (/\b(quem e voce|qual (e )?seu nome|como (voce )?se chama|voce e quem)\b/.test(n)) return { text: 'Eu sou o Robô, seu assistente pessoal. Eu controlo a sua TV e o seu ar-condicionado, e converso com você.', mood: 'happy' };
  if (/\b(o que voce (faz|sabe)|ajuda|comandos|o que posso (falar|pedir))\b/.test(n) && !/configur/.test(n)) return { text: 'Você pode me pedir: liga a TV, volume 15, abre a Netflix, liga o ar, ar em 22 graus, modo frio, ou perguntar como está o ar. Também posso te ajudar a me configurar.' };
  if (/\b(que horas|horas sao)\b/.test(n)) { const d = new Date(); return { text: `Agora são ${d.getHours()} horas e ${d.getMinutes()} minutos.` }; }
  if (/\b(piada|me faz rir|conta algo engracado)\b/.test(n)) return { text: PIADAS[Math.floor(Math.random() * PIADAS.length)], mood: 'happy' };
  if (/\b(modo conversa|conversa comigo|fica ouvindo)\b/.test(n)) { S.conversa = true; syncConv(); return { text: 'Modo conversa ligado! Depois que eu falo, já fico ouvindo você. Para parar, diga tchau.', mood: 'happy' }; }
  return null;
}

/* ── comandos de aparelhos ── */
function descreve(alvo, e) {
  if (!e) return alvo === 'tv' ? 'Não encontrei a TV.' : 'Não encontrei o ar.';
  if (alvo === 'tv') return `A TV está ${e.ligada ? 'ligada' : 'desligada'}${e.ligada && e.volume != null ? `, com volume ${e.volume}` : ''}${e.mudo ? ', no mudo' : ''}.`;
  const modo = { frio: 'frio', quente: 'quente', seco: 'desumidificar', ventilar: 'ventilar', auto: 'automático' }[e.modo];
  return e.ligado ? `O ar está ligado em ${e.temperatura} graus${modo ? `, no modo ${modo}` : ''}${e.ambiente != null ? `. Aí dentro está fazendo ${e.ambiente} graus` : ''}.` : `O ar está desligado${e.ambiente != null ? `. Aí dentro está fazendo ${e.ambiente} graus` : ''}.`;
}
async function executar(c) {
  if (!S.aqui) return falar(S.apiUrl ? 'Para comandar a TV e o ar, me abra pelo endereço do meu servidor.' : 'Ainda não tenho servidor. Quer que eu te ajude a me configurar? É só dizer: me ajuda a configurar.', { mood: 'sad' });
  if (!S.senha) return iniciarPasso('senha');
  Robot.mood('thinking');
  try {
    if (c.estado) { const { estado } = await api({ acao: 'estado', alvo: c.alvo }); Robot.mood('idle'); return falar(descreve(c.alvo, estado)); }
    await api({ acao: 'cmd', cmd: c }); return falar(Comandos.reply(c), { mood: 'happy' });
  } catch (e) {
    Robot.mood('idle');
    if (e.setup === 'tv') return falar(`${e.message} Quer que eu te ajude a conectar a TV agora?`, { mood: 'sad', listen: true }).then(() => { pendente = 'tv1'; });
    if (e.setup === 'ar') return falar(`${e.message} Quer que eu te ajude a conectar o ar agora?`, { mood: 'sad', listen: true }).then(() => { pendente = 'ar1'; });
    if (e.status === 401) return iniciarPasso('senha', 'Essa senha não está mais valendo.');
    return falar(e.message, { mood: 'sad' });
  }
}

/* ── entrada: tudo que o usuário fala, digita ou toca passa por aqui ── */
let pendente = null; // passo oferecido numa pergunta "quer que eu te ajude…?"
const SIM = /^(sim|s|isso|pode|pode ser|claro|ok|okay|pronto|ja|ja fiz|fiz|feito|terminei|vamos|bora|quero|uhum|aham|ligou|funcionou|deu certo|consegui|com certeza|tudo certo)\b/;
const NAO = /^(nao|n|agora nao|depois|nao quero|nem|negativo|nao ligou|nao funcionou|nao deu|nao consegui)\b/;
async function responder(texto, viaBotao = false) {
  texto = String(texto || '').trim(); if (!texto) return;
  if (!viaBotao) log(texto, 'me');
  const n = norm(texto);
  if (passo) {
    if (/\b(repete|repetir|de novo|nao entendi|como assim|fala de novo)\b/.test(n)) return mostrarPasso();
    if (/\b(cancela|cancelar|sair da configuracao|para a configuracao|depois eu termino)\b/.test(n)) { encerrarPassos(); return falar('Tudo bem, paramos por aqui. Quando quiser continuar, diga: me ajuda a configurar.'); }
    return passo.on(texto, n);
  }
  if (pendente) { const p = pendente; pendente = null; if (SIM.test(n)) return iniciarPasso(p); if (NAO.test(n)) return falar('Tudo bem!'); }
  if (/\b(configur|me ajuda a (te )?configurar|conectar|instalar|primeiros passos)\b/.test(n)) {
    if (/\b(tv|televisao)\b/.test(n)) return iniciarPasso(S.aqui ? 'tv1' : 'intro');
    if (/\bar\b/.test(n)) return iniciarPasso(S.aqui ? 'ar1' : 'intro');
    return iniciarPasso('intro');
  }
  const c = Comandos.parse(texto);
  if (c?.erro) return falar(c.erro, { mood: 'sad' });
  if (c) return executar(c);
  const p = papo(texto);
  if (p) return falar(p.text, p);
  return falar('Hmm, não entendi. Você pode dizer, por exemplo: liga a TV, ar em 22 graus, ou me ajuda a configurar.', { mood: 'sad' });
}

/* ═════════ CONFIGURAÇÃO GUIADA ═════════
   Cada passo: o que o robô fala, botões de resposta, campos para digitar e o que fazer com a resposta. */
let passo = null, passoId = null;
const L = {
  vercel: 'https://vercel.com/signup', vercelDash: 'https://vercel.com/dashboard', tokens: 'https://account.smartthings.com/tokens',
  gree: isIOS ? 'https://apps.apple.com/br/search?term=gree%2B' : 'https://play.google.com/store/search?q=Gree%2B&c=apps',
  smartthings: isIOS ? 'https://apps.apple.com/br/app/smartthings/id1222822904' : 'https://play.google.com/store/apps/details?id=com.samsung.android.oneconnect'
};
const B = { pronto: { label: 'Pronto ✓', value: 'pronto', primary: true }, repete: { label: 'Repete', value: 'repete' }, sim: { label: 'Sim', value: 'sim', primary: true } };
const copiar = txt => ({ label: `Copiar ${txt}`, copy: txt });

async function proximoPasso() {
  if (!S.aqui) return iniciarPasso(S.apiUrl ? 'v5' : 'v1');
  const p = await ping(); S.senhaVercel = p?.senhaConfigurada;
  if (!p?.senhaConfigurada) return iniciarPasso('v-env');
  if (!S.senha) return iniciarPasso('senha');
  try { const s = await api({ acao: 'status' }); S.tv = s.tv; S.ar = s.ar; atualizaAparelhos(); }
  catch (e) { if (e.status === 401) return iniciarPasso('senha', 'A senha salva aqui não bate com a da Vercel.'); }
  if (!S.ar && !LS.get('as_pula_ar')) return iniciarPasso('ar1');
  if (!S.tv && !LS.get('as_pula_tv')) return iniciarPasso('tv1');
  return iniciarPasso('fim');
}

const PASSOS = {
  intro: {
    say: () => S.aqui ? 'Oi! Eu sou o Robô, seu assistente. Vou te ajudar a me configurar, passo a passo. Vamos começar?'
      : 'Oi! Eu sou o Robô, seu assistente. Vou te ajudar a me configurar. São quatro etapas: meu servidor, a senha, o ar e a TV. Leva uns 20 minutos. Vamos começar?',
    choices: [{ label: 'Vamos lá!', value: 'sim', primary: true }, { label: 'Agora não', value: 'nao' }],
    on: (t, n) => NAO.test(n) ? (encerrarPassos(), falar('Sem problemas! Quando quiser, diga: me ajuda a configurar.')) : proximoPasso()
  },
  /* Vercel (feito com o robô aberto no GitHub Pages) */
  v1: {
    say: 'Primeiro, vamos criar meu servidor, que é de graça, na Vercel. Toque em Abrir Vercel, escolha o plano Hobby, e entre com o botão Continue with GitHub, usando a mesma conta do seu app financeiro. Quando terminar, volte aqui e toque em Pronto.',
    choices: [{ label: 'Abrir Vercel', href: L.vercel, primary: true }, B.pronto, B.repete], volta: true,
    on: (t, n) => SIM.test(n) ? iniciarPasso('v2') : falar('Quando terminar de criar a conta, toque em Pronto.')
  },
  v2: {
    say: 'Agora a Vercel mostra seus repositórios. Procure Gerenciador-Financeiro e toque em Import. Se ele não aparecer, toque em Adjust GitHub App Permissions, escolha a conta Atec7, marque esse repositório e salve.',
    choices: [B.pronto, { label: 'Não aparece', value: 'nao' }, B.repete], volta: true,
    on: (t, n) => NAO.test(n) ? falar('Toque em Adjust GitHub App Permissions, ou em Install. Escolha a conta Atec7, marque Only select repositories, escolha Gerenciador-Financeiro, e toque em Save. Depois volte e toque em Import.', { listen: true })
      : SIM.test(n) ? iniciarPasso('v3') : falar('Me avise quando tiver tocado em Import.')
  },
  v3: {
    say: 'Na tela de configuração, deixe tudo como está e abra Environment Variables. No nome, coloque ASSISTENTE_SENHA, tudo junto e em maiúsculas. Toque no botão para copiar. No valor, invente uma senha e anote. Toque em Add, e depois em Deploy.',
    choices: [copiar('ASSISTENTE_SENHA'), B.pronto, B.repete], volta: true,
    on: (t, n) => SIM.test(n) ? iniciarPasso('v4') : falar('Quando tocar em Deploy, me avise.')
  },
  v4: {
    say: 'Quando aparecer Congratulations, toque em Continue to Dashboard. Em Domains está o meu endereço, que termina com vercel.app. Digite ele aqui embaixo.',
    field: { inputs: [{ id: 'url', type: 'text', label: 'Endereço do servidor', placeholder: 'algo.vercel.app' }], submit: 'Verificar' },
    on: async (t, n, v) => {
      const raw = (v?.url || t).trim().toLowerCase().replace(/\s+/g, '').replace(/ponto/g, '.');
      const m = raw.match(/([a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app)/);
      if (!m) return falar('Não parece um endereço da Vercel. Ele termina com ponto vercel ponto app. Digite de novo, por favor.', { mood: 'sad' });
      const url = `https://${m[1]}`; Robot.mood('thinking');
      const p = await ping(url);
      if (!p) return falar('Não encontrei meu servidor nesse endereço. Se acabou de tocar em Deploy, espere um minuto e tente de novo. Confira também se digitou certo.', { mood: 'sad' });
      S.apiUrl = url; LS.set('as_api', url);
      if (!p.senhaConfigurada) return iniciarPasso('v-env', 'Achei o servidor, mas falta a senha.');
      Robot.mood('happy', 3000); return iniciarPasso('v5');
    }
  },
  'v-env': {
    say: 'Falta a senha no servidor. Na Vercel, abra o projeto, depois Settings e Environment Variables. Adicione ASSISTENTE_SENHA com uma senha sua e salve. Depois, em Deployments, toque nos três pontinhos do último e em Redeploy. Me avise quando terminar.',
    choices: [{ label: 'Abrir Vercel', href: L.vercelDash, primary: true }, copiar('ASSISTENTE_SENHA'), B.pronto], volta: true,
    on: async (t, n) => {
      if (!SIM.test(n)) return falar('Quando terminar o Redeploy, toque em Pronto.');
      Robot.mood('thinking'); const p = await ping(S.aqui ? '' : S.apiUrl);
      if (!p?.senhaConfigurada) return falar('Ainda não vejo a senha. O Redeploy pode levar um minuto. Espere um pouco e toque em Pronto de novo.', { mood: 'sad' });
      return S.aqui ? proximoPasso() : iniciarPasso('v5');
    }
  },
  v5: {
    say: () => `Achei meu servidor! Agora eu vou me mudar para lá. Toque em Abrir meu novo endereço. Lá, me instale na tela inicial, e continuamos de onde paramos.`,
    choices: () => [{ label: 'Abrir meu novo endereço', href: `${S.apiUrl}/assistente/?config=1`, primary: true, same: true }],
    on: () => falar('Toque no botão Abrir meu novo endereço.')
  },
  /* no servidor */
  senha: {
    say: () => 'Agora digite aqui a senha que você colocou na Vercel. Por segurança, é melhor digitar do que falar em voz alta.',
    field: { inputs: [{ id: 'senha', type: 'password', label: 'Senha do assistente', autocomplete: 'current-password' }], submit: 'Confirmar' },
    on: async (t, n, v) => {
      const s = (v?.senha || '').trim(); if (!s) return falar('Digite a senha no campo, por favor.');
      S.senha = s; LS.set('as_senha', s); Robot.mood('thinking');
      try { await api({ acao: 'status' }); Robot.mood('happy', 2500); await Voz.say('Senha certinha!'); return proximoPasso(); }
      catch (e) { return falar(e.status === 401 ? 'Essa senha não bateu com a da Vercel. Confira maiúsculas e minúsculas e tente de novo.' : e.message, { mood: 'sad' }); }
    }
  },
  ar1: {
    say: 'Agora o ar-condicionado. Ele já está conectado no app Gree+, e você consegue ligar ele por lá?',
    choices: [B.sim, { label: 'Não, me ajuda', value: 'nao' }, { label: 'Pular o ar', value: 'pular' }],
    on: (t, n) => /pula/.test(n) ? (LS.set('as_pula_ar', true), proximoPasso()) : NAO.test(n) ? iniciarPasso('ar-h1') : SIM.test(n) ? iniciarPasso('ar2') : falar('Responda sim ou não, por favor.', { listen: true })
  },
  'ar-h1': {
    say: 'Tranquilo, eu te ajudo. Instale o app Gree+ e crie uma conta com seu e-mail. Quando ele pedir a região, escolha América do Sul. Me avise quando tiver a conta.',
    choices: [{ label: 'Baixar Gree+', href: L.gree, primary: true }, B.pronto, B.repete], volta: true,
    on: (t, n) => SIM.test(n) ? iniciarPasso('ar-h2') : falar('Quando tiver a conta, toque em Pronto.')
  },
  'ar-h2': {
    say: 'No Gree+, toque no sinal de mais, depois em adicionar aparelho e ar-condicionado, e siga as instruções. Use o Wi-Fi de 2,4 gigahertz, porque o ar não enxerga o de 5. No fim, teste ligar o ar pelo próprio app e me avise.',
    choices: [B.pronto, B.repete], volta: true,
    on: (t, n) => SIM.test(n) ? iniciarPasso('ar2') : falar('Quando o ar ligar pelo Gree+, toque em Pronto.')
  },
  ar2: {
    say: 'Ótimo! Agora digite o e-mail e a senha do Gree+, e confira a região.',
    field: { inputs: [
      { id: 'email', type: 'email', label: 'E-mail do Gree+', autocomplete: 'username' },
      { id: 'password', type: 'password', label: 'Senha do Gree+' },
      { id: 'regiao', type: 'select', label: 'Região', options: [['South American', 'América do Sul (Brasil)'], ['Latin American', 'América Latina'], ['North American', 'América do Norte'], ['Europe', 'Europa']] }
    ], submit: 'Conectar o ar' },
    on: async (t, n, v) => {
      if (!v?.email || !v?.password) return falar('Preencha o e-mail e a senha, por favor.');
      Robot.mood('thinking'); await Voz.say('Deixa comigo, estou entrando no Gree+…');
      try {
        const r = await api({ acao: 'gree-setup', email: v.email, password: v.password, regiao: v.regiao });
        if (!r.aparelhos.length) return falar('Entrei na sua conta, mas não achei nenhum ar nela. Conecte o ar no app Gree+ e tente de novo.', { mood: 'sad' });
        S.ar = true; atualizaAparelhos(); Robot.mood('happy', 3000);
        return iniciarPasso('ar-teste', `Encontrei o ar ${r.aparelhos[0]}!`);
      } catch (e) { return falar(e.message, { mood: 'sad' }); }
    }
  },
  'ar-teste': {
    say: 'Quer que eu ligue o ar agora para testar?',
    choices: [{ label: 'Sim, liga!', value: 'sim', primary: true }, { label: 'Não precisa', value: 'nao' }],
    on: async (t, n) => {
      if (!SIM.test(n)) return proximoPasso();
      Robot.mood('thinking');
      try { await api({ acao: 'cmd', cmd: { alvo: 'ar', acao: 'ligar' } }); return iniciarPasso('ar-teste2'); }
      catch (e) { await Voz.say(e.message, { mood: 'sad' }); return proximoPasso(); }
    }
  },
  'ar-teste2': {
    say: 'Mandei ligar! O ar ligou?',
    choices: [{ label: 'Ligou!', value: 'sim', primary: true }, { label: 'Não ligou', value: 'nao' }],
    on: async (t, n) => {
      if (SIM.test(n)) { await Voz.say('Perfeito! Depois é só me pedir.', { mood: 'happy' }); return proximoPasso(); }
      await Voz.say('Puxa. Confira se ele liga pelo app Gree+. Se ligar lá, me avise que eu investigo. Vamos seguir e você testa de novo depois dizendo: liga o ar.', { mood: 'sad' });
      return proximoPasso();
    }
  },
  tv1: {
    say: 'Agora a TV. Ela já aparece no app SmartThings, e você ativou a opção Ligar com o celular nas configurações da TV?',
    choices: [B.sim, { label: 'Não, me ajuda', value: 'nao' }, { label: 'Pular a TV', value: 'pular' }],
    on: (t, n) => /pula/.test(n) ? (LS.set('as_pula_tv', true), proximoPasso()) : NAO.test(n) ? iniciarPasso('tv-h1') : SIM.test(n) ? iniciarPasso('tv2') : falar('Responda sim ou não, por favor.', { listen: true })
  },
  'tv-h1': {
    say: 'Eu te ajudo. Instale o app SmartThings e entre com sua conta Samsung. Toque no sinal de mais, adicionar dispositivo, TV, e siga as instruções com a TV ligada. Me avise quando a TV aparecer no app.',
    choices: [{ label: 'Baixar SmartThings', href: L.smartthings, primary: true }, B.pronto, B.repete], volta: true,
    on: (t, n) => SIM.test(n) ? iniciarPasso('tv-h2') : falar('Quando a TV aparecer no SmartThings, toque em Pronto.')
  },
  'tv-h2': {
    say: 'Agora, na TV, abra Configurações, Geral, Rede, Configurações avançadas, e ative Ligar com celular. O nome pode mudar um pouco conforme o modelo. Sem isso eu consigo desligar a TV, mas não ligar.',
    choices: [B.pronto, B.repete],
    on: (t, n) => SIM.test(n) ? iniciarPasso('tv2') : falar('Quando ativar, toque em Pronto.')
  },
  tv2: {
    say: 'Agora preciso de um código da Samsung. Toque em Abrir página e entre com sua conta. Toque em Generate new token, dê o nome assistente, e marque todas as caixas de Devices, Locations e Apps. Gere, copie o código, e cole aqui embaixo.',
    choices: [{ label: 'Abrir página da Samsung', href: L.tokens, primary: true }, B.repete],
    field: { inputs: [{ id: 'pat', type: 'text', label: 'Código (token) da SmartThings', placeholder: 'Cole aqui' }], submit: 'Conectar a TV' }, volta: true,
    on: async (t, n, v) => {
      const pat = (v?.pat || '').trim(); if (!pat) return falar('Cole o código no campo, por favor.');
      Robot.mood('thinking');
      try {
        const { url } = await api({ acao: 'st-setup', pat });
        LS.set('as_passo', 'tv2');
        await Voz.say('Consegui! Agora vou te levar para a Samsung. Escolha a sua casa e toque em Permitir. Depois você volta para cá sozinho.', { mood: 'happy' });
        location.href = url;
      } catch (e) {
        return falar(/unauthorized|401|403/i.test(e.message) ? 'A Samsung não aceitou o código. Ele pode ter expirado ou ficado sem a permissão de Apps. Gere outro marcando todas as caixas.' : e.message, { mood: 'sad' });
      }
    }
  },
  'tv-teste': {
    say: () => 'Quer que eu teste a TV agora?',
    choices: [{ label: 'Sim, testa!', value: 'sim', primary: true }, { label: 'Não precisa', value: 'nao' }],
    on: async (t, n) => {
      if (!SIM.test(n)) return proximoPasso();
      Robot.mood('thinking');
      try {
        const { estado } = await api({ acao: 'estado', alvo: 'tv' });
        if (estado?.ligada) { await api({ acao: 'cmd', cmd: { alvo: 'tv', acao: 'mudo' } }); await wait(2500); await api({ acao: 'cmd', cmd: { alvo: 'tv', acao: 'som' } }); return iniciarPasso('tv-teste2', 'Coloquei a TV no mudo e tirei.'); }
        await api({ acao: 'cmd', cmd: { alvo: 'tv', acao: 'ligar' } }); return iniciarPasso('tv-teste2', 'Mandei ligar a TV.');
      } catch (e) { await Voz.say(e.message, { mood: 'sad' }); return proximoPasso(); }
    }
  },
  'tv-teste2': {
    say: 'Funcionou?',
    choices: [{ label: 'Funcionou!', value: 'sim', primary: true }, { label: 'Não', value: 'nao' }],
    on: async (t, n) => {
      if (SIM.test(n)) { await Voz.say('Uhul! A TV está comigo.', { mood: 'happy' }); return proximoPasso(); }
      await Voz.say('Hmm. Se a TV estava desligada, confira se a opção Ligar com celular está ativa e se ela liga pelo app SmartThings. Depois tente dizendo: liga a TV.', { mood: 'sad' });
      return proximoPasso();
    }
  },
  fim: {
    say: 'Tudo pronto! Agora é só falar comigo. Por exemplo: liga a TV, ar em 22 graus, ou abre a Netflix. Quer ligar o modo conversa? Assim, depois que eu falo, já fico ouvindo você, sem precisar tocar.',
    choices: [{ label: 'Ligar modo conversa', value: 'sim', primary: true }, { label: 'Agora não', value: 'nao' }],
    on: async (t, n) => {
      LS.set('as_configurado', true); encerrarPassos();
      if (SIM.test(n)) { S.conversa = true; syncConv(); return falar('Modo conversa ligado! Pode falar. Para parar, diga tchau.', { mood: 'happy' }); }
      return falar('Combinado! Quando quiser falar comigo, toque em mim.', { mood: 'happy' });
    }
  }
};

function iniciarPasso(id, prefixo = '') {
  passoId = id; passo = PASSOS[id]; LS.set('as_passo', id);
  return mostrarPasso(prefixo);
}
function encerrarPassos() { passo = null; passoId = null; LS.set('as_passo', null); $('#choices').innerHTML = ''; $('#field-area').classList.add('hidden'); $('#field-area').innerHTML = ''; }
async function mostrarPasso(prefixo = '') {
  if (!passo) return;
  const p = passo, val = x => typeof x === 'function' ? x() : x;
  // botões
  const ch = $('#choices'); ch.innerHTML = '';
  (val(p.choices) || []).forEach(c => {
    const b = document.createElement(c.href ? 'a' : 'button');
    b.textContent = c.label; if (c.primary) b.className = 'primary';
    if (c.href) { b.href = c.href; if (!c.same) { b.target = '_blank'; b.rel = 'noopener'; } }
    else if (c.copy) b.onclick = async () => { try { await navigator.clipboard.writeText(c.copy); b.textContent = 'Copiado ✓'; } catch { b.textContent = c.copy; } };
    else b.onclick = () => { Voz.cancel(); log(c.label, 'me'); p === passo && p.on(c.value, norm(c.value)); };
    ch.appendChild(b);
  });
  // campos
  const fa = $('#field-area'); fa.innerHTML = '';
  if (p.field) {
    p.field.inputs.forEach(f => {
      const lab = document.createElement('label'); lab.textContent = f.label; lab.htmlFor = `f-${f.id}`; fa.appendChild(lab);
      let inp;
      if (f.type === 'select') { inp = document.createElement('select'); f.options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; inp.appendChild(o); }); }
      else { inp = document.createElement('input'); inp.type = f.type; inp.placeholder = f.placeholder || ''; inp.autocomplete = f.autocomplete || 'off'; inp.spellcheck = false; inp.autocapitalize = 'off'; }
      inp.id = `f-${f.id}`; inp.name = f.id; if (f.id === 'url') inp.inputMode = 'url'; fa.appendChild(inp);
    });
    fa.noValidate = true; const sb = document.createElement('button'); sb.className = 'btn'; sb.textContent = p.field.submit; fa.appendChild(sb);
    fa.classList.remove('hidden');
    fa.onsubmit = e => {
      e.preventDefault(); Voz.cancel(); const v = Object.fromEntries(new FormData(fa).entries());
      log(p.field.inputs.map(f => f.type === 'password' ? '••••••' : v[f.id]).filter(Boolean).join(' · '), 'me');
      p === passo && p.on('', '', v);
    };
  } else fa.classList.add('hidden');
  const fala = `${prefixo ? prefixo + ' ' : ''}${val(p.say)}`;
  await Voz.say(fala);
  if (p !== passo) return;
  if (p.field) { setTimeout(() => fa.querySelector('input')?.focus(), 50); return; }
  if (S.conversa || (val(p.choices) || []).some(c => c.value === 'sim' || c.value === 'nao')) ouvir();
}

/* ── tela ── */
function atualizaAparelhos() { $('#dev-tv').classList.toggle('on', !!S.tv); $('#dev-ar').classList.toggle('on', !!S.ar); }
function syncConv() { LS.set('as_conversa', S.conversa); $('#btn-conv').classList.toggle('active', S.conversa); $('#autolisten').checked = S.conversa; }

async function primeiroToque() {
  if (S.started) return false; S.started = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {} // libera a fala no iPhone (precisa de um toque)
  const voltando = LS.get('as_passo'), prefixo = LS.get('as_prefixo'); LS.set('as_prefixo', null);
  const qs = new URLSearchParams(location.search);
  if (voltando && PASSOS[voltando]) { iniciarPasso(voltando, prefixo || 'Continuando de onde paramos.'); return true; }
  if (qs.get('config') || !LS.get('as_configurado')) { iniciarPasso('intro'); return true; }
  falar('Oi! Pode falar.', { listen: true });
  return true;
}

$('#robot').onclick = async () => {
  if (await primeiroToque()) return;
  if (Voz.ouvindo) { Voz.rec?.stop(); return; } // tocar de novo: termina a frase e processa
  ouvir();
};
$('#mic').onclick = async () => { if (await primeiroToque()) return; ouvir(); };
$('#type-form').onsubmit = async e => { e.preventDefault(); Voz.cancel(); const v = $('#type').value; $('#type').value = ''; S.started = true; responder(v); };
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { S.started = true; responder(b.dataset.q); });
$('#btn-conv').onclick = () => { S.conversa = !S.conversa; syncConv(); S.started = true; falar(S.conversa ? 'Modo conversa ligado! Pode falar.' : 'Modo conversa desligado.', { mood: S.conversa ? 'happy' : 'idle' }); };
$('#btn-cfg').onclick = () => { $('#senha').value = S.senha; $('#speak').checked = S.speak; $('#autolisten').checked = S.conversa; $('#cfg').showModal(); };
$('#cfg').addEventListener('click', e => { if (e.target === $('#cfg') || e.target.closest('[data-close]')) $('#cfg').close(); });
$('#cfg-guide').onclick = () => { $('#cfg').close(); S.started = true; iniciarPasso('intro'); };
$('#save-senha').onclick = async () => {
  S.senha = $('#senha').value.trim(); LS.set('as_senha', S.senha);
  try { const s = await api({ acao: 'status' }); S.tv = s.tv; S.ar = s.ar; atualizaAparelhos(); $('#st-senha').textContent = 'Senha correta ✓'; $('#st-senha').className = 'status ok'; }
  catch (e) { $('#st-senha').textContent = e.message; $('#st-senha').className = 'status err'; }
};
$('#speak').onchange = e => { S.speak = e.target.checked; LS.set('as_speak', S.speak); };
$('#autolisten').onchange = e => { S.conversa = e.target.checked; syncConv(); };
$('#cfg-reset').onclick = () => { ['as_senha', 'as_api', 'as_passo', 'as_configurado', 'as_pula_ar', 'as_pula_tv', 'as_conversa'].forEach(k => LS.set(k, null)); location.reload(); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !passo?.volta) return;
  setTimeout(() => { if (passo && !Voz.ouvindo) Voz.say('Bem-vindo de volta! Deu certo? Toque em Pronto quando terminar.'); }, 600);
});
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};

/* ── início ── */
(async function iniciar() {
  syncConv(); atualizaAparelhos();
  const p = await ping(); S.aqui = !!p; S.senhaVercel = p?.senhaConfigurada ?? null;
  if (S.aqui && S.senha) api({ acao: 'status' }).then(s => { S.tv = s.tv; S.ar = s.ar; atualizaAparelhos(); }).catch(() => {});
  const qs = new URLSearchParams(location.search);
  if (qs.get('st_code')) {
    // voltou do login da Samsung: conclui a conexão da TV enviando a senha
    history.replaceState(null, '', location.pathname);
    Robot.mood('thinking'); $('#bubble').textContent = 'Concluindo a conexão com a Samsung…';
    let nome = null;
    try { const r = await api({ acao: 'st-code', code: qs.get('st_code'), state: qs.get('st_state') }); nome = r.tv?.nome || ''; }
    catch (e) { Robot.mood('sad', 4000); LS.set('as_passo', 'tv2'); LS.set('as_prefixo', e.message); $('#bubble').textContent = `${e.message} Toque em mim para tentar de novo.`; return; }
    Robot.mood('idle');
    if (nome) { S.tv = true; atualizaAparelhos(); Robot.mood('happy', 4000); LS.set('as_passo', 'tv-teste'); LS.set('as_prefixo', `TV conectada: ${nome}!`); $('#bubble').textContent = `TV conectada: ${nome}! Toque em mim para continuar.`; }
    else { LS.set('as_passo', 'tv-h1'); LS.set('as_prefixo', 'Conectei sua conta Samsung, mas não achei a TV.'); $('#bubble').textContent = 'Conectei sua conta Samsung, mas não achei a TV. Toque em mim que eu te ajudo.'; }
    return;
  }
  $('#bubble').textContent = !LS.get('as_configurado') ? 'Oi! Eu sou o Robô. Toque em mim para eu te ajudar a me configurar.' : 'Oi! Toque em mim e fale.';
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
