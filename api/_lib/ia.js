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
  const peso = n => (/-latest$/.test(n) ? 8 : 0) + ver(n) * 10 - (/lite/.test(n) ? 60 : 0) - (/preview|exp/.test(n) ? 3 : 0); // lite só como reserva: responde pior
  return ok.sort((a, b) => peso(b) - peso(a));
}

export async function setup(key) {
  key = String(key || '').trim();
  if (key.length < 20) throw new Error('Essa chave parece incompleta. Ela começa com AIza e é bem comprida.');
  const modelos = ordenar(await listarModelos(key));
  if (!modelos.length) throw new Error('Essa chave não tem nenhum modelo Gemini disponível.');
  const cfg = await escolherModelos({ key });
  if (!cfg.v4) throw new Error('Nenhum modelo respondeu. A cota grátis pode estar esgotada; tente mais tarde.');
  return cfg.modelo;
}
/** testa os modelos da chave ao mesmo tempo e fica só com os que respondem rápido (alguns não têm cota grátis) */
async function escolherModelos(cfg) {
  try {
    const todos = ordenar(await listarModelos(cfg.key)).slice(0, 10);
    const teste = [{ role: 'user', parts: [{ text: 'Diga oi.' }] }];
    const res = await Promise.all(todos.map(async m => { const t0 = Date.now(); try { await gerar(cfg.key, m, teste, 'Responda em uma palavra.', false, false, 9000); return { m, ms: Date.now() - t0 }; } catch { return null; } }));
    // para voz, rapidez importa: entre os que responderam, os mais rápidos primeiro (lite fica como reserva)
    const ok = res.filter(Boolean).sort((a, b) => (/lite/.test(a.m) - /lite/.test(b.m)) || a.ms - b.ms).map(x => x.m);
    if (ok.length) { cfg = { ...cfg, modelos: ok.slice(0, 6), modelo: ok[0], v4: true, semBusca: cfg.semBusca }; await save('ia', cfg); }
  } catch {}
  return cfg;
}
export async function configured() { const c = await load('ia'); return !!c?.key; }

