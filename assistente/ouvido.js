/* Ouvido do robô (com o app aberto na tela):
   · duas palmas → chama o robô        · "Hi Tec" → chama o robô
   · música tocando no ambiente → avisa (com o ritmo em batidas por minuto) para ele dançar
   O microfone é analisado só aqui no aparelho; nada de áudio é enviado para lugar nenhum. */
const Ouvido = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const st = { ativo: false, pausado: false, stream: null, ctx: null, an: null, timer: null, wake: null, wakeOk: !!SR, lock: null };
  const cb = { palmas: () => {}, wake: () => {}, musica: () => {} };
  // análise
  let piso = 0.01, ultimoPico = 0, palmas = [], hist = [], onsetHist = [], prevE = 0, musica = false, silencioDesde = 0, musicaDesde = 0;
  const HZ = 50; // amostras por segundo

  async function ligar() {
    if (st.ativo) return true;
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch { return false; }
    st.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = st.ctx.createMediaStreamSource(st.stream);
    st.an = st.ctx.createAnalyser(); st.an.fftSize = 1024; st.an.smoothingTimeConstant = 0;
    src.connect(st.an);
    st.ativo = true; st.pausado = false;
    st.timer = setInterval(analisar, 1000 / HZ);
    iniciarWake(); manterTelaAcesa();
    return true;
  }
  function desligar() {
    st.ativo = false; clearInterval(st.timer);
    try { st.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { st.ctx?.close(); } catch {}
    st.stream = st.ctx = st.an = null; pararWake(); soltarTela();
    if (musica) { musica = false; cb.musica(false); }
  }
  /** enquanto o robô fala ou escuta uma frase, o ouvido "tampa" (evita ouvir a si mesmo) */
  function pausar() { st.pausado = true; pararWake(); }
  function retomar() { if (!st.ativo) return; st.pausado = false; palmas = []; setTimeout(iniciarWake, 400); }

  const tdBuf = new Float32Array(1024), fBuf = new Uint8Array(512);
  function analisar() {
    if (!st.an) return;
    st.an.getFloatTimeDomainData(tdBuf);
    let s = 0, pico = 0;
    for (let i = 0; i < tdBuf.length; i++) { const v = tdBuf[i]; s += v * v; if (Math.abs(v) > pico) pico = Math.abs(v); }
    const rms = Math.sqrt(s / tdBuf.length), agora = performance.now();
    st.an.getByteFrequencyData(fBuf);
    // graves (≈ 40–250 Hz) para o ritmo
    const binHz = st.ctx.sampleRate / st.an.fftSize; let grave = 0, n = 0;
    for (let i = Math.max(1, Math.floor(40 / binHz)); i <= Math.ceil(250 / binHz); i++) { grave += fBuf[i]; n++; }
    grave = n ? grave / n / 255 : 0;
    let agudo = 0, na = 0; for (let i = Math.floor(2000 / binHz); i < Math.min(fBuf.length, Math.floor(9000 / binHz)); i++) { agudo += fBuf[i]; na++; }
    agudo = na ? agudo / na / 255 : 0;
    detectarMusica(rms, grave, agora);
    if (st.pausado) return;
    detectarPalmas(rms, pico, agora, agudo, grave);
    if (!musica && !musicaDesde) piso = piso * 0.995 + Math.min(rms, piso * 3 + 0.002) * 0.005; // o "silêncio" não sobe com música
  }

  /* palma: estalo curto e forte bem acima do ruído; duas em 0,15–0,8 s e depois silêncio */
  let candidata = null;
  function detectarPalmas(rms, pico, t, agudo, grave) {
    if (musica || musicaDesde) { palmas = []; return; }
    // palma é aguda e "espalhada"; bumbo e batidas na mesa são graves
    if (pico > 0.35 && rms > piso * 6 && rms > 0.05 && agudo > 0.35 && agudo > grave * 0.8 && t - ultimoPico > 120) { ultimoPico = t; candidata = { t, rms }; return; }
    if (candidata && t - candidata.t > 60 && t - candidata.t < 200) {
      // o som caiu rápido? então foi estalo (palma), não fala ou música
      if (rms < candidata.rms * 0.45) { palmas.push(candidata.t); candidata = null; palmas = palmas.filter(x => t - x < 1500); }
      else if (t - candidata.t > 150) candidata = null;
    }
    if (palmas.length >= 2) {
      const [a, b] = palmas.slice(-2), d = b - a;
      if (d > 150 && d < 800 && t - b > 650) { if (palmas.length === 2) cb.palmas(); palmas = []; }
      else if (t - b > 900) palmas = [];
    }
  }

  /* música: som contínuo por alguns segundos com batida regular nos graves (autocorrelação 60–180 BPM) */
  function detectarMusica(rms, grave, t) {
    const onset = Math.max(0, grave - prevE); prevE = grave;
    hist.push(rms); onsetHist.push(onset);
    const MAX = HZ * 6; if (hist.length > MAX) { hist.shift(); onsetHist.shift(); }
    if (hist.length < HZ * 4) return;
    const alto = hist.filter(x => x > 0.012).length / hist.length; // quanto do tempo teve som (limite fixo)
    let bpm = 0, forca = 0;
    if (alto > 0.85) {
      const o = onsetHist, m = o.reduce((a, b) => a + b, 0) / o.length;
      const oc = o.map(x => x - m), e0 = oc.reduce((a, b) => a + b * b, 0) || 1;
      for (let lag = Math.round(HZ * 60 / 180); lag <= Math.round(HZ * 60 / 60); lag++) {
        let c = 0; for (let i = lag; i < oc.length; i++) c += oc[i] * oc[i - lag];
        c /= e0; if (c > forca) { forca = c; bpm = 60 * HZ / lag; }
      }
    }
    const temRitmo = alto > 0.85 && forca > 0.22;
    if (st.debug) st.debug.push([Math.round(alto * 100), +forca.toFixed(2), Math.round(bpm)]);
    if (temRitmo) {
      silencioDesde = 0; if (!musicaDesde) musicaDesde = t;
      if (!musica && t - musicaDesde > 2500) { musica = true; cb.musica(true, Math.round(bpm)); }
      else if (musica && Math.random() < 0.05) cb.musica(true, Math.round(bpm));
    } else {
      musicaDesde = 0; if (!silencioDesde) silencioDesde = t;
      if (musica && t - silencioDesde > 3500) { musica = false; cb.musica(false); }
    }
  }

  /* "Hi Tec": reconhecimento de voz contínuo, só procurando a palavra de chamada */
  const WAKE = /\b(hi|hai|rai|ai|oi|hey|hei|ei|high|right|hy)[ -]?(tec|tech|tek|teck|tequi|teco)\b|\b(hitec|hitech|haitec|raitec|aitec|hytec|haitek|hitek)\b/;
  function iniciarWake() {
    if (!st.ativo || st.pausado || !st.wakeOk || st.wake) return;
    try {
      const r = st.wake = new SR(); r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true;
      r.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          if (WAKE.test(t)) { pararWake(); cb.wake(t); return; }
        }
      };
      r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') st.wakeOk = e.error === 'audio-capture' ? st.wakeOk : false; if (e.error === 'audio-capture') st.wakeConflito = true; };
      r.onend = () => { if (st.wake === r) st.wake = null; if (st.ativo && !st.pausado && !st.wakeConflito) setTimeout(iniciarWake, 300); };
      r.start();
    } catch { st.wake = null; }
  }
  function pararWake() { const r = st.wake; st.wake = null; try { r?.abort(); } catch {} }

  /* tela acesa enquanto o ouvido está ligado */
  async function manterTelaAcesa() { try { st.lock = await navigator.wakeLock?.request('screen'); } catch {} }
  function soltarTela() { try { st.lock?.release(); } catch {} st.lock = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.ativo) { manterTelaAcesa(); if (st.ctx?.state === 'suspended') st.ctx.resume(); } });

  return {
    ligar, desligar, pausar, retomar,
    on(ev, f) { cb[ev] = f; },
    get ativo() { return st.ativo; }, debug(on) { st.debug = on ? [] : null; }, get dbg() { return st.debug; }, get ouveNome() { return st.wakeOk && !st.wakeConflito; }, get musica() { return musica; },
    _sim: { palmas: () => cb.palmas(), wake: () => cb.wake('hi tec'), musica: (on, bpm) => cb.musica(on, bpm) } // para testes
  };
})();
