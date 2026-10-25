/* Player do YouTube dentro do app (player oficial embutido, IFrame API).
   Player.tocar(video) · pausar() · continuar() · proximo() · fechar() · ativo / tocando
   Se um vídeo não puder ser embutido (erro 101/150), tenta a próxima opção da busca. */
/* registro do que acontece (vai para o servidor, para diagnóstico) */
const VERSAO_APP = 'v22';
const REG = { linhas: [], envio: null, add(...x) { const l = `${new Date().toLocaleTimeString('pt-BR')} ${x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')}`; this.linhas.push(l); try { console.log('[reg]', l); } catch {} clearTimeout(this.envio); this.envio = setTimeout(() => this.enviar && this.enviar(), 1500); } };
window.addEventListener('error', e => REG.add('ERRO JS', e.message, (e.filename || '').split('/').pop(), e.lineno));
window.addEventListener('unhandledrejection', e => REG.add('ERRO promessa', String(e.reason?.message || e.reason)));
const Player = (() => {
  const wrap = document.getElementById('player-wrap'), titulo = document.getElementById('pl-title');
  let yt = null, pronto = null, fila = [], atual = null, tocando = false, checagem = null;
  const cb = { estado: () => {}, bloqueado: () => {} };
  const somBtn = document.getElementById('pl-som');

  function carregarAPI() {
    if (pronto) return pronto;
    pronto = new Promise(res => {
      window.onYouTubeIframeAPIReady = res;
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true; document.head.appendChild(s);
      setTimeout(res, 8000); // segue mesmo se a API demorar (aí mostra o erro)
    });
    return pronto;
  }

  async function tocar(video) {
    fila = (video.opcoes && video.opcoes.length ? video.opcoes : [video]).slice();
    atual = fila.shift() || video;
    wrap.classList.remove('hidden'); titulo.textContent = atual.titulo || '';
    document.getElementById('pl-abrir').href = `https://www.youtube.com/watch?v=${atual.id}`;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    REG.add('player.tocar', atual.id, atual.titulo, 'wrap visível:', !wrap.classList.contains('hidden'));
    await carregarAPI();
    REG.add('API YT carregada:', !!window.YT?.Player);
    if (!window.YT?.Player) { simples(); return atual; } // sem a API: mostra o vídeo do jeito simples mesmo
    if (!yt) {
      // cria o iframe com permissão de tocar sozinho ("autoplay") e depois liga a API nele
      const box = document.getElementById('yt-player'), f = document.createElement('iframe');
      f.id = 'yt-frame'; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.setAttribute('allowfullscreen', '');
      f.src = `https://www.youtube.com/embed/${atual.id}?enablejsapi=1&autoplay=1&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(location.origin)}`;
      box.replaceChildren(f);
      await new Promise(res => {
        yt = new YT.Player('yt-frame', { events: { onReady: e => { REG.add('player pronto'); try { e.target.unMute(); e.target.playVideo(); } catch {} res(); }, onStateChange: mudou, onError: erro } });
        setTimeout(res, 6000);
      });
    } else { try { yt.unMute(); yt.loadVideoById(atual.id); } catch { yt = null; return tocar({ ...atual, opcoes: [atual, ...fila] }); } }
    conferirSom();
    REG.add('iframe:', !!document.querySelector('#yt-player iframe'), 'altura player:', wrap.offsetHeight);
    return atual;
  }
  /* plano B: iframe direto, sem controle por voz (pausar/próximo pelo próprio vídeo) */
  function simples() {
    const f = document.createElement('iframe'); f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.setAttribute('allowfullscreen', '');
    f.src = `https://www.youtube.com/embed/${atual.id}?autoplay=1&playsinline=1&rel=0`;
    document.getElementById('yt-player').replaceChildren(f); yt = null; pronto = null;
  }
  /* o celular pode bloquear o som de um vídeo que começa sozinho: começa mudo e mostra "Toque para ouvir" */
  function conferirSom() {
    clearTimeout(checagem); somBtn.classList.add('hidden');
    checagem = setTimeout(() => {
      let st = -1, mudo = false; try { st = yt.getPlayerState(); mudo = yt.isMuted(); } catch {}
      REG.add('conferir som: estado', st, 'mudo', mudo);
      if (st === 1 && !mudo) return;
      if (st !== 1) { try { yt.mute(); yt.playVideo(); } catch {} } // mudo, o navegador sempre deixa tocar
      somBtn.classList.remove('hidden'); cb.bloqueado();
    }, 2500);
  }
  somBtn.onclick = () => { try { yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch {} somBtn.classList.add('hidden'); setTimeout(() => cb.estado(estadoAtual()), 600); };
  function estadoAtual() { try { return yt.getPlayerState() === 1 && !yt.isMuted() ? 'tocando' : 'parado'; } catch { return 'parado'; } }
  function mudou(e) {
    const st = e.data; // 1 tocando, 2 pausado, 0 terminou
    REG.add('player estado', st);
    let mudo = false; try { mudo = yt.isMuted(); } catch {}
    tocando = st === 1 && !mudo; // só conta como tocando se tiver som (é quando o robô dança)
    document.getElementById('pl-toggle').textContent = tocando ? '⏸' : '▶';
    if (st === 0 && fila.length) proximo(); else cb.estado(tocando ? 'tocando' : st === 0 ? 'fim' : 'parado');
  }
  function erro(e) {
    REG.add('player erro', e.data);
    // 101/150: o dono não deixa tocar embutido → próxima opção da busca
    if ([100, 101, 150, 5, 2].includes(e.data) && fila.length) { atual = fila.shift(); titulo.textContent = atual.titulo || ''; yt.loadVideoById(atual.id); return; }
    cb.estado('erro');
  }
  function pausar() { try { yt?.pauseVideo(); } catch {} }
  function continuar() { try { yt?.playVideo(); } catch {} conferirSom(); }
  function proximo() { if (!fila.length) return false; atual = fila.shift(); titulo.textContent = atual.titulo || ''; yt?.loadVideoById(atual.id); conferirSom(); return true; }
  function fechar() { clearTimeout(checagem); try { yt?.stopVideo(); } catch {} tocando = false; somBtn.classList.add('hidden'); wrap.classList.add('hidden'); cb.estado('fechado'); }

  document.getElementById('pl-toggle').onclick = () => { let st = -1; try { st = yt.getPlayerState(); } catch {} if (st === 1) pausar(); else { try { yt.unMute(); } catch {} continuar(); } };
  document.getElementById('pl-next').onclick = () => proximo();
  document.getElementById('pl-close').onclick = () => fechar();

  return { tocar, pausar, continuar, proximo, fechar, on(ev, f) { cb[ev] = f; }, get ativo() { return !wrap.classList.contains('hidden'); }, get tocando() { return tocando; }, get atual() { return atual; } };
})();
