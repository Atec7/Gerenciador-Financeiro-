/* ═══════════ ORÇAMENTOS POR CATEGORIA ═══════════ */

Views.budget = {
  avg3(id) {
    const months = [1, 2, 3].map(i => ymAdd(curYM(), -i));
    return sum(months, m => sum(txOfMonth(m).filter(t => t.type === 'expense' && t.category === id), t => t.amount)) / 3;
  },

  render(el) {
    const ym = App.ym, list = txOfMonth(ym), spent = Object.fromEntries(byCategory(list));
    const inc = totals(list).inc;
    const cats = catList('expense').filter(c => c.tipo !== 'income');
    const rows = cats.map(c => ({ c, limit: Number(DB.budgets[c.id]) || 0, spent: spent[c.id] || 0 }))
      .filter(r => r.limit || r.spent)
      .sort((a, b) => (b.limit ? 1 : 0) - (a.limit ? 1 : 0) || (b.spent / (b.limit || 1)) - (a.spent / (a.limit || 1)));
    const unused = cats.filter(c => !DB.budgets[c.id] && !spent[c.id]);
    const totLimit = sum(rows, r => r.limit), totSpent = sum(rows.filter(r => r.limit), r => r.spent);
    const pctTot = totLimit ? totSpent / totLimit : 0;
    const isCur = ym === curYM();
    const dLeft = isCur ? daysInMonth(+ym.slice(0, 4), +ym.slice(5) - 1) - parseYMD(today()).getDate() + 1 : 0;

    el.innerHTML = `
      <div class="toolbar">${monthNav()}<span class="spacer"></span>
        <button class="btn" data-b="suggest" title="Preenche limites com a média dos últimos 3 meses">${icon('dice')} Sugerir limites</button>
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h3>Orçamento total do mês</h3></div>
            ${totLimit ? `
              <div class="prog-row"><span>${money(totSpent)} gastos</span><b>${money(totLimit)}</b></div>
              <div class="progress lg"><i style="width:${Math.min(100, pctTot * 100)}%;background:${pctTot > 1 ? 'var(--danger)' : pctTot > .8 ? 'var(--warning)' : 'var(--success)'}"></i></div>
              <p class="muted mt" style="font-size:13.5px">${totLimit - totSpent >= 0
                ? `Restam <b class="pos">${money(totLimit - totSpent)}</b>${isCur && dLeft > 0 ? ` · cerca de <b>${money((totLimit - totSpent) / dLeft)}</b> por dia até o fim do mês` : ''}`
                : `Você passou <b class="neg">${money(totSpent - totLimit)}</b> do planejado.`}</p>`
              : `<p class="muted">Defina um limite de gasto para cada categoria e o Fin avisa quando estiver chegando perto. Toque em uma categoria abaixo ou use <b>Sugerir limites</b>.</p>`}
          </div>
          <div class="card flush">
            <div class="card-head"><h3>Categorias</h3><span class="muted" style="font-size:12px">toque para definir o limite</span></div>
            <div class="list" id="bd-list">
              ${rows.map(({ c, limit, spent: s }) => {
                const p = limit ? s / limit : 0, color = !limit ? 'var(--faint)' : p > 1 ? 'var(--danger)' : p > .8 ? 'var(--warning)' : 'var(--success)';
                return `<div class="item" data-bcat="${esc(c.id)}" style="flex-wrap:wrap">
                  ${catAvatar(c)}
                  <div class="item-body">
                    <div class="prog-row" style="margin:0 0 6px"><b style="font-size:14.5px">${esc(c.nome)}</b><span class="num">${money(s)}${limit ? ` <span class="faint">/ ${money(limit)}</span>` : ''}</span></div>
                    <div class="progress"><i style="width:${limit ? Math.min(100, p * 100) : 0}%;background:${color}"></i></div>
                    <div style="font-size:12px;margin-top:4px;color:${color}">${!limit ? 'Sem limite definido' : p > 1 ? `Estourou ${fmt(s - limit)}` : `Restam ${fmt(limit - s)} · ${Math.round(p * 100)}%`}</div>
                  </div>
                </div>`;
              }).join('') || '<div class="muted" style="padding:6px 14px 16px">Sem gastos neste mês.</div>'}
              ${unused.length ? `<details style="padding:4px 12px 12px"><summary class="muted" style="cursor:pointer;font-size:13px;padding:8px 0">Outras categorias (${unused.length})</summary>
                <div class="chips" style="flex-wrap:wrap">${unused.map(c => `<button class="chip" data-bcat="${esc(c.id)}">${esc(c.nome)}</button>`).join('')}</div></details>` : ''}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Regra 50 / 30 / 20</h3></div>
          ${inc > 0 ? `
            <p class="muted" style="font-size:13.5px;margin-bottom:14px">Uma forma simples de dividir a renda de ${money(inc)} deste mês:</p>
            <div class="stack">
              ${[['', 'Necessidades', .5, 'moradia, contas, mercado, transporte, saúde', ['moradia', 'contas', 'alimentacao', 'transporte', 'saude', 'farmacia', 'educacao', 'emprestimo']],
                 ['', 'Desejos', .3, 'lazer, compras, assinaturas, restaurantes', ['lazer', 'compras', 'assinaturas', 'outros']],
                 ['', 'Poupança e investimentos', .2, 'reserva de emergência, metas, investimentos', ['investimentos']]].map(([e, n, p, d, ids]) => {
                  const real = ids.reduce((a, id) => a + (spent[id] || 0), 0), ideal = inc * p, r = real / ideal;
                  return `<div><div class="prog-row"><span><b style="font-weight:600">${n}</b> <span class="faint">${p * 100}%</span></span><span class="num">${money(real)} <span class="faint">/ ${money(ideal)}</span></span></div>
                    <div class="progress"><i style="width:${Math.min(100, r * 100)}%;background:${p === .2 ? (r >= 1 ? 'var(--success)' : 'var(--primary-2)') : (r > 1 ? 'var(--danger)' : 'var(--success)')}"></i></div>
                    <div class="faint" style="font-size:12px;margin-top:3px">${d}</div></div>`;
                }).join('')}
            </div>` : `<p class="muted">Registre suas receitas do mês para ver a divisão sugerida.</p>`}
        </div>
      </div>`;

    el.querySelectorAll('[data-bcat]').forEach(b => b.onclick = () => this.edit(b.dataset.bcat));
    $('[data-b="suggest"]', el).onclick = async () => {
      const upd = {};
      catList('expense').forEach(c => { if (!DB.budgets[c.id]) { const a = this.avg3(c.id); if (a > 0) upd[c.id] = Math.ceil(a / 10) * 10; } });
      if (!Object.keys(upd).length) return toast('Sem histórico suficiente para sugerir (ou todos já têm limite)', 'info');
      if (!(await confirmDialog(`Definir limites para ${Object.keys(upd).length} categoria(s) com base na média dos últimos 3 meses?`, { title: 'Sugerir limites', ok: 'Aplicar' }))) return;
      await Store.update('config/budgets', upd); toast('Limites sugeridos aplicados');
    };
  },

  edit(id) {
    const c = cat(id), cur = Number(DB.budgets[id]) || 0, avg = this.avg3(id);
    Sheet.open({
      title: `${esc(c.nome)}`,
      body: `
        <div class="amount-input"><span>R$</span><input id="bd-v" inputmode="decimal" placeholder="0,00" value="${cur ? fmtNum(cur) : ''}" autofocus></div>
        <p class="muted" style="text-align:center;font-size:13.5px">Limite mensal de gastos nesta categoria.<br>Média dos últimos 3 meses: <b>${money(avg)}</b>
        ${avg > 0 ? `<button class="chip" style="margin-left:6px" data-avg="${Math.ceil(avg / 10) * 10}">usar</button>` : ''}</p>`,
      foot: `${cur ? `<button class="btn soft-danger" data-bd="del">Remover limite</button>` : ''}<button class="btn primary" data-bd="save">Salvar</button>`,
      onMount: el => {
        const inp = $('#bd-v', el);
        el.querySelector('[data-avg]')?.addEventListener('click', e => { inp.value = fmtNum(e.target.dataset.avg); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.querySelector('[data-bd="save"]').click(); });
        el.querySelector('.sheet-foot').onclick = async e => {
          const a = e.target.closest('[data-bd]')?.dataset.bd; if (!a) return;
          if (a === 'del') { await Store.remove(`config/budgets/${id}`); Sheet.close(); return toast('Limite removido', 'info'); }
          const v = parseMoney(inp.value);
          if (!(v > 0)) return toast('Informe um valor', 'err');
          await Store.set(`config/budgets/${id}`, Math.round(v * 100) / 100); Sheet.close(); toast('Orçamento salvo');
        };
      }
    });
  }
};