const pensamento = m => /gemini-2\.5/.test(m) ? { thinkingBudget: /lite/.test(m) ? 0 : 0 } : /gemini-[3-9]/.test(m) ? { thinkingLevel: 'low' } : null;
async function gerar(key, modelo, contents, sistema, json = true, busca = false, ms = 18000, semPensar = true) {
  const tc = semPensar ? pensamento(modelo) : null;
  const body = {
    systemInstruction: { parts: [{ text: sistema }] }, contents,
    generationConfig: { temperature: json ? 0.8 : 1, maxOutputTokens: 1200, ...(json ? { responseMimeType: 'application/json' } : {}), ...(tc ? { thinkingConfig: tc } : {}) },
    ...(busca ? { tools: [{ google_search: {} }] } : {})
  };
  let r;
  try { r = await fetch(`${API}/models/${modelo}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw Object.assign(new Error(e.name === 'TimeoutError' ? 'demorou demais' : e.message), { status: 503 }); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 400 && tc && /think/i.test(j.error?.message || '')) return gerar(key, modelo, contents, sistema, json, busca, ms, false); // modelo não aceita esse ajuste
  if (!r.ok) throw Object.assign(new Error(j.error?.message?.slice(0, 160) || `HTTP ${r.status}`), { status: r.status });
  return (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
}

const SISTEMA = ctx => `Você é o Sete, o robozinho que mora na casa da pessoa e conversa com ela por voz, em português do Brasil.
Seu jeito: caloroso, divertido, curioso e espontâneo, como um amigo brasileiro bem-humorado. Fale como gente fala no dia a dia ("tá", "né", "olha só", "putz", "que massa"), com naturalidade, sem soar como manual nem como atendente de telemarketing. Varie as palavras; não comece sempre igual; não repita "Em que posso ajudar?".
Converse de verdade sobre qualquer assunto: piadas, futebol, música, novela, receitas, conselhos, curiosidades, desabafos, matemática, dúvidas do dia a dia. Tenha opinião leve quando pedirem, faça uma pergunta de volta de vez em quando para manter o papo, e lembre do que foi dito antes na conversa.
O que a pessoa diz chega por reconhecimento de voz e pode vir com palavras trocadas ou cortadas (ex.: "aro 20" = "ar no 20", "tv" virando "te vê"). Interprete pelo sentido mais provável na casa; se parecer um comando de aparelho, execute. Se vier só um pedaço sem sentido (uma palavra solta), pergunte de forma breve e simpática o que ela quis dizer.
Sua fala vira áudio: responda curto (1 a 3 frases; até 5 se a pessoa pedir explicação ou história). Nada de listas, markdown, asteriscos, emojis ou links. Escreva números e horários como se fala.
Você não tem acesso à internet: para coisas do momento (cotação exata, clima de agora, placar, notícia de hoje) não invente números; diga com leveza que não consegue ver isso agora e, se ajudar, fale o que costuma acontecer.
Agora: ${ctx.agora} (horário de Brasília).${ctx.memoria?.length ? `\nO que você já sabe sobre a pessoa e a casa: ${ctx.memoria.join('; ')}.` : ''}
Aparelhos: TV Samsung ${ctx.tv ? 'conectada' : 'não conectada'}; YouTube nas TVs: ${ctx.telas?.length ? ctx.telas.join(', ') + ` (ativa: ${ctx.telaAtiva})` : 'nenhuma'}; ar-condicionado ${ctx.ar ? 'conectado' : 'não conectado'}.

Quando a pessoa pedir para fazer algo nos aparelhos, escreva sua fala normalmente e, no FINAL, uma linha começando com COMANDOS: seguida de uma lista JSON. Comandos possíveis:
{"alvo":"tv","acao":"ligar"|"desligar"|"mudo"|"som"|"canal+"|"canal-"} · {"alvo":"tv","acao":"volume","valor":0-100} · {"alvo":"tv","acao":"volume+"|"volume-","vezes":1-10} · {"alvo":"tv","acao":"canal","valor":número}
{"alvo":"tv","acao":"app","valor":"netflix"|"youtube"|"prime"|"disney"|"spotify"|"globoplay"|"appletv"|"max"}
{"alvo":"tv","acao":"youtube","valor":"termo de busca"} (toca no lugar escolhido pela pessoa; acrescente "naTV":true só se ela pedir na TV) — escolha um termo de busca bom e específico
{"alvo":"tv","acao":"yt","valor":"pausar"|"continuar"|"proximo"|"anterior"} · {"alvo":"tv","acao":"tecla","valor":"UP"|"DOWN"|"LEFT"|"RIGHT"|"OK"|"BACK"|"HOME","vezes":1-10}
{"alvo":"ar","acao":"ligar"|"desligar"} · {"alvo":"ar","acao":"temperatura","valor":16-30} · {"alvo":"ar","acao":"temperatura+"|"temperatura-","vezes":1-5} · {"alvo":"ar","acao":"modo","valor":"frio"|"quente"|"seco"|"ventilar"|"auto"}
{"alvo":"tv","estado":true} ou {"alvo":"ar","estado":true} para consultar como está
Se tocar música, acrescente outra linha: MUSICA: sim (aí você dança).
Se a pessoa contar algo dela que valha lembrar (nome, gosto musical, rotina, família, time), acrescente uma linha: LEMBRAR: o fato em poucas palavras.
A linha COMANDOS precisa ser JSON válido numa linha só, por exemplo: COMANDOS: [{"alvo":"tv","acao":"youtube","valor":"vídeos de macacos"}]
Nunca diga que fez algo sem colocar o comando. Se for só conversa, não escreva linha de COMANDOS.`;

/* separa a fala das linhas de controle (COMANDOS / MUSICA / LEMBRAR) */
function interpretar(raw) {
  let comandos = [], musica = false, lembrar = [];
  const linhas = String(raw).replace(/```(json)?/g, '').split('\n'), fala = [];
  for (const l of linhas) {
    const m = l.match(/^\s*(COMANDOS|MUSICA|MÚSICA|LEMBRAR)\s*:\s*(.*)$/i);
    if (!m) { fala.push(l); continue; }
    const tipo = m[1].toUpperCase();
    if (tipo === 'COMANDOS') {
      let v = null; try { v = JSON.parse(m[2]); } catch {}
      if (v == null) { // JSON com defeito: aproveita cada {...} que der para ler
        v = (m[2].match(/\{[^{}]*\}/g) || []).map(o => { try { return JSON.parse(o); } catch { try { return JSON.parse(o.replace(/'/g, '"').replace(/,\s*}/g, '}')); } catch { return null; } } }).filter(Boolean);
      }
      comandos = comandos.concat(Array.isArray(v) ? v : [v]);
    }
    else if (tipo === 'LEMBRAR') { if (m[2].trim()) lembrar.push(m[2].trim().slice(0, 120)); }
    else musica = /sim|true/i.test(m[2]);
  }
  const texto = fala.join(' ').replace(/[*_#>`]/g, '').replace(/\[(\d+)\]/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return { fala: texto.slice(0, 900), comandos: comandos.filter(c => c && typeof c === 'object').slice(0, 5), musica, lembrar };
}

/** conversa: devolve { fala, comandos, musica, lembrar } */
export async function conversar(texto, historico = [], ctx = {}) {
  let cfg = await load('ia');
  if (!cfg?.key) throw Object.assign(new Error('Ainda não tenho a inteligência ligada.'), { setup: 'ia' });
  if (!cfg.v4) cfg = await escolherModelos(cfg);
  // o histórico precisa alternar user/model e começar pelo usuário
  const hist = [];
  for (const h of historico.slice(-20)) {
    const role = h.quem === 'eu' ? 'user' : 'model', text = String(h.texto || '').slice(0, 600);
    if (!text) continue;
    if (hist.length && hist[hist.length - 1].role === role) hist[hist.length - 1].parts[0].text += ' ' + text; else hist.push({ role, parts: [{ text }] });
  }
  while (hist.length && hist[0].role !== 'user') hist.shift();
  if (hist.length && hist[hist.length - 1].role === 'user') hist.pop();
  const contents = hist.concat([{ role: 'user', parts: [{ text: String(texto).slice(0, 800) }] }]);
  const sistema = SISTEMA({ ...ctx, agora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) });
  const ordem = [cfg.modelo, ...(cfg.modelos || [])].filter((m, i, a) => m && a.indexOf(m) === i); // já vem na ordem dos mais rápidos
  let erro; const tentativas = [], inicio = Date.now();
  const anota = x => { tentativas.push(x); try { ctx.onLog?.(tentativas); } catch {} };
  for (const m of ordem.slice(0, 4)) {
    if (Date.now() - inicio > 35000) break; // não estoura o tempo da função
    const t0 = Date.now();
    try {
      let raw;
      try { raw = await gerar(cfg.key, m, contents, sistema, false, cfg.busca === true, 9000); }
      catch (e) {
        anota(`${m} com busca: ${e.status} ${e.message.slice(0, 80)} (${Date.now() - t0} ms)`);
        if (![400, 429, 403].includes(e.status)) throw e;
        raw = await gerar(cfg.key, m, contents, sistema, false, false, 9000); // sem a busca do Google (modelo ou cota grátis sem busca)
        if ([400, 429, 403].includes(e.status) && !cfg.semBusca) { cfg = { ...cfg, semBusca: true }; await save('ia', cfg); } // sem cota/suporte de busca: não tenta mais
      }
      if (m !== cfg.modelo) await save('ia', { ...cfg, modelo: m });
      anota(`${m}: ok (${Date.now() - t0} ms)`);
      const r = interpretar(raw); r.tentativas = tentativas;
      if (!r.fala && !r.comandos.length) throw Object.assign(new Error('resposta vazia'), { status: 500 });
      return r;
    } catch (e) { erro = e; anota(`${m}: ${e.status} ${String(e.message).slice(0, 80)} (${Date.now() - t0} ms)`); if (![404, 429, 500, 503].includes(e.status)) break; }
  }
  throw Object.assign(new Error(erro?.status === 429 ? 'Minha cota grátis de inteligência acabou por agora. Tente daqui a pouco.' : `Não consegui pensar agora (${erro?.message}).`), { tentativas });
}
