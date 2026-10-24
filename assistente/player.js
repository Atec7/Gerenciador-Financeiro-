/* Player do YouTube dentro do app (player oficial embutido, IFrame API).
   Player.tocar(video) · pausar() · continuar() · proximo() · fechar() · ativo / tocando
   Se um vídeo não puder ser embutido (erro 101/150), tenta a próxima opção da busca. */
const Player = (() => {
  const wrap = document.getElementById('player-wrap'), titulo = document.getElementById('pl-title');
  let yt = null, pronto = null, fila = [], atual = null, tocando = false;
  const cb = { estado: () => {} };

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
    await carregarAPI();
    if (!window.YT?.Player) throw new Error('Não consegui carregar o player do YouTube.');
    if (!yt) {
      await new Promise(res => {
        yt = new YT.Player('yt-player', {
          videoId: atual.id, playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
          events: { onReady: e => { try { e.target.playVideo(); } catch {} res(); }, onStateChange: mudou, onError: erro }
        });
      });
    } else yt.loadVideoById(atual.id);
    return atual;
  }
  function mudou(e) {
    const st = e.data; // 1 tocando, 2 pausado, 0 terminou
    tocando = st === 1;
    document.getElementById('pl-toggle').textContent = tocando ? '⏸' : '▶';
    if (st === 0 && fila.length) proximo(); else cb.estado(tocando ? 'tocando' : st === 0 ? 'fim' : 'parado');
  }
  function erro(e) {
    // 101/150: o dono não deixa tocar embutido → próxima opção da busca
    if ([100, 101, 150, 5, 2].includes(e.data) && fila.length) { atual = fila.shift(); titulo.textContent = atual.titulo || ''; yt.loadVideoById(atual.id); return; }
    cb.estado('erro');
  }
  function pausar() { try { yt?.pauseVideo(); } catch {} }
  function continuar() { try { yt?.playVideo(); } catch {} }
  function proximo() { if (!fila.length) return false; atual = fila.shift(); titulo.textContent = atual.titulo || ''; yt?.loadVideoById(atual.id); return true; }
  function fechar() { try { yt?.stopVideo(); } catch {} tocando = false; wrap.classList.add('hidden'); cb.estado('fechado'); }

  document.getElementById('pl-toggle').onclick = () => (tocando ? pausar() : continuar());
  document.getElementById('pl-next').onclick = () => proximo();
  document.getElementById('pl-close').onclick = () => fechar();

  return { tocar, pausar, continuar, proximo, fechar, on(ev, f) { cb[ev] = f; }, get ativo() { return !wrap.classList.contains('hidden'); }, get tocando() { return tocando; }, get atual() { return atual; } };
})();
