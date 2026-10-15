/* ═══════════ AGENDA DE CONTAS (calendário) ═══════════ */

Views.bills = {
  sel: null,

  render(el) {
    const ym = App.ym, now = today(), [start, end] = ymRange(ym);
    if (!this.sel || !this.sel.startsWith(ym)) this.sel = now.startsWith(ym) ? now : start;
    const month = txOfMonth(ym), byDay = {};
    month.forEach(t => (byDay[t.date] ||= []).push(t));
    const payday = nthBusinessDay(ym, Settings.get('payday'));

    const exp = month.filter(t => t.type === 'expense'), inc = month.filter(t => t.type === 'income');
    const toPay = sum(exp.filter(t => !isPaid(t)), t => t.amount);
    const paid = sum(exp.filter(isPaid), t => t.amount);
    const toReceive = sum(inc.filter(t => !isPaid(t)), t => t.amount);
    const late = DB.tx.filter(t => txStatus(t) === 'Atrasado').sort((a, b) => a.date.localeCompare(b.date));

    // grade do calendário (começa no domingo)
    const first = parseYMD(start).getDay(), cells = [];
    for (let i = 0; i < first; i++) cells.push(addDays(start, i - first));
    for (let d = start; d <= end; d = addDays(d, 1)) cells.push(d);
    while (cells.length % 7) cells.push(addDays(cells[cells.length - 1], 1));

    const dots = d => {
      const items = byDay[d] || [], s = new Set();
      items.forEach(t => s.add(t.type === 'income' ? 'var(--info)' : ({ Pago: 'var(--success)', Pendente: 'var(--warning)', Atrasado: 'var(--danger)' })[txStatus(t)]));
      if (d === payday) s.add('var(--primary-2)');
      return [...s].slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('');
    };

    const selItems = (byDay[this.sel] || []).sort((a, b) => a.type.localeCompare(b.type));
    const hol = holidayName(this.sel);

    el.innerHTML = `
      <div class="toolbar">${monthNav()}<span class="spacer"></span>
        <button class="btn" data-b="new">${icon('plus')} Conta em ${fmtDateShort(this.sel)}</button>
      </div>
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><small>A pagar no mês</small><b class="warn">${money(toPay)}</b></div>
        <div class="stat"><small>Já pago</small><b class="pos">${money(paid)}</b></div>
        <div class="stat"><small>A receber</small><b style="color:var(--info)">${money(toReceive)}</b></div>
        <div class="stat"><small>Em atraso (total)</small><b class="neg">${money(sum(late, t => t.amount))}</b><em>${late.length} item(s)</em></div>
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="cal" id="cal">
            ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="cal-h">${d}</div>`).join('')}
            ${cells.map(d => `<button class="cal-d ${d.startsWith(ym) ? '' : 'out'} ${d === now ? 'today' : ''} ${d === this.sel ? 'sel' : ''} ${holidayName(d) ? 'holiday' : ''}" data-d="${d}" title="${holidayName(d) || ''}">
              ${+d.slice(8)}<span class="cal-dots">${dots(d)}</span></button>`).join('')}
          </div>
          <div class="row wrap mt" style="font-size:12px;gap:14px" >
            <span class="row" style="gap:5px"><span class="dot" style="background:var(--danger)"></span>Atrasada</span>
            <span class="row" style="gap:5px"><span class="dot" style="background:var(--warning)"></span>Pendente</span>
            <span class="row" style="gap:5px"><span class="dot" style="background:var(--success)"></span>Paga</span>
            <span class="row" style="gap:5px"><span class="dot" style="background:var(--info)"></span>Receita</span>
            <span class="row" style="gap:5px"><span class="dot" style="background:var(--primary-2)"></span>${Settings.get('payday')}º dia útil</span>
          </div>
        </div>
        <div class="stack">
          <div class="card flush">
            <div class="card-head"><h3>${cap(relDay(this.sel))}${relDay(this.sel).includes(' ') ? '' : ' · ' + fmtDate(this.sel)}</h3>
              ${selItems.length ? `<b class="num">${money(sum(selItems, t => (t.type === 'income' ? 1 : -1) * t.amount))}</b>` : ''}</div>
            ${hol ? `<div class="alert danger" style="margin:0 12px 8px">${icon('calendar')} Feriado: ${esc(hol)}</div>` : ''}
            ${this.sel === payday ? `<div class="alert info" style="margin:0 12px 8px">${icon('wallet')} ${Settings.get('payday')}º dia útil do mês</div>` : ''}
            ${selItems.length ? `<div class="list">${selItems.map(t => txItemHTML(t)).join('')}</div>` : `<div class="muted" style="padding:6px 14px 16px">Nada neste dia.</div>`}
          </div>
          ${late.length ? `<div class="card flush">
            <div class="card-head"><h3 class="neg">Em atraso</h3><span class="pill atrasado">${late.length}</span></div>
            <div class="list">${late.slice(0, 15).map(t => txItemHTML(t, { showDate: true })).join('')}</div>
          </div>` : ''}
        </div>
      </div>`;

    $('#cal', el).onclick = e => { const d = e.target.closest('[data-d]')?.dataset.d; if (!d) return; this.sel = d; if (!d.startsWith(ym)) App.setYM(d.slice(0, 7)); else this.render(el); };
    $('[data-b="new"]', el).onclick = () => openTxForm(null, { date: this.sel, type: 'expense' });
  }
};
