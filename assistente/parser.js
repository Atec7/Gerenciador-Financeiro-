/* Entende o que foi falado (português) e transforma em comando.
   Ex.: "liga a TV" → {alvo:'tv', acao:'ligar'} · "ar em 22 graus" → {alvo:'ar', acao:'temperatura', valor:22} */
(function (root) {
  const NUM = {
    zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
    vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100
  };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s%]/g, ' ').replace(/\s+/g, ' ').trim();
  /** "vinte e dois" → 22 (até 100) */
  const words2num = s => s.replace(/\b(vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)( e (um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?\b/g,
    (m, d, _x, u) => String(NUM[d] + (u ? NUM[u] : 0)))
    .replace(/\b(zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|cem)\b/g, m => String(NUM[m]));

  function parse(text) {
    // erros comuns do reconhecimento de voz: "aro 20" / "arno 20" = "ar no 20"
    const raw = norm(text).replace(/\b(aro|arno|aron)\b/g, 'ar no').replace(/\bar(\d{2})\b/g, 'ar $1');
    const t = words2num(raw);
    const num = (re) => { const m = t.match(re); return m ? +m[1] : null; };
    const has = re => re.test(t);

    const tv = has(/\b(tv|televisao|televisor|tevê|teve)\b/), ar = has(/\b(ar|ar condicionado|arcondicionado|climatizador|split)\b/);
    const ligar = has(/\b(liga|ligar|ligue|acende|acender|ativa|ativar|abre|abrir)\b/) && !has(/\bdesliga/);
    const desligar = has(/\b(desliga|desligar|desligue|apaga|apagar|desativa|desativar)\b/);
    const estado = has(/\b(como (esta|ta)|status|estado|ta ligad\w*|esta ligad\w*|qual a temperatura|que temperatura)\b/);

    // ── TV: trocar a TV ativa do YouTube ("usar a TV do quarto", "muda pra TV da sala") ──
    const troca = t.match(/^(?:usa|usar|use|muda|mudar|troca|trocar|vai|passa|seleciona|selecionar|escolhe|escolher|conecta)(?: para| pra| pro| na| no| a| o)? (?:a |o )?(?:tv|televisao) (?:da|do|de|dos|das) (.+)$/)
      || t.match(/^(?:usa|usar|use|muda pra|mudar pra|troca pra|trocar para|troca para) (?:a |o )?(?:tv|televisao) (.+)$/);
    if (troca) return { alvo: 'tv', acao: 'tela', valor: troca[1].trim() };

    // ── TV: YouTube (pesquisar e tocar um vídeo/música) ──
    const yt = /\b(youtube|you tube)\b/.test(t);
    const verboTocar = raw.match(/^(?:robo |ei |por favor )?(toca|tocar|toque|coloca|colocar|coloque|poe|por|bota|botar|passa|reproduz|reproduzir|quero (?:ver|ouvir|assistir)|busca|buscar|procura|procurar|pesquisa|pesquisar|abre o video|abre a musica|assistir|ouvir)\b\s*(.*)$/);
    if (verboTocar && !/\b(volume|canal|mudo|graus|ar condicionado)\b/.test(t)) {
      const local = /\b(aqui|no celular|no telefone|no app|no aplicativo|em voce|na sua tela|nessa tela|no robo)\b/.test(raw);
      // por padrão toca aqui no app; só vai para a TV quando a pessoa pede ("na TV", "na televisão", "na tela grande")
      const naTV = !local && /\b(na|pra|para a|pela) (tv|televisao|tela grande|smart)\b|\bna (sala|tv da sala|tv do quarto)\b/.test(raw);
      let q = verboTocar[2]
        .replace(/\b(aqui|no celular|no telefone|no app|no aplicativo|em voce|na sua tela|nessa tela|no robo)\b/g, ' ')
        .replace(/\b(no|na|pelo|pela|pra|para a) (youtube|you tube|tv|televisao|tela grande)\b/g, ' ').replace(/\b(youtube|you tube)\b/g, ' ')
        .replace(/^(alguma coisa|algo|umas? musicas?|uns videos?|o melhor|as melhores|os melhores) (do|da|de|dos|das)\b/, ' ')
        .replace(/^(o |a )?(videos?|clipes?|musicas?|cancao|cancoes|som|playlist|show|serie|filme|novela|desenho)( de| do| da| dos| das)?\b/, ' ')
        .replace(/^(um|uma|uns|umas) /, ' ')
        .replace(/^(musica|musicas|video|videos) (do|da|de|dos|das)\b/, ' ').replace(/\b(pra mim|para mim|ai|agora|por favor)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const plataforma = (t.match(/\b(?:na|no) (netflix|prime|globoplay|globo play|disney|spotify|max)\b/) || [])[1];
      if (plataforma) return { alvo: 'tv', acao: 'app', valor: { 'globo play': 'globoplay' }[plataforma] || plataforma, pedido: q.replace(new RegExp(`\\b(na|no) ${plataforma}\\b`), '').trim() };
      if (q && q.split(' ').length <= 12 && (yt || local || /^(toca|tocar|toque|quero ouvir|ouvir|reproduz)/.test(verboTocar[1]) || /\b(videos?|clipes?|musicas?)\b/.test(raw)))
        return { alvo: 'tv', acao: 'youtube', valor: q, ...(naTV ? { naTV: true } : local ? { local: true } : {}), musica: !/\b(videos? de|receita|tutorial|aula|noticia|jornal|desenho|filme|documentario|como fazer)\b/.test(raw) };
    }
    // ── TV: tocar/pausar/próximo ──
    if (/^(pausa|pausar|pause|para|parar|da pause|da um pause)( (o|a|na|no))? ?(video|musica|filme|serie|netflix|youtube|tv|globoplay|prime|disney|max|episodio)?$/.test(t)) return { alvo: 'tv', acao: 'yt', valor: 'pausar' };
    if (/^(continua|continuar|despausa|despausar|play|da play|volta a tocar|retoma|retomar|solta)( (o|a|na|no))? ?(video|musica|filme|serie|netflix|youtube|tv|globoplay|prime|disney|max|episodio)?$/.test(t)) return { alvo: 'tv', acao: 'yt', valor: 'continuar' };
    if (/\b(proximo video|proxima musica|proximo clipe|pula|pula a musica|pula o video|pula essa|pular|passa (a musica|o video|pra proxima))\b/.test(t)) return { alvo: 'tv', acao: 'yt', valor: 'proximo' };
    if (/\b(video anterior|musica anterior|volta a musica|volta o video)\b/.test(t)) return { alvo: 'tv', acao: 'yt', valor: 'anterior' };
    // ── TV: controle remoto por voz (frases curtas) ──
    const vezesT = num(/\b(\d{1,2}) (?:vezes|vez)\b/) || 1, tt = t.replace(/\b\d{1,2} (vezes|vez)\b/, '').trim();
    const TEC = [[/^(pra |para )?(cima|sobe|subir)$/, 'UP'], [/^(pra |para )?(baixo|desce|descer)$/, 'DOWN'], [/^(pra |para a |para |pra )?esquerda$/, 'LEFT'], [/^(pra |para a |para |pra )?direita$/, 'RIGHT'],
      [/^(ok|okay|seleciona|selecionar|confirma|confirmar|entra|entrar|enter|aperta ok|clica)$/, 'OK'], [/^(voltar|volta|volta uma tela|retorna)$/, 'BACK'], [/^(home|inicio|tela inicial|menu inicial|vai pro inicio)$/, 'HOME'], [/^menu$/, 'MENU']];
    for (const [re, k] of TEC) if (re.test(tt)) return { alvo: 'tv', acao: 'tecla', valor: k, vezes: vezesT };

    // ── TV ──
    const app = (t.match(/\b(netflix|youtube|you tube|prime|amazon|globoplay|globo play|disney|spotify|apple tv|max|hbo|pluto|deezer|twitch)\b/) || [])[1];
    const isTv = tv || /\b(volume|canal|netflix|youtube|you tube|mudo|som|globoplay|hdmi|spotify|disney|prime)\b/.test(t);
    if (isTv && !ar) {
      if (app) return { alvo: 'tv', acao: 'app', valor: { 'you tube': 'youtube', amazon: 'prime', 'globo play': 'globoplay', 'apple tv': 'appletv', hbo: 'max' }[app] || app };
      if (has(/\b(tira|tirar|sai|sair) do mudo\b|\bvolta o som\b|\bativa o som\b/)) return { alvo: 'tv', acao: 'som' };
      if (has(/\b(mudo|silencia|silenciar|sem som)\b/)) return { alvo: 'tv', acao: 'mudo' };
      const hdmi = num(/\bhdmi ?(\d)\b/); if (hdmi) return { alvo: 'tv', acao: 'entrada', valor: `HDMI${hdmi}` };
      if (has(/\bvolume\b/)) {
        const v = num(/\bvolume (?:no |para |pra |em |a |no nivel |)?(\d{1,3})\b/) ?? num(/\b(\d{1,3}) de volume\b/);
        if (v != null) return { alvo: 'tv', acao: 'volume', valor: v };
        const vezes = num(/\b(\d{1,2}) (?:vezes|pontos|niveis)\b/) || 3;
        if (has(/\b(aumenta|aumentar|sobe|subir|mais alto|aumente|suba)\b/)) return { alvo: 'tv', acao: 'volume+', vezes };
        if (has(/\b(abaixa|abaixar|diminui|diminuir|baixa|baixar|mais baixo|diminua|abaixe)\b/)) return { alvo: 'tv', acao: 'volume-', vezes };
      }
      if (has(/\bcanal\b/)) {
        const c = num(/\bcanal (?:para |pra |no |)?(\d{1,4})\b/);
        if (c != null) return { alvo: 'tv', acao: 'canal', valor: c };
        if (has(/\b(proximo|seguinte|sobe|avanca|passa)\b/)) return { alvo: 'tv', acao: 'canal+' };
        if (has(/\b(anterior|volta|desce|voltar)\b/)) return { alvo: 'tv', acao: 'canal-' };
      }
      if (estado) return { alvo: 'tv', estado: true };
      if (desligar) return { alvo: 'tv', acao: 'desligar' };
      if (ligar) return { alvo: 'tv', acao: 'ligar' };
    }

    // ── Ar-condicionado ──
    const temp = num(/\b(\d{2}) ?(?:graus|grau|°|o)\b/) ?? (ar || /\btemperatura\b/.test(t) ? num(/\b(?:em|para|pra|no|na|a|ar|temperatura) (\d{2})\b/) : null);
    const isAr = ar || temp != null || /\b(temperatura|esfria|esfriar|gelar|resfriar|aquecer|esquentar|ventilacao|ventilar)\b/.test(t);
    if (isAr) {
      if (estado) return { alvo: 'ar', estado: true };
      if (desligar) return { alvo: 'ar', acao: 'desligar' };
      if (temp != null && temp >= 16 && temp <= 30) return { alvo: 'ar', acao: 'temperatura', valor: temp };
      if (temp != null) return { erro: 'A temperatura do ar vai de 16 a 30 graus.' };
      // subir/baixar um pouco: "aumenta o ar", "abaixa a temperatura", "deixa mais frio"
      const vezes = num(/\b(\d) graus?\b/) || 1;
      if (has(/\b(aumenta|aumentar|sobe|subir|levanta)\b/) || has(/\bmais quente\b/)) return { alvo: 'ar', acao: 'temperatura+', vezes };
      if (has(/\b(abaixa|abaixar|baixa|baixar|diminui|diminuir|desce|descer)\b/) || has(/\bmais frio\b/)) return { alvo: 'ar', acao: 'temperatura-', vezes };
      if (has(/\b(ventilacao|velocidade|vento)\b/)) {
        const v = has(/\b(alta|maxima|forte|alto)\b/) ? 'alta' : has(/\b(baixa|minima|fraca|baixo)\b/) ? 'baixa' : has(/\b(media|medio)\b/) ? 'media' : has(/\bauto/) ? 'auto' : null;
        if (v) return { alvo: 'ar', acao: 'ventilacao', valor: v };
      }
      const modo = has(/\b(frio|gelar|esfriar|esfria|resfriar|refrigerar)\b/) ? 'frio' : has(/\b(quente|aquecer|esquentar|aquecimento|calor)\b/) ? 'quente'
        : has(/\b(desumidificar|seco|umidade)\b/) ? 'seco' : has(/\b(ventilar|so ventilar|modo ventilador|ventilador)\b/) ? 'ventilar' : has(/\bmodo auto/) ? 'auto' : null;
      if (modo) return { alvo: 'ar', acao: 'modo', valor: modo };
      if (ligar) return { alvo: 'ar', acao: 'ligar' };
    }
    return null;
  }

  /** frase curta para o assistente falar depois de executar */
  function reply(c, nome) {
    const tvs = { ligar: 'Ligando a TV', desligar: 'Desligando a TV', 'volume+': 'Aumentando o volume', 'volume-': 'Abaixando o volume', mudo: 'TV no mudo', som: 'Som de volta', 'canal+': 'Próximo canal', 'canal-': 'Canal anterior' };
    const ars = { ligar: 'Ligando o ar', desligar: 'Desligando o ar' };
    const modos = { frio: 'frio', quente: 'quente', seco: 'desumidificar', ventilar: 'ventilar', auto: 'automático' };
    const NOMES = { netflix: 'Netflix', youtube: 'YouTube', prime: 'Prime Video', disney: 'Disney+', spotify: 'Spotify', globoplay: 'Globoplay', appletv: 'Apple TV', max: 'Max', pluto: 'Pluto TV', deezer: 'Deezer', twitch: 'Twitch' };
    const YTR = { pausar: 'Pausado', continuar: 'Continuando', proximo: 'Próximo', anterior: 'Voltando' };
    const TECR = { UP: 'Pra cima', DOWN: 'Pra baixo', LEFT: 'Esquerda', RIGHT: 'Direita', OK: 'Ok', BACK: 'Voltando', HOME: 'Tela inicial', MENU: 'Menu' };
    if (c.alvo === 'tv' && c.acao === 'app' && c.pedido) return `Abrindo ${NOMES[c.valor] || c.valor}. Escolher ${c.pedido} direto a ${NOMES[c.valor] || c.valor} não deixa, mas eu navego com você: diga pra baixo, direita, ok ou voltar.`;
    if (c.alvo === 'tv' && c.acao === 'youtube') return nome ? `Tocando ${nome} na TV` : `Procurando ${c.valor} no YouTube`;
    if (c.alvo === 'tv') return tvs[c.acao] || (c.acao === 'volume' ? `Volume em ${c.valor}` : c.acao === 'canal' ? `Mudando para o canal ${c.valor}` : c.acao === 'app' ? `Abrindo ${NOMES[c.valor] || c.valor}` : c.acao === 'entrada' ? `Mudando para ${c.valor}` : c.acao === 'yt' ? YTR[c.valor] : c.acao === 'tecla' ? TECR[c.valor] : 'Feito');
    if (c.alvo === 'ar') return ars[c.acao] || (c.acao === 'temperatura' ? `Ar em ${c.valor} graus` : c.acao === 'modo' ? `Ar no modo ${modos[c.valor]}` : c.acao === 'ventilacao' ? `Ventilação ${c.valor}` : 'Feito');
    return 'Feito';
  }

  root.Comandos = { parse, reply, norm };
  if (typeof module !== 'undefined') module.exports = root.Comandos;
})(typeof window !== 'undefined' ? window : globalThis);
