/* ═══════════ INÍCIO (painel) ═══════════ */

function paydayInfo() {
  const n = Settings.get('payday');
  let ym = curYM(), d = nthBusinessDay(ym, n);
  if (!d || d < today()) { ym = ymAdd(ym, 1); d = nthBusinessDay(ym, n); }
  return { date: d, days: diffDays(today(), d), ym, n };
}

function budgetAlerts(ym = curYM()) {
  const spent = Object.fromEntries(byCategory(txOfMonth(ym)));
  return Object.entries(DB.budgets).filter(([, l]) => l > 0).map(([id, limit]) => ({ id, limit, spent: spent[id] || 0, pct: (spent[id] || 0) / limit }))
    .filter(b => b.pct >= .8).sort((a, b) => b.pct - a.pct);
}

Views.home = {
  render(el) {
    const ym = App.ym, now = today(), list = txOfMonth(ym), T = totals(list);
    const prev = totals(txOfMonth(ymAdd(ym, -1)));
    const isCur = ym === curYM();
    const late = DB.tx.filter(t => t.type === 'expense' && txStatus(t) === 'Atrasado');
    const soon = DB.tx.filter(t => t.type === 'expense' && txStatus(t) === 'Pendente' && diffDays(now, t.date) <= 3);
    const upcoming = DB.tx.filter(t => !isPaid(t) && t.date <= addDays(now, 30)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    const pd = paydayInfo();
    const name = Auth.current().nome || '';
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

    // Insights
    const savings = T.inc > 0 ? (T.inc - T.exp) / T.inc * 100 : 0;
    const daysPassed = isCur ? parseYMD(now).getDate() : daysInMonth(+ym.slice(0, 4), +ym.slice(5) - 1);
    const daily = T.expPaid / Math.max(1, daysPassed);
    const fixed = sum(list.filter(t => t.type === 'expense' && (t.isRecurring || t.installmentInfo)), t => t.amount);
    const vsPrev = prev.exp > 0 ? (T.exp - prev.exp) / prev.exp * 100 : null;

    // Alertas
    const alerts = [];
    if (late.length) alerts.push(['danger', 'alert', `${late.length} conta(s) em atraso · ${fmt(sum(late, t => t.amount))}`, 'bills']);
    if (soon.length) alerts.push(['warn', 'clock', `${soon.length} conta(s) vencendo nos próximos 3 dias`, 'bills']);
    budgetAlerts().forEach(b => alerts.push([b.pct >= 1 ? 'danger' : 'warn', 'pie',
      `${cat(b.id).nome}: ${b.pct >= 1 ? 'orçamento estourado' : 'já usou ' + Math.round(b.pct * 100) + '% do orçamento'}`, 'budget']));
    const recs = isCur && DB.loaded.tx ? pendingRecurrences() : [];
    if (recs.length) alerts.push(['info', 'repeat', `${recs.length} conta(s) fixa(s) do mês passado ainda não lançada(s) este mês`, 'recur']);
    const dueNotes =DB.notes.filter(n => noteDue(n) && noteDue(n).slice(0, 10) <= now);
    if (dueNotes.length) alerts.push(['info', 'bell', `${dueNotes.length} lembrete(s) para hoje`, 'notes']);

    const cats = byCategory(list), catTotal = sum(cats, c => c[1]);
    const goals = DB.goals.filter(g => (g.guardado || 0) < g.alvo).slice(0, 3);
    const notes = DB.notes.filter(n => !n.feito && (n.fixado || noteDue(n))).sort((a, b) => (noteDue(a) || '9').localeCompare(noteDue(b) || '9')).slice(0, 4);

    el.innerHTML = `
      <div class="page-head">
        <div style="flex:1;min-width:200px">
          <h1>Visão geral</h1>
          <p>${hello}${name ? ', ' + esc(name) : ''} · ${cap(WEEK[new Date().getDay()])}, ${new Date().getDate()} de ${MONTHS[new Date().getMonth()]} de ${new Date().getFullYear()}</p>
        </div>
        ${monthNav()}
      </div>

      ${alerts.length ? `<div class="alerts" style="margin-bottom:14px">${alerts.map(([c, i, m, go]) =>
        go === 'recur' ? `<div class="alert ${c}">${icon(i)}<span>${esc(m)}</span><button data-h="recur">Revisar</button></div>`
          : `<div class="alert ${c}">${icon(i)}<span>${esc(m)}</span><button data-go="${go}">Ver</button></div>`).join('')}</div>` : ''}

      <div class="home-grid">
        <div class="col">
          <div class="card hero" style="order:1">
            <button class="eye" data-action="toggle-privacy" title="Ocultar valores">${icon(document.body.classList.contains('privacy') ? 'eye-off' : 'eye')}</button>
            <small>Saldo previsto · ${ymLabel(ym)}</small>
            <div class="big">${money(T.bal)}</div>
            <div class="hero-split">
              <div class="hero-pill"><span>${icon('up', 'i-sm')} Receitas</span><b>${money(T.inc)}</b></div>
              <div class="hero-pill"><span>${icon('down', 'i-sm')} Despesas</span><b>${money(T.exp)}</b></div>
            </div>
            <div class="hero-foot">
              <span>Já realizado no mês: <b>${money(T.balPaid)}</b></span>
              <span>Saldo acumulado: <b>${money(accumulatedBalance())}</b></span>
            </div>
          </div>

          <div class="stats" style="order:4">
            <div class="stat"><small>${icon('wallet', 'i-sm')} Poupança</small><b class="${savings >= 20 ? 'pos' : savings < 0 ? 'neg' : 'warn'}">${fmtNum(savings, 1)}%</b><em>${savings >= 20 ? 'Excelente!' : savings > 0 ? 'Meta ideal: 20%' : 'Gastando mais que ganha'}</em></div>
            <div class="stat"><small>${icon('clock', 'i-sm')} Gasto médio/dia</small><b>${money(daily)}</b><em>${isCur ? 'até hoje' : 'no mês'}</em></div>
            <div class="stat"><small>${icon('repeat', 'i-sm')} Gastos fixos</small><b>${money(fixed)}</b><em>recorrentes + parcelas</em></div>
            <div class="stat"><small>${icon(vsPrev > 0 ? 'up' : 'down', 'i-sm')} vs. mês anterior</small><b class="${vsPrev == null ? '' : vsPrev > 0 ? 'neg' : 'pos'}">${vsPrev == null ? '—' : (vsPrev > 0 ? '+' : '') + fmtNum(vsPrev, 0) + '%'}</b><em>nas despesas</em></div>
          </div>

          <div class="card" style="order:6">
            <div class="card-head"><h3>Receitas × Despesas</h3><span class="muted" style="font-size:12px">últimos 6 meses</span></div>
            <div class="chart-wrap"><canvas id="home-bars"></canvas></div>
          </div>

          <div class="card" style="order:7">
            <div class="card-head"><h3>Para onde foi o dinheiro</h3><button class="link" data-go="budget">Orçamentos</button></div>
            ${cats.length ? `
              <div class="grid-2" style="align-items:center">
                <div class="chart-wrap sm"><canvas id="home-donut"></canvas></div>
                <div class="cat-legend">${cats.slice(0, 6).map(([id, v]) => { const c = cat(id); return `
                  <div class="row"><span class="dot" style="background:${c.cor}"></span><span style="flex:1">${esc(c.nome)}</span><b>${money(v)}</b><span class="faint" style="width:38px;text-align:right">${Math.round(v / catTotal * 100)}%</span></div>`; }).join('')}
                </div>
              </div>` : empty('pie', 'Sem despesas neste mês')}
          </div>
        </div>

        <div class="col">
          <div class="card payday" style="order:2">
            <div class="payday-num"><div><b>${parseYMD(pd.date).getDate()}</b><small>${MONTHS_S[parseYMD(pd.date).getMonth()]}</small></div></div>
            <div style="flex:1">
              <div class="label" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;font-weight:600">Próximo pagamento</div><div style="font-weight:600">${pd.n}º dia útil de ${MONTHS[+pd.ym.slice(5) - 1]}</div>
              <div class="muted" style="font-size:13.5px">${cap(WEEK[parseYMD(pd.date).getDay()])}, ${fmtDate(pd.date)}</div>
            </div>
            <div style="text-align:right">${pd.days === 0 ? '<b class="pos">Hoje</b>' : `<b class="num" style="font-size:20px;font-weight:600">${pd.days}</b><div class="muted" style="font-size:12px">dia${pd.days > 1 ? 's' : ''}</div>`}</div>
          </div>

          <div class="card flush" style="order:3">
            <div class="card-head"><h3>Próximos vencimentos</h3><button class="link" data-go="bills">Agenda</button></div>
            ${upcoming.length ? `<div class="list">${upcoming.map(t => txItemHTML(t, { showDate: true })).join('')}</div>`
              : empty('check-circle', 'Tudo em dia', 'Nenhuma conta pendente nos próximos 30 dias')}
          </div>

          <div class="card flush" style="order:5">
            <div class="card-head"><h3>Lembretes</h3><button class="link" data-go="notes">Ver todos</button></div>
            ${notes.length ? `<div class="list">${notes.map(n => `
              <div class="item" data-note="${n._key}">
                <div class="avatar" style="color:${n.cor || 'var(--muted)'}">${icon(n.fixado ? 'pin' : 'bell')}</div>
                <div class="item-body"><div class="item-title">${esc(n.titulo || 'Sem título')}</div>
                <div class="item-sub">${noteDue(n) ? `<span class="${noteDue(n) < new Date().toISOString().slice(0, 16) ? 'neg' : ''}">${relDay(noteDue(n).slice(0, 10))} ${noteDue(n).slice(11, 16)}</span>` : esc((n.texto || '').slice(0, 50))}</div></div>
              </div>`).join('')}</div>` : `<div style="padding:4px 16px 16px" class="muted">Nada pendente. <button class="link" data-go="notes" style="color:var(--primary);font-weight:500">Criar lembrete</button></div>`}
          </div>

          <div class="card" style="order:8">
            <div class="card-head"><h3>Metas</h3><button class="link" data-go="goals">Ver todas</button></div>
            ${goals.length ? `<div class="stack">${goals.map(g => { const p = clamp((g.guardado || 0) / g.alvo, 0, 1); return `
              <div><div class="prog-row"><span>${esc(g.nome)}</span><b>${Math.round(p * 100)}%</b></div>
              <div class="progress"><i style="width:${p * 100}%;background:${g.cor || 'var(--primary-2)'}"></i></div>
              <div class="faint" style="font-size:12px;margin-top:4px">${money(g.guardado || 0)} de ${money(g.alvo)}</div></div>`; }).join('')}</div>`
              : `<div class="muted" style="font-size:14px">Nenhuma meta cadastrada. <button data-go="goals" style="color:var(--primary);font-weight:500">Criar meta</button></div>`}
          </div>
        </div>
      </div>`;

    this.charts(el, ym, cats);
    el.querySelector('[data-h="recur"]')?.addEventListener('click', () => this.reviewRecurrences());
  },

  /** O usuário escolhe quais contas fixas lançar no mês atual */
  reviewRecurrences() {
    const list = pendingRecurrences();
    Sheet.open({
      title: 'Contas fixas do mês',
      body: `<p class="muted" style="font-size:13.5px;margin-bottom:10px">Estas contas estavam marcadas como “repete todo mês” em ${ymLabel(ymAdd(curYM(), -1))}. Marque as que deseja lançar em ${ymLabel(curYM())}:</p>
        <div class="list">${list.map((t, i) => { const c = cat(t.category); return `
          <label class="item" style="cursor:pointer">
            <input type="checkbox" data-i="${i}" checked style="width:18px;height:18px;accent-color:var(--primary-2)">
            ${catAvatar(c)}
            <div class="item-body"><div class="item-title">${esc(t.description)}</div><div class="item-sub">vence ${fmtDate(addMonths(t.date, 1))}</div></div>
            <span class="item-amount ${t.type === 'income' ? 'pos' : ''}">${money(t.amount)}</span>
          </label>`; }).join('')}</div>
        <p class="faint" style="font-size:12px;margin-top:10px">Para parar de repetir uma conta, abra-a e desligue “Repete todo mês”.</p>`,
      foot: `<button class="btn primary" data-ok>Lançar selecionadas</button>`,
      onMount: el => el.querySelector('[data-ok]').onclick = async () => {
        const sel = $$('input[data-i]', el).filter(x => x.checked).map(x => list[+x.dataset.i]);
        await applyRecurrences(sel); Sheet.close();
      }
    });
  },

  charts(el, ym, cats) {
    const months = Array.from({ length: 6 }, (_, i) => ymAdd(ym, i - 5));
    const data = months.map(m => totals(txOfMonth(m)));
    Charts.make('home-bars', $('#home-bars', el), c => ({
      type: 'bar',
      data: {
        labels: months.map(m => cap(MONTHS_S[+m.slice(5) - 1])),
        datasets: [
          { label: 'Receitas', data: data.map(d => d.inc), backgroundColor: c.success, borderRadius: 6, maxBarThickness: 26 },
          { label: 'Despesas', data: data.map(d => d.exp), backgroundColor: c.danger, borderRadius: 6, maxBarThickness: 26 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${fmt(x.parsed.y)}` } } },
        scales: { y: { beginAtZero: true, grid: { color: c.grid }, border: { display: false }, ticks: { callback: Charts.moneyTick } }, x: { grid: { display: false } } }
      }
    }));
    if (cats.length) Charts.make('home-donut', $('#home-donut', el), c => ({
      type: 'doughnut',
      data: { labels: cats.map(([id]) => cat(id).nome), datasets: [{ data: cats.map(x => x[1]), backgroundColor: cats.map(([id]) => cat(id).cor), borderColor: c.surface, borderWidth: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.label}: ${fmt(x.parsed)}` } } } }
    }));
  }
};
