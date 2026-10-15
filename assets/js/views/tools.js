/* ═══════════ FERRAMENTAS / CALCULADORAS ═══════════ */

const TOOLS = [
  ['juros', 'up', 'Juros compostos'],
  ['avista', 'cart', 'À vista ou parcelado'],
  ['financ', 'bank', 'Financiamento'],
  ['dividir', 'user', 'Dividir conta'],
  ['pct', 'calc', 'Porcentagem'],
  ['dias', 'calendar', 'Dias úteis'],
  ['senha', 'lock', 'Gerador de senha']
];

const rowR = (l, v, cls = '') => `<div class="row ${cls}"><span class="muted">${l}</span><b class="num">${v}</b></div>`;
const num = (el, id) => parseMoney($('#' + id, el)?.value) || 0;

Views.tools = {
  tab: 'juros',
  render(el) {
    el.innerHTML = `
      <div class="chips tool-tabs" id="tl-tabs">${TOOLS.map(([id, e, n]) => `<button class="chip ${this.tab === id ? 'active' : ''}" data-t="${id}">${icon(e, 'i-sm')} ${n}</button>`).join('')}</div>
      <div class="grid-2" style="align-items:start">
        <div class="card" id="tl-form">${this.forms[this.tab]()}</div>
        <div class="card" id="tl-out"></div>
      </div>`;
    $('#tl-tabs', el).onclick = e => { const c = e.target.closest('[data-t]'); if (c) { this.tab = c.dataset.t; this.render(el); } };
    const f = $('#tl-form', el), out = $('#tl-out', el), calc = () => { out.innerHTML = this.calc[this.tab](f, out); };
    f.addEventListener('input', calc); f.addEventListener('change', calc);
    f.addEventListener('click', e => { if (e.target.closest('[data-recalc]')) calc(); });
    out.addEventListener('click', e => { const c = e.target.closest('[data-copy]'); if (c) copyText(c.dataset.copy, 'Senha copiada'); if (e.target.closest('[data-recalc]')) calc(); });
    calc();
  },

  forms: {
    juros: () => `
      <div class="card-head"><h3>Simulador de investimento</h3></div>
      <div class="fields-2">
        <div class="field"><label>Valor inicial (R$)</label><input id="j-p" inputmode="decimal" value="1.000,00"></div>
        <div class="field"><label>Aporte mensal (R$)</label><input id="j-a" inputmode="decimal" value="300,00"></div>
        <div class="field"><label>Taxa de juros (%)</label><input id="j-i" inputmode="decimal" value="1,0"></div>
        <div class="field"><label>Período da taxa</label><select id="j-t"><option value="m">ao mês</option><option value="a">ao ano</option></select></div>
      </div>
      <div class="field"><label>Prazo: <b id="j-n-l">24 meses</b></label><input type="range" id="j-n" min="1" max="360" value="24"></div>`,
    avista: () => `
      <div class="card-head"><h3>À vista ou parcelado</h3></div>
      <div class="field"><label>Preço à vista (com desconto)</label><input id="v-av" inputmode="decimal" value="900,00"></div>
      <div class="fields-2">
        <div class="field"><label>Nº de parcelas</label><input id="v-n" inputmode="numeric" value="10"></div>
        <div class="field"><label>Valor da parcela</label><input id="v-p" inputmode="decimal" value="100,00"></div>
      </div>
      <div class="field"><label>Quanto seu dinheiro rende (% ao mês)</label><input id="v-r" inputmode="decimal" value="0,9"><span class="hint">Ex.: CDB 100% do CDI ≈ 0,9% a.m.; poupança ≈ 0,6% a.m.</span></div>`,
    financ: () => `
      <div class="card-head"><h3>Financiamento / empréstimo</h3></div>
      <div class="field"><label>Valor financiado (R$)</label><input id="f-v" inputmode="decimal" value="20.000,00"></div>
      <div class="fields-2">
        <div class="field"><label>Juros (% ao mês)</label><input id="f-i" inputmode="decimal" value="1,5"></div>
        <div class="field"><label>Nº de parcelas</label><input id="f-n" inputmode="numeric" value="48"></div>
      </div>`,
    dividir: () => `
      <div class="card-head"><h3>Divisão de conta</h3></div>
      <div class="field"><label>Valor total (R$)</label><input id="d-t" inputmode="decimal" value="250,00"></div>
      <div class="fields-2">
        <div class="field"><label>Pessoas</label><input id="d-p" inputmode="numeric" value="4"></div>
        <div class="field"><label>Taxa de serviço (%)</label><input id="d-g" inputmode="decimal" value="10"></div>
      </div>`,
    pct: () => `
      <div class="card-head"><h3>Calculadora de porcentagem</h3></div>
      <div class="fields-2">
        <div class="field"><label>Valor A</label><input id="p-a" inputmode="decimal" value="15"></div>
        <div class="field"><label>Valor B</label><input id="p-b" inputmode="decimal" value="200"></div>
      </div>
      <p class="hint muted" style="font-size:13px">Os resultados mostram várias contas ao mesmo tempo com A e B.</p>`,
    dias: () => `
      <div class="card-head"><h3>Dias úteis</h3></div>
      <div class="fields-2">
        <div class="field"><label>De</label><input type="date" id="w-a" value="${today()}"></div>
        <div class="field"><label>Até</label><input type="date" id="w-b" value="${addDays(today(), 30)}"></div>
      </div>
      <div class="fields-2">
        <div class="field"><label>Mês</label><input type="month" id="w-m" value="${curYM()}"></div>
        <div class="field"><label>Qual dia útil?</label><input id="w-n" inputmode="numeric" value="${Settings.get('payday')}"></div>
      </div>
      <span class="hint muted">Considera feriados nacionais e bancários${Settings.get('saturdayBusiness') ? ' · sábado conta como dia útil' : ''}.</span>`,
    senha: () => `
      <div class="card-head"><h3>Gerador de senha</h3></div>
      <div class="field"><label>Tamanho: <b id="g-l-l">16</b></label><input type="range" id="g-l" min="6" max="48" value="16"></div>
      <div class="stack" style="gap:10px">
        <label class="switch"><input type="checkbox" id="g-u" checked><i></i>Letras maiúsculas</label>
        <label class="switch"><input type="checkbox" id="g-lo" checked><i></i>Letras minúsculas</label>
        <label class="switch"><input type="checkbox" id="g-d" checked><i></i>Números</label>
        <label class="switch"><input type="checkbox" id="g-s" checked><i></i>Símbolos</label>
      </div>`
  },

  calc: {
    juros(f) {
      const n = +$('#j-n', f).value; $('#j-n-l', f).textContent = n >= 12 ? `${n} meses (${fmtNum(n / 12, n % 12 ? 1 : 0)} ano${n >= 24 ? 's' : ''})` : `${n} meses`;
      let i = num(f, 'j-i') / 100; if ($('#j-t', f).value === 'a') i = Math.pow(1 + i, 1 / 12) - 1;
      const P = num(f, 'j-p'), A = num(f, 'j-a');
      const g = Math.pow(1 + i, n), fv = i ? P * g + A * (g - 1) / i : P + A * n, inv = P + A * n;
      return `<div class="card-head"><h3>Resultado</h3></div><div class="result">
        ${rowR('Total investido', fmt(inv))}${rowR('Juros ganhos', `<span class="pos">${fmt(fv - inv)}</span>`)}
        ${rowR('Taxa mensal equivalente', fmtNum(i * 100, 3) + '%')}${rowR('Renda mensal no final', fmt(fv * i))}
        <div class="row total"><span>Valor final</span><b>${fmt(fv)}</b></div></div>
        <p class="muted mt" style="font-size:13px">Os juros representam <b>${inv ? fmtNum((fv - inv) / fv * 100, 0) : 0}%</b> do valor final. Quanto mais tempo, maior o efeito dos juros sobre juros.</p>`;
    },
    avista(f) {
      const V = num(f, 'v-av'), n = Math.max(1, parseInt($('#v-n', f).value) || 1), P = num(f, 'v-p'), r = num(f, 'v-r') / 100;
      const pv = r ? P * (1 - Math.pow(1 + r, -n)) / r : P * n, total = P * n;
      // taxa de juros embutida no parcelamento (bisseção)
      let lo = 0, hi = 1, rate = 0;
      if (total > V) { for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2, v = P * (1 - Math.pow(1 + m, -n)) / m; v > V ? lo = m : hi = m; } rate = (lo + hi) / 2; }
      const best = pv < V ? 'parcelado' : 'avista', diff = Math.abs(V - pv);
      return `<div class="card-head"><h3>Resultado</h3></div>
        <div class="alert ${best === 'avista' ? 'ok' : 'info'}" style="margin-bottom:12px">${icon('check-circle')}<span><b>${best === 'avista' ? 'Pague à vista' : 'Parcele e deixe o dinheiro rendendo'}</b> — economia de ${fmt(diff)} em valores de hoje.</span></div>
        <div class="result">
          ${rowR('Total parcelado', fmt(total))}${rowR('Diferença nominal', fmt(total - V))}
          ${rowR('Valor presente das parcelas', fmt(pv))}${rowR('Juros embutidos no parcelamento', total > V ? fmtNum(rate * 100, 2) + '% a.m.' : 'sem juros')}
        </div>
        <p class="muted mt" style="font-size:13px">Compara o preço à vista com o valor das parcelas trazido para hoje, considerando que o dinheiro não gasto ficaria rendendo ${fmtNum(r * 100, 2)}% ao mês.</p>`;
    },
    financ(f) {
      const V = num(f, 'f-v'), i = num(f, 'f-i') / 100, n = Math.max(1, parseInt($('#f-n', f).value) || 1);
      const pmt = i ? V * i / (1 - Math.pow(1 + i, -n)) : V / n;
      const sac1 = V / n + V * i, sacN = V / n * (1 + i), sacT = V + i * V * (n + 1) / 2;
      return `<div class="card-head"><h3>Resultado</h3></div>
        <div class="label" style="margin-bottom:6px">Tabela Price (parcelas fixas)</div>
        <div class="result">${rowR('Parcela', fmt(pmt))}${rowR('Total pago', fmt(pmt * n))}<div class="row total"><span>Juros totais</span><b class="neg">${fmt(pmt * n - V)}</b></div></div>
        <div class="label" style="margin:14px 0 6px">SAC (parcelas decrescentes)</div>
        <div class="result">${rowR('1ª parcela', fmt(sac1))}${rowR('Última parcela', fmt(sacN))}${rowR('Total pago', fmt(sacT))}<div class="row total"><span>Juros totais</span><b class="neg">${fmt(sacT - V)}</b></div></div>
        <p class="muted mt" style="font-size:13px">Taxa anual equivalente: <b>${fmtNum((Math.pow(1 + i, 12) - 1) * 100, 1)}% a.a.</b></p>`;
    },
    dividir(f) {
      const t = num(f, 'd-t'), p = Math.max(1, parseInt($('#d-p', f).value) || 1), g = num(f, 'd-g') / 100, tot = t * (1 + g);
      return `<div class="card-head"><h3>Resultado</h3></div><div class="result">
        ${rowR('Conta', fmt(t))}${rowR(`Serviço (${fmtNum(g * 100, 0)}%)`, fmt(t * g))}${rowR('Total', fmt(tot))}
        <div class="row total"><span>Cada pessoa paga</span><b>${fmt(tot / p)}</b></div></div>`;
    },
    pct(f) {
      const a = num(f, 'p-a'), b = num(f, 'p-b');
      return `<div class="card-head"><h3>Resultados</h3></div><div class="result">
        ${rowR(`${fmtNum(a)}% de ${fmtNum(b)}`, fmtNum(a * b / 100))}
        ${rowR(`${fmtNum(a)} é quantos % de ${fmtNum(b)}`, b ? fmtNum(a / b * 100) + '%' : '—')}
        ${rowR(`Variação de ${fmtNum(a)} para ${fmtNum(b)}`, a ? (b >= a ? '+' : '') + fmtNum((b - a) / a * 100) + '%' : '—')}
        ${rowR(`${fmtNum(b)} com ${fmtNum(a)}% de desconto`, fmtNum(b * (1 - a / 100)))}
        ${rowR(`${fmtNum(b)} com ${fmtNum(a)}% de acréscimo`, fmtNum(b * (1 + a / 100)))}
      </div>`;
    },
    dias(f) {
      const a = $('#w-a', f).value, b = $('#w-b', f).value, m = $('#w-m', f).value, n = Math.max(1, parseInt($('#w-n', f).value) || 1);
      if (!a || !b) return '';
      const [x, y] = a <= b ? [a, b] : [b, a], hol = [];
      for (let s = x; s <= y && hol.length < 30; s = addDays(s, 1)) if (holidayName(s) && parseYMD(s).getDay() % 6) hol.push(s);
      const nth = m ? nthBusinessDay(m, n) : null;
      return `<div class="card-head"><h3>Resultado</h3></div><div class="result">
        ${rowR('Dias corridos', diffDays(x, y) + 1)}${rowR('Dias úteis', businessDaysBetween(x, y))}
        ${rowR('Feriados em dias de semana', hol.length)}</div>
        ${hol.length ? `<div class="mt" style="font-size:13px">${hol.map(h => `<div class="row" style="padding:3px 0"><span class="pill atrasado">${fmtDate(h)}</span>${esc(holidayName(h))}</div>`).join('')}</div>` : ''}
        ${nth ? `<div class="result mt"><div class="row total"><span>${n}º dia útil de ${ymLabel(m)}</span><b>${fmtDate(nth)}</b></div>
          <div class="row"><span class="muted">${cap(WEEK[parseYMD(nth).getDay()])}</span><span class="muted">${diffDays(today(), nth) >= 0 ? `em ${diffDays(today(), nth)} dia(s)` : 'já passou'}</span></div></div>` : ''}`;
    },
    senha(f) {
      const l = +$('#g-l', f).value; $('#g-l-l', f).textContent = l;
      const p = genPassword(l, { upper: $('#g-u', f).checked, lower: $('#g-lo', f).checked, digits: $('#g-d', f).checked, symbols: $('#g-s', f).checked });
      return `<div class="card-head"><h3>Sua senha</h3></div>
        <div class="result"><div class="secret" style="font-size:18px;text-align:center;padding:10px 0">${esc(p) || '—'}</div></div>
        <div class="row mt"><button class="btn primary" style="flex:1" data-copy="${esc(p)}">${icon('copy')} Copiar</button><button class="btn" data-recalc>${icon('refresh')} Gerar outra</button></div>`;
    }
  }
};
