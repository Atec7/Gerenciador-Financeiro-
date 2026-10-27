/* Conversa em tempo real com o Gemini Live: o áudio do microfone vai direto para o Google e a resposta volta falada,
   em menos de um segundo, com voz natural. O servidor só entrega um token curto (a chave nunca vem para o celular).
   Live.iniciar({ saudacao }) · Live.encerrar() · Live.ativo
   Os comandos (TV, ar, YouTube) chegam como "chamadas de função" e são executados pelo app (Live.on('acao', fn)). */
const Live = (() => {
  const URL_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=';
  const st = { ws: null, ativo: false, conectando: false, mic: null, ctxIn: null, ctxOut: null, proc: null, fila: [], proximo: 0, falando: false, ultimaAtividade: 0, timer: null, comBusca: true, encerrarDepois: false };
  const cb = { acao: async () => ({ ok: false }), estado: () => {}, ouvi: () => {}, disse: () => {}, fim: () => {}, contexto: () => ({}) };
  const reg = (...x) => { try { REG.add('tempo real', ...x); } catch {} };

  const FERRAMENTAS = [{ functionDeclarations: [
    { name: 'controlar_tv', description: 'Controla a TV: ligar, desligar, volume, canal, abrir app, teclas do controle, pausar/continuar o que estiver passando.',
      parameters: { type: 'OBJECT', properties: {
        acao: { type: 'STRING', enum: ['ligar', 'desligar', 'volume', 'volume+', 'volume-', 'mudo', 'som', 'canal', 'canal+', 'canal-', 'app', 'tecla', 'pausar', 'continuar', 'proximo', 'anterior'] },
        valor: { type: 'STRING', description: 'volume 0-100; número do canal; app: netflix, youtube, prime, disney, spotify, globoplay, appletv, max; tecla: UP, DOWN, LEFT, RIGHT, OK, BACK, HOME' },
        vezes: { type: 'INTEGER', description: 'quantas vezes (volume+/-, teclas)' } }, required: ['acao'] } },
    { name: 'tocar_youtube', description: 'Procura e toca um vídeo ou música do YouTube (no celular, ou na TV se a pessoa pedir na TV).',
      parameters: { type: 'OBJECT', properties: { busca: { type: 'STRING', description: 'termo de busca bom e específico' }, na_tv: { type: 'BOOLEAN' }, musica: { type: 'BOOLEAN', description: 'true se for música (o robô dança)' } }, required: ['busca'] } },
    { name: 'controlar_ar', description: 'Controla o ar-condicionado.',
      parameters: { type: 'OBJECT', properties: {
        acao: { type: 'STRING', enum: ['ligar', 'desligar', 'temperatura', 'temperatura+', 'temperatura-', 'modo', 'ventilacao'] },
        valor: { type: 'STRING', description: 'temperatura 16-30; modo: frio, quente, seco, ventilar, auto; ventilacao: baixa, media, alta, auto' },
        vezes: { type: 'INTEGER' } }, required: ['acao'] } },
    { name: 'ver_estado', description: 'Consulta como está a TV ou o ar (ligado, volume, temperatura, temperatura do ambiente).',
      parameters: { type: 'OBJECT', properties: { aparelho: { type: 'STRING', enum: ['tv', 'ar'] } }, required: ['aparelho'] } },
    { name: 'lembrar', description: 'Guarda um fato sobre a pessoa ou a casa para lembrar depois (nome, gostos, número de canal).',
      parameters: { type: 'OBJECT', properties: { fato: { type: 'STRING' } }, required: ['fato'] } },
    { name: 'encerrar_conversa', description: 'Encerra a conversa quando a pessoa se despedir ou disser que não precisa de mais nada.', parameters: { type: 'OBJECT', properties: {} } }
  ] }];

  function sistema(ctx) {
    return `Você é o Sete, o robozinho que mora na casa da pessoa e conversa por voz em português do Brasil, em tempo real.
Jeito: caloroso, divertido, espontâneo, como um amigo brasileiro bem-humorado. Fale natural ("tá", "né", "olha só"), frases curtas, sem listas. Responda qualquer assunto: curiosidades, conselhos, piadas, futebol, receitas, contas, notícias (use a busca do Google quando precisar de algo atual).
Para mexer na TV, no ar ou tocar algo, use as ferramentas; nunca diga que fez algo sem chamar a ferramenta. Depois de usar uma ferramenta, confirme em poucas palavras.
Se a pessoa se despedir ("tchau", "valeu, só isso", "pode descansar"), despeça-se rapidinho e chame encerrar_conversa.
Agora: ${new Date().toLocaleString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.${ctx.memoria?.length ? `\nO que você sabe da pessoa e da casa: ${ctx.memoria.join('; ')}.` : ''}
Aparelhos: TV ${ctx.tv ? 'conectada' : 'não conectada'}; ar-condicionado ${ctx.ar ? 'conectado' : 'não conectado'}; YouTube na TV ${ctx.youtube ? 'vinculado' : 'não vinculado'}.${ctx.conversa?.length ? `\nÚltimas falas: ${ctx.conversa.join(' | ')}` : ''}`;
  }

  /* ── saída de áudio: toca os pedaços em sequência, sem buracos ── */
  function tocarPCM(b64) {
    if (!st.ctxOut) return;
    const bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; f[i] = v / 32768; }
    const buf = st.ctxOut.createBuffer(1, n, 24000); buf.copyToChannel(f, 0);
    const src = st.ctxOut.createBufferSource(); src.buffer = buf; src.connect(st.ctxOut.destination);
    const t = Math.max(st.ctxOut.currentTime + 0.03, st.proximo); src.start(t); st.proximo = t + buf.duration;
    st.fila.push(src); src.onended = () => { st.fila = st.fila.filter(x => x !== src); if (!st.fila.length) falando(false); };
    falando(true); st.ultimaAtividade = Date.now();
  }
  function calar() { st.fila.forEach(s => { try { s.stop(); } catch {} }); st.fila = []; st.proximo = 0; falando(false); }
  let boca = null;
  function falando(sim) {
    if (st.falando === sim) return; st.falando = sim;
    try { Robot.talk(sim); clearInterval(boca); if (sim) boca = setInterval(() => Robot.word(), 170); } catch {}
    cb.estado(sim ? 'falando' : 'ouvindo');
  }

  /* ── entrada: microfone em 16 kHz, enviado em pedaços de ~0,1 s ── */
  async function abrirMic() {
    st.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    st.ctxIn = new AudioContext({ sampleRate: 16000 });
    if (st.ctxIn.state === 'suspended') await st.ctxIn.resume().catch(() => {});
    const src = st.ctxIn.createMediaStreamSource(st.mic);
    st.proc = st.ctxIn.createScriptProcessor(2048, 1, 1);
    st.proc.onaudioprocess = e => {
      if (!st.ws || st.ws.readyState !== 1 || !st.pronto) return;
      const f = e.inputBuffer.getChannelData(0), b = new Uint8Array(f.length * 2);
      let energia = 0;
      for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); energia += v * v; const s = v < 0 ? v * 0x8000 : v * 0x7fff; b[2 * i] = s & 255; b[2 * i + 1] = (s >> 8) & 255; }
      if (Math.sqrt(energia / f.length) > 0.03) st.ultimaAtividade = Date.now();
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      st.ws.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(s), mimeType: 'audio/pcm;rate=16000' } } }));
    };
    src.connect(st.proc); st.proc.connect(st.ctxIn.destination);
  }
  function fecharMic() {
    try { st.proc?.disconnect(); } catch {} try { st.mic?.getTracks().forEach(t => t.stop()); } catch {} try { st.ctxIn?.close(); } catch {}
    st.proc = st.mic = st.ctxIn = null;
  }

  /* ── sessão ── */
  async function iniciar({ saudacao = 'Estou te ouvindo.' } = {}) {
    if (st.ativo || st.conectando) return true;
    st.conectando = true; st.encerrarDepois = false; cb.estado('conectando');
    try {
      st.ctxOut = st.ctxOut || new AudioContext({ sampleRate: 24000 });
      if (st.ctxOut.state === 'suspended') await st.ctxOut.resume().catch(() => {});
      const [{ token, modelo }] = await Promise.all([api({ acao: 'live-token' }), abrirMic()]);
      await conectar(token, modelo, saudacao);
      st.ativo = true; st.ultimaAtividade = Date.now();
      clearInterval(st.timer); st.timer = setInterval(vigiar, 1000);
      return true;
    } catch (e) {
      reg('não conectou:', String(e.message || e).slice(0, 120)); fecharMic(); try { st.ws?.close(); } catch {} st.ws = null;
      cb.estado('erro'); return false;
    } finally { st.conectando = false; }
  }
  function conectar(token, modelo, saudacao) {
    return new Promise((ok, falha) => {
      const ws = st.ws = new WebSocket(URL_WS + encodeURIComponent(token));
      st.pronto = false;
      const to = setTimeout(() => falha(new Error('demorou para conectar')), 9000);
      ws.onopen = () => {
        const voz = LS.get('as_voz', 'Achird');
        ws.send(JSON.stringify({ setup: {
          model: `models/${modelo}`,
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } }, languageCode: 'pt-BR' } },
          systemInstruction: { parts: [{ text: sistema(cb.contexto()) }] },
          tools: st.comBusca ? [{ googleSearch: {} }, ...FERRAMENTAS] : FERRAMENTAS,
          inputAudioTranscription: {}, outputAudioTranscription: {}
        } }));
      };
      ws.onmessage = async ev => {
        let d; try { d = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch { return; }
        if (d.setupComplete) {
          clearTimeout(to); st.pronto = true; ok(); reg('conectado', modelo);
          if (saudacao) ws.send(JSON.stringify({ realtimeInput: { text: `(A pessoa acabou de te chamar. Diga só: "${saudacao}" e espere ela falar.)` } }));
          return;
        }
        const sc = d.serverContent;
        if (sc) {
          if (sc.interrupted) calar();
          for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) tocarPCM(p.inlineData.data);
          if (sc.inputTranscription?.text) { st.ultimaAtividade = Date.now(); cb.ouvi(sc.inputTranscription.text); }
          if (sc.outputTranscription?.text) cb.disse(sc.outputTranscription.text);
          if (sc.turnComplete && st.encerrarDepois) setTimeout(() => { if (!st.fila.length) encerrar('fim pedido'); else st.fimAoCalar = true; }, 300);
        }
        if (d.toolCall?.functionCalls?.length) {
          const respostas = [];
          for (const f of d.toolCall.functionCalls) {
            let r; try { r = await executar(f.name, f.args || {}); } catch (e) { r = { ok: false, erro: String(e.message || e) }; }
            respostas.push({ name: f.name, id: f.id, response: { result: r } });
          }
          if (ws.readyState === 1) ws.send(JSON.stringify({ toolResponse: { functionResponses: respostas } }));
        }
        if (d.goAway) reg('o Google vai encerrar a sessão em breve');
      };
      ws.onclose = ev => {
        clearTimeout(to);
        const motivo = `${ev.code} ${String(ev.reason || '').slice(0, 120)}`;
        if (!st.pronto) {
          // sem a busca do Google (alguns planos grátis não têm): tenta de novo sem ela
          if (st.comBusca && /search|tool|grounding/i.test(ev.reason || '')) { st.comBusca = false; reg('sem busca do Google:', motivo); return api({ acao: 'live-token' }).then(t => conectar(t.token, t.modelo, saudacao)).then(ok, falha); }
          return falha(new Error(motivo));
        }
        reg('sessão fechada', motivo); encerrar('fechou');
      };
      ws.onerror = () => {};
    });
  }
  async function executar(nome, a) {
    st.ultimaAtividade = Date.now();
    if (nome === 'encerrar_conversa') { st.encerrarDepois = true; return { ok: true }; }
    if (nome === 'lembrar') return cb.acao({ lembrar: a.fato });
    if (nome === 'ver_estado') return cb.acao({ alvo: a.aparelho === 'ar' ? 'ar' : 'tv', estado: true });
    if (nome === 'tocar_youtube') { st.encerrarDepois = true; return cb.acao({ alvo: 'tv', acao: 'youtube', valor: a.busca, ...(a.na_tv ? { naTV: true } : {}), musica: a.musica !== false }); }
    if (nome === 'controlar_ar') return cb.acao({ alvo: 'ar', acao: a.acao, ...(a.valor != null ? { valor: /^\d+$/.test(String(a.valor)) ? +a.valor : a.valor } : {}), ...(a.vezes ? { vezes: a.vezes } : {}) });
    if (nome === 'controlar_tv') {
      if (['pausar', 'continuar', 'proximo', 'anterior'].includes(a.acao)) return cb.acao({ alvo: 'tv', acao: 'yt', valor: a.acao });
      const valor = a.acao === 'tecla' ? String(a.valor || 'OK').toUpperCase() : a.valor != null && /^\d+$/.test(String(a.valor)) ? +a.valor : a.valor;
      return cb.acao({ alvo: 'tv', acao: a.acao, ...(valor != null ? { valor } : {}), ...(a.vezes ? { vezes: a.vezes } : {}) });
    }
    return { ok: false, erro: 'ferramenta desconhecida' };
  }
  /* fecha sozinho depois de um tempo sem ninguém falar (economiza a cota grátis e volta a esperar o "Sete") */
  function vigiar() {
    if (!st.ativo) return;
    if (st.fimAoCalar && !st.fila.length) return encerrar('fim pedido');
    if (!st.falando && Date.now() - st.ultimaAtividade > 20000) encerrar('silêncio');
  }
  function encerrar(motivo = '') {
    if (!st.ativo && !st.ws) return;
    clearInterval(st.timer); st.ativo = false; st.pronto = false; st.fimAoCalar = false;
    try { st.ws?.close(); } catch {} st.ws = null;
    fecharMic();
    setTimeout(calar, st.fila.length ? 4000 : 0);
    reg('encerrado', motivo); cb.estado('fim'); cb.fim(motivo);
  }
  function enviarTexto(t) { if (st.ws?.readyState === 1 && st.pronto) { st.ws.send(JSON.stringify({ realtimeInput: { text: t } })); st.ultimaAtividade = Date.now(); return true; } return false; }

  return { iniciar, encerrar, enviarTexto, on(ev, f) { cb[ev] = f; }, get ativo() { return st.ativo || st.conectando; }, get falando() { return st.falando; } };
})();
