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
    const raw = norm(text);
    const t = words2num(raw);
    const num = (re) => { const m = t.match(re); return m ? +m[1] : null; };
    const has = re => re.test(t);

    const tv = has(/\b(tv|televisao|televisor|tevê|teve)\b/), ar = has(/\b(ar|ar condicionado|arcondicionado|climatizador|split)\b/);
    const ligar = has(/\b(liga|ligar|ligue|acende|acender|ativa|ativar|abre|abrir)\b/) && !has(/\bdesliga/);
    const desligar = has(/\b(desliga|desligar|desligue|apaga|apagar|desativa|desativar)\b/);
    const estado = has(/\b(como (esta|ta)|status|estado|ta ligad\w*|esta ligad\w*|qual a temperatura|que temperatura)\b/);

    // ── TV ──
    const app = (t.match(/\b(netflix|youtube|you tube|prime|amazon|globoplay|globo play|disney)\b/) || [])[1];
    const isTv = tv || /\b(volume|canal|netflix|youtube|you tube|mudo|globoplay|hdmi)\b/.test(t);
    if (isTv && !ar) {
      if (app) return { alvo: 'tv', acao: 'app', valor: { 'you tube': 'youtube', amazon: 'prime', 'globo play': 'globoplay' }[app] || app };
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
    const temp = num(/\b(\d{2}) ?(?:graus|grau|°|o)\b/) ?? (ar ? num(/\b(?:em|para|pra|no|na|a) (\d{2})\b/) : null);
    const isAr = ar || temp != null || /\b(esfria|esfriar|gelar|resfriar|aquecer|esquentar|ventilacao|ventilar)\b/.test(t);
    if (isAr) {
      if (estado) return { alvo: 'ar', estado: true };
      if (desligar) return { alvo: 'ar', acao: 'desligar' };
      if (temp != null && temp >= 16 && temp <= 30) return { alvo: 'ar', acao: 'temperatura', valor: temp };
      if (temp != null) return { erro: 'A temperatura do ar vai de 16 a 30 graus.' };
      if (has(/\b(ventilacao|velocidade|vento)\b/)) {
        const v = has(/\b(alta|maxima|forte|alto)\b/) ? 'alta' : has(/\b(baixa|minima|fraca|baixo)\b/) ? 'baixa' : has(/\b(media|medio)\b/) ? 'media' : has(/\bauto/) ? 'auto' : null;
        if (v) return { alvo: 'ar', acao: 'ventilacao', valor: v };
      }
      const modo = has(/\b(frio|gelar|esfriar|esfria|resfriar|refrigerar)\b/) ? 'frio' : has(/\b(quente|aquecer|esquentar|aquecimento|calor)\b/) ? 'quente'
        : has(/\b(desumidificar|seco|umidade)\b/) ? 'seco' : has(/\b(ventilar|so ventilar|modo ventilador|ventilador)\b/) ? 'ventilar' : has(/\bmodo auto/) ? 'auto' : null;
      if (modo) return { alvo: 'ar', acao: 'modo', valor: modo };
      if (ligar || ar) return { alvo: 'ar', acao: 'ligar' };
    }
    return null;
  }

  /** frase curta para o assistente falar depois de executar */
  function reply(c, nome) {
    const tvs = { ligar: 'Ligando a TV', desligar: 'Desligando a TV', 'volume+': 'Aumentando o volume', 'volume-': 'Abaixando o volume', mudo: 'TV no mudo', som: 'Som de volta', 'canal+': 'Próximo canal', 'canal-': 'Canal anterior' };
    const ars = { ligar: 'Ligando o ar', desligar: 'Desligando o ar' };
    const modos = { frio: 'frio', quente: 'quente', seco: 'desumidificar', ventilar: 'ventilar', auto: 'automático' };
    if (c.alvo === 'tv') return tvs[c.acao] || (c.acao === 'volume' ? `Volume em ${c.valor}` : c.acao === 'canal' ? `Mudando para o canal ${c.valor}` : c.acao === 'app' ? `Abrindo ${c.valor[0].toUpperCase() + c.valor.slice(1)}` : c.acao === 'entrada' ? `Mudando para ${c.valor}` : 'Feito');
    if (c.alvo === 'ar') return ars[c.acao] || (c.acao === 'temperatura' ? `Ar em ${c.valor} graus` : c.acao === 'modo' ? `Ar no modo ${modos[c.valor]}` : c.acao === 'ventilacao' ? `Ventilação ${c.valor}` : 'Feito');
    return 'Feito';
  }

  root.Comandos = { parse, reply, norm };
  if (typeof module !== 'undefined') module.exports = root.Comandos;
})(typeof window !== 'undefined' ? window : globalThis);
