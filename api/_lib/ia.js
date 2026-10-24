/* Inteligência do robô: Google Gemini (nível grátis, chave criada pelo usuário em aistudio.google.com).
   A chave fica criptografada no Firebase (como as outras credenciais). O modelo é escolhido sozinho
   entre os disponíveis na chave (o Google muda os nomes e o que é grátis com o tempo). */
import { load, save } from './store.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

async function listarModelos(key) {
  const r = await fetch(`${API}/models?key=${encodeURIComponent(key)}&pageSize=200`);
  const j = await r.json().catch(() => ({}));
  if (r.status === 400 || r.status === 403) throw new Error('O Google não aceitou essa chave. Confira se copiou inteira.');
  if (!r.ok) throw new Error(`Gemini: erro ${r.status}`);
  return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
}
/** ordem de preferência: flash (rápido e grátis) mais novo; depois flash-lite; evita "pro" (pago), imagem, áudio, tts */
function ordenar(nomes) {
  const ok = nomes.filter(n => /gemini/.test(n) && /flash/.test(n) && !/(image|tts|audio|live|embedding|thinking-exp|native)/.test(n));
  const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const peso = n => (/-latest$/.test(n) ? 50 : 0) + ver(n) * 10 - (/lite/.test(n) ? 5 : 0) - (/preview|exp/.test(n) ? 3 : 0);
  return ok.sort((a, b) => peso(b) - peso(a));
}

export async function setup(key) {
  key = String(key || '').trim();
  if (key.length < 20) throw new Error('Essa chave parece incompleta. Ela começa com AIza e é bem comprida.');
  const modelos = ordenar(await listarModelos(key));
  if (!modelos.length) throw new Error('Essa chave não tem nenhum modelo Gemini disponível.');
  // testa de verdade, do melhor para o pior, até um responder (alguns podem estar sem cota grátis)
  let erro;
  for (const m of modelos.slice(0, 6)) {
    try { await gerar(key, m, [{ role: 'user', parts: [{ text: 'Responda só: ok' }] }], 'Responda em uma palavra.', false); await save('ia', { key, modelo: m, modelos: modelos.slice(0, 6) }); return m; }
    catch (e) { erro = e; }
  }
  throw new Error(`Nenhum modelo respondeu (${erro?.message}). A cota grátis pode estar esgotada; tente mais tarde.`);
}
export async function configured() { const c = await load('ia'); return !!c?.key; }

async function gerar(key, modelo, contents, sistema, json = true) {
  const r = await fetch(`${API}/models/${modelo}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] }, contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 700, ...(json ? { responseMimeType: 'application/json' } : {}) }
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message?.slice(0, 160) || `HTTP ${r.status}`), { status: r.status });
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

const SISTEMA = ctx => `Você é o Hi Tec, um robô assistente doméstico simpático, bem-humorado e prestativo, que conversa por voz em português do Brasil.
Fale de forma natural e curta (no máximo 3 frases), como numa conversa falada: sem listas, sem markdown, sem emojis.
Agora são ${ctx.agora}. Aparelhos: TV Samsung ${ctx.tv ? 'conectada' : 'não conectada'}; YouTube nas TVs: ${ctx.telas?.length ? ctx.telas.join(', ') + ` (ativa: ${ctx.telaAtiva})` : 'nenhuma vinculada'}; ar-condicionado ${ctx.ar ? 'conectado' : 'não conectado'}.
Você pode controlar os aparelhos devolvendo comandos. Responda SEMPRE com JSON: {"fala": "o que você diz", "comandos": [ ... ], "musica": true|false}
Comandos possíveis (use só quando a pessoa pedir algo para fazer):
- {"alvo":"tv","acao":"ligar"|"desligar"|"mudo"|"som"|"canal+"|"canal-"}
- {"alvo":"tv","acao":"volume","valor":0-100} · {"alvo":"tv","acao":"volume+"|"volume-","vezes":1-10}
- {"alvo":"tv","acao":"canal","valor":número}
- {"alvo":"tv","acao":"app","valor":"netflix"|"youtube"|"prime"|"disney"|"spotify"|"globoplay"|"appletv"|"max"}
- {"alvo":"tv","acao":"youtube","valor":"termo de busca"}  ← toca um vídeo/música AQUI no app (padrão). Só se a pessoa pedir explicitamente "na TV", acrescente "naTV":true para tocar no YouTube da TV. Escolha um bom termo de busca (ex.: "músicas animadas para dançar", "Djavan ao vivo", "desenho Peppa Pig").
- {"alvo":"tv","acao":"yt","valor":"pausar"|"continuar"|"proximo"|"anterior"}
- {"alvo":"tv","acao":"tecla","valor":"UP"|"DOWN"|"LEFT"|"RIGHT"|"OK"|"BACK"|"HOME","vezes":1-10}
- {"alvo":"tv","acao":"tela","valor":"nome da TV"}  ← troca a TV ativa do YouTube
- {"alvo":"ar","acao":"ligar"|"desligar"} · {"alvo":"ar","acao":"temperatura","valor":16-30} · {"alvo":"ar","acao":"modo","valor":"frio"|"quente"|"seco"|"ventilar"|"auto"}
- {"alvo":"tv","estado":true} ou {"alvo":"ar","estado":true} ← para saber como está
Ponha "musica": true quando o comando tocar música (para você dançar). Netflix e outros apps não deixam escolher título direto: abra o app e ofereça navegar com as teclas.
Se a pessoa só conversar, responda com carinho e "comandos": []. Não invente que fez algo sem colocar o comando.`;

/** conversa: devolve { fala, comandos, musica } */
export async function conversar(texto, historico = [], ctx = {}) {
  const cfg = await load('ia');
  if (!cfg?.key) throw Object.assign(new Error('Ainda não tenho a inteligência ligada.'), { setup: 'ia' });
  const contents = historico.slice(-12).map(h => ({ role: h.quem === 'eu' ? 'user' : 'model', parts: [{ text: String(h.texto).slice(0, 600) }] }))
    .concat([{ role: 'user', parts: [{ text: String(texto).slice(0, 800) }] }]);
  const sistema = SISTEMA({ ...ctx, agora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) });
  const ordem = [cfg.modelo, ...(cfg.modelos || [])].filter((m, i, a) => m && a.indexOf(m) === i);
  let erro;
  for (const m of ordem) {
    try {
      const raw = await gerar(cfg.key, m, contents, sistema);
      if (m !== cfg.modelo) await save('ia', { ...cfg, modelo: m });
      let j; try { j = JSON.parse(raw.replace(/^```json\s*|```$/g, '')); } catch { j = { fala: raw.replace(/[{}"]/g, '').slice(0, 400), comandos: [] }; }
      return { fala: String(j.fala || '').slice(0, 600), comandos: Array.isArray(j.comandos) ? j.comandos.slice(0, 5) : [], musica: !!j.musica };
    } catch (e) { erro = e; if (![404, 429, 500, 503].includes(e.status)) break; }
  }
  throw new Error(erro?.status === 429 ? 'Minha cota grátis de inteligência acabou por agora. Tente daqui a pouco.' : `Não consegui pensar agora (${erro?.message}).`);
}
