/* ═══════════ INVESTIMENTOS ═══════════
   Cada investimento guarda seus movimentos (aportes +, resgates −).
   Lançamentos do extrato na categoria "Investimentos" entram aqui automaticamente;
   também é possível cadastrar e movimentar direto nesta tela. */

const pctFmt = v => (v >= 0 ? '+' : '') + fmtNum(v * 100, 2) + '%';

Views.invest = {
  render(el) {
    const list = DB.invest.map(i => ({ ...i, st: Invest.stats(i) })).sort((a, b) => b.st.saldo - a.st.saldo);
    const aplicado = sum(list, i => i.st.aplicado), saldo = sum(list, i => i.st.saldo), rend = saldo - aplicado;
    const ym = curYM(), mesMov = sum(list.flatMap(i => i.st.movs).filter(m => (m.data || '').startsWith(ym)), m => m.valor);
    const unlinked = DB.tx.filter(t => t.category === 'investimentos' && !t.investId);
    const byType = {};
    list.forEach(i => { const k = i.tipo || 'Outro'; byType[k] = (byType[k] || 0) + Math.max(0, i.st.saldo); });
    const types = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const totT = sum(types, x => x[1]);

    el.innerHTML = `
      <div class="page-head">
        <div style="flex:1;min-width:200px"><h1>Investimentos</h1><p>Carteira consolidada · aportes do extrato entram automaticamente</p></div>
        ${unlinked.length ? `<button class="btn" data-iv="import">${icon('download')} Importar do extrato (${unlinked.length})</button>` : ''}
        <button class="btn primary" data-iv="new">${icon('plus')} Novo investimento</button>
      </div>
      <div class="stats" style="margin-bottom:12px">
        <div class="stat"><small>Total aplicado</small><b>${money(aplicado)}</b><em>aportes − resgates</em></div>
        <div class="stat"><small>Saldo atual</small><b>${money(saldo)}</b><em>${list.length} investimento(s)</em></div>
        <div class="stat"><small>Rendimento</small><b class="${rend >= 0 ? 'pos' : 'neg'}">${money(rend)}</b><em>${aplicado > 0 ? pctFmt(rend / aplicado) : '—'} sobre o aplicado</em></div>
        <div class="stat"><small>Movimentação no mês</small><b class="${mesMov >= 0 ? '' : 'neg'}">${money(mesMov)}</b><em>${ymLabel(ym)}</em></div>
      </div>
      ${list.length ? `
      <div class="grid-2" style="align-items:start;grid-template-columns:${matchMedia('(min-width:1100px)').matches ? '1.5fr 1fr' : ''}">
        <div class="card flush">
          <div class="card-head"><h3>Carteira</h3><span class="muted" style="font-size:12px">toque para detalhes</span></div>
          <div class="list">${list.map(i => `
            <div class="item" data-inv="${i._key}">
              <div class="avatar" style="color:${colorFor(i.tipo || 'Outro')}">${icon('up')}</div>
              <div class="item-body">
                <div class="item-title">${esc(i.nome)}</div>
                <div class="item-sub">${esc(i.tipo || 'Outro')}${i.instituicao ? ' · ' + esc(i.instituicao) : ''}${i.taxa ? ' · ' + esc(i.taxa) : ''}</div>
              </div>
              <div class="item-end">
                <span class="item-amount">${money(i.st.saldo)}</span>
                <span style="font-size:12px" class="${i.st.rend >= 0 ? 'pos' : 'neg'}">${i.st.aplicado > 0 ? pctFmt(i.st.pct) : '—'}</span>
              </div>
            </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Distribuição por tipo</h3></div>
          ${types.length ? `<div class="chart-wrap sm"><canvas id="inv-donut"></canvas></div>
            <div class="cat-legend mt">${types.map(([k, v]) => `<div class="row"><span class="dot" style="background:${colorFor(k)}"></span><span style="flex:1">${esc(k)}</span><b class="num">${money(v)}</b><span class="faint" style="width:44px;text-align:right">${Math.round(v / totT * 100)}%</span></div>`).join('')}</div>`
            : '<p class="muted">Sem saldo para exibir.</p>'}
        </div>
      </div>` : `<div class="card">${empty('up', 'Nenhum investimento cadastrado',
          'Cadastre aqui ou lance uma transação na categoria Investimentos — ela aparece nesta aba automaticamente.',
          `<button class="btn primary" data-iv="new">${icon('plus')} Novo investimento</button>`)}</div>`}`;

    if (types.length) Charts.make('inv-donut', $('#inv-donut', el), c => ({
      type: 'doughnut',
      data: { labels: types.map(x => x[0]), datasets: [{ data: types.map(x => x[1]), backgroundColor: types.map(x => colorFor(x[0])), borderColor: c.surface, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.label}: ${fmt(x.parsed)}` } } } }
    }));

    el.onclick = e => {
      const b = e.target.closest('[data-iv]');
      if (b?.dataset.iv === 'new') return this.form();
      if (b?.dataset.iv === 'import') return this.importFromTx();
      const it = e.target.closest('[data-inv]');
      if (it) this.detail(it.dataset.inv);
    };
  },

  detail(key) {
    const inv = DB.invest.find(i => i._key === key); if (!inv) return;
    const st = Invest.stats(inv);
    Sheet.open({
      title: esc(inv.nome),
      body: `
        <p class="muted" style="font-size:13px;margin-bottom:12px">${esc(inv.tipo || 'Outro')}${inv.instituicao ? ' · ' + esc(inv.instituicao) : ''}${inv.taxa ? ' · ' + esc(inv.taxa) : ''}${inv.criado ? ' · desde ' + fmtDate(inv.criado) : ''}</p>
        <div class="result">
          <div class="row"><span class="muted">Total aplicado</span><b class="num">${money(st.aplicado)}</b></div>
          <div class="row"><span class="muted">Rendimento</span><b class="num ${st.rend >= 0 ? 'pos' : 'neg'}">${money(st.rend)} ${st.aplicado > 0 ? `(${pctFmt(st.pct)})` : ''}</b></div>
          <div class="row total"><span>Saldo atual</span><b class="num">${money(st.saldo)}</b></div>
          ${inv.saldoEm ? `<div class="faint" style="font-size:12px">Saldo informado em ${fmtDate(inv.saldoEm.slice(0, 10))}</div>` : ''}
        </div>
        <div class="row wrap mt">
          <button class="btn sm primary" data-d="dep">${icon('plus', 'i-sm')} Aporte</button>
          <button class="btn sm" data-d="wd">${icon('minus', 'i-sm')} Resgate</button>
          <button class="btn sm" data-d="bal">${icon('refresh', 'i-sm')} Atualizar saldo</button>
          <span class="spacer"></span>
          <button class="icon-btn sm" data-d="edit" title="Editar">${icon('edit', 'i-sm')}</button>
          <button class="icon-btn sm" data-d="del" title="Excluir">${icon('trash', 'i-sm')}</button>
        </div>
        <div class="section-title" style="margin-top:20px">Movimentações</div>
        <div class="card flush">${st.movs.length ? `<div class="list">${st.movs.map(m => `
          <div class="item" style="cursor:default">
            <div class="item-body"><div class="item-title">${m.valor >= 0 ? 'Aporte' : 'Resgate'}</div>
              <div class="item-sub">${fmtDate(m.data)} · ${m.origem === 'extrato' ? 'pelo extrato' : 'manual'}${m.obs ? ' · ' + esc(m.obs) : ''}</div></div>
            <span class="item-amount ${m.valor >= 0 ? '' : 'neg'}">${m.valor >= 0 ? '+' : '−'} ${money(Math.abs(m.valor))}</span>
            ${m.origem === 'extrato' ? `<span class="icon-btn sm" title="Para alterar, edite o lançamento no extrato">${icon('list', 'i-sm')}</span>`
              : `<button class="icon-btn sm" data-mdel="${m._key}" title="Excluir movimentação">${icon('x', 'i-sm')}</button>`}
          </div>`).join('')}</div>` : '<p class="muted" style="padding:14px 16px">Nenhuma movimentação.</p>'}</div>`,
      onMount: el => el.querySelector('.sheet-body').onclick = async e => {
        const md = e.target.closest('[data-mdel]')?.dataset.mdel;
        if (md) {
          if (!(await confirmDialog('Excluir esta movimentação?', { ok: 'Excluir', danger: true }))) return;
          await Store.remove(`Investimentos/${key}/movs/${md}`); toast('Movimentação excluída', 'info'); return this.detail(key);
        }
        const d = e.target.closest('[data-d]')?.dataset.d; if (!d) return;
        if (d === 'dep') this.move(inv, 1);
        if (d === 'wd') this.move(inv, -1);
        if (d === 'bal') this.balance(inv);
        if (d === 'edit') this.form(inv);
        if (d === 'del') {
          const linked = DB.tx.filter(t => t.investId === key).length;
          if (!(await confirmDialog(`Excluir "${inv.nome}" e seu histórico?${linked ? ` Os ${linked} lançamento(s) do extrato continuam lá, apenas sem vínculo.` : ''}`, { title: 'Excluir investimento', ok: 'Excluir', danger: true }))) return;
          await Invest.remove(inv); Sheet.close(); toast('Investimento excluído', 'info');
        }
      }
    });
  },

  form(inv = null) {
    Sheet.open({
      title: inv ? 'Editar investimento' : 'Novo investimento',
      body: `
        <div class="field"><label for="if-n">Nome</label><input id="if-n" value="${esc(inv?.nome || '')}" placeholder="Ex.: CDB Banco X, Tesouro Selic 2029" autofocus></div>
        <div class="fields-2">
          <div class="field"><label for="if-t">Tipo</label><select id="if-t">${INVEST_TYPES.map(t => `<option ${(inv?.tipo || 'CDB / LCI / LCA') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label for="if-i">Instituição</label><input id="if-i" value="${esc(inv?.instituicao || '')}" placeholder="Banco / corretora"></div>
        </div>
        <div class="field"><label for="if-x">Rentabilidade contratada (opcional)</label><input id="if-x" value="${esc(inv?.taxa || '')}" placeholder="Ex.: 110% do CDI, IPCA + 6%"></div>
        ${inv ? '' : `
        <div class="fields-2">
          <div class="field"><label for="if-v">Valor inicial (opcional)</label><input id="if-v" inputmode="decimal" placeholder="0,00"></div>
          <div class="field"><label for="if-d">Data</label><input type="date" id="if-d" value="${today()}"></div>
        </div>
        <label class="switch"><input type="checkbox" id="if-tx"><i></i>Lançar o valor inicial no extrato (sai do saldo)</label>`}
        <div class="field mt"><label for="if-o">Observação</label><textarea id="if-o" rows="2" style="min-height:56px">${esc(inv?.obs || '')}</textarea></div>`,
      foot: `<button class="btn primary" data-if>Salvar</button>`,
      onMount: el => el.querySelector('[data-if]').onclick = async () => {
        const nome = $('#if-n', el).value.trim(); if (!nome) return toast('Informe o nome', 'err');
        const data = { nome, tipo: $('#if-t', el).value, instituicao: $('#if-i', el).value.trim() || null, taxa: $('#if-x', el).value.trim() || null, obs: $('#if-o', el).value.trim() || null };
        if (inv) { await Invest.save(inv._key, data); Sheet.close(); return toast('Investimento atualizado'); }
        const v = parseMoney($('#if-v', el).value), date = $('#if-d', el).value || today(), id = Store.newKey();
        const node = { ...data, criado: date, movs: {} }, upd = {};
        if (v > 0) {
          if ($('#if-tx', el).checked) {
            const k = Store.newKey(), tx = { description: `Aporte ${nome}`, amount: v, type: 'expense', category: 'investimentos', date, status: 'Pago', paidAt: date, investId: id };
            upd[`transactions/${k}`] = tx; node.movs[k] = Invest.mov(tx, k);
          } else node.movs[Store.newKey()] = { data: date, valor: v, origem: 'manual', em: new Date().toISOString() };
        }
        upd[`Investimentos/${id}`] = clean(node);
        await Store.multi(upd); Sheet.close(); toast('Investimento cadastrado');
      }
    });
  },

  move(inv, dir) {
    Sheet.open({
      title: `${dir > 0 ? 'Aporte em' : 'Resgate de'} ${esc(inv.nome)}`,
      body: `
        <div class="amount-input ${dir > 0 ? 'expense' : 'income'}"><span>R$</span><input id="im-v" inputmode="decimal" placeholder="0,00" autofocus></div>
        <div class="field"><label for="im-d">Data</label><input type="date" id="im-d" value="${today()}"></div>
        <div class="field"><label for="im-o">Observação (opcional)</label><input id="im-o"></div>
        <label class="switch"><input type="checkbox" id="im-tx" checked><i></i>Lançar também no extrato (${dir > 0 ? 'despesa' : 'receita'} em Investimentos)</label>`,
      foot: `<button class="btn primary" data-im>Confirmar</button>`,
      onMount: el => {
        const inp = $('#im-v', el);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.querySelector('[data-im]').click(); });
        el.querySelector('[data-im]').onclick = async () => {
          const v = parseMoney(inp.value); if (!(v > 0)) return toast('Informe um valor', 'err');
          const date = $('#im-d', el).value || today(), obs = $('#im-o', el).value.trim() || null, upd = {};
          if ($('#im-tx', el).checked) {
            const k = Store.newKey();
            const tx = clean({ description: `${dir > 0 ? 'Aporte' : 'Resgate'} ${inv.nome}`, amount: v, type: dir > 0 ? 'expense' : 'income', category: 'investimentos', date, status: 'Pago', paidAt: date, investId: inv._key, notes: obs });
            upd[`transactions/${k}`] = tx; upd[`Investimentos/${inv._key}/movs/${k}`] = clean({ ...Invest.mov(tx, k), obs });
          } else upd[`Investimentos/${inv._key}/movs/${Store.newKey()}`] = clean({ data: date, valor: dir * v, origem: 'manual', obs, em: new Date().toISOString() });
          await Store.multi(upd);
          toast(dir > 0 ? 'Aporte registrado' : 'Resgate registrado');
          this.detail(inv._key);
        };
      }
    });
  },

  balance(inv) {
    const st = Invest.stats(inv);
    Sheet.open({
      title: `Atualizar saldo · ${esc(inv.nome)}`,
      body: `
        <p class="muted" style="font-size:13px;margin-bottom:10px">Informe o saldo que aparece hoje no banco/corretora. O rendimento é calculado pela diferença para o total aplicado (${money(st.aplicado)}).</p>
        <div class="amount-input"><span>R$</span><input id="ib-v" inputmode="decimal" value="${fmtNum(st.saldo)}" autofocus></div>
        <div class="result"><div class="row"><span class="muted">Rendimento</span><b id="ib-r" class="num">—</b></div></div>`,
      foot: `<button class="btn primary" data-ib>Salvar saldo</button>`,
      onMount: el => {
        const inp = $('#ib-v', el), upd = () => { const r = (parseMoney(inp.value) || 0) - st.aplicado; $('#ib-r', el).textContent = `${fmt(r)}${st.aplicado > 0 ? ' (' + pctFmt(r / st.aplicado) + ')' : ''}`; $('#ib-r', el).className = `num ${r >= 0 ? 'pos' : 'neg'}`; };
        upd(); inp.addEventListener('input', upd);
        el.querySelector('[data-ib]').onclick = async () => {
          const v = parseMoney(inp.value); if (!(v >= 0)) return toast('Informe o saldo', 'err');
          await Store.update(`Investimentos/${inv._key}`, { saldoAtual: Math.round(v * 100) / 100, saldoEm: new Date().toISOString() });
          toast('Saldo atualizado'); this.detail(inv._key);
        };
      }
    });
  },

  /** Vincula lançamentos antigos da categoria Investimentos, agrupando pela descrição */
  async importFromTx() {
    const list = DB.tx.filter(t => t.category === 'investimentos' && !t.investId);
    const groups = {};
    list.forEach(t => (groups[norm(baseDesc(t.description))] ||= []).push(t));
    const n = Object.keys(groups).length;
    if (!(await confirmDialog(`Vincular ${list.length} lançamento(s) do extrato a ${n} investimento(s)? Lançamentos com a mesma descrição viram um único investimento (você pode renomear depois).`, { title: 'Importar do extrato', ok: 'Importar' }))) return;
    const upd = {};
    Object.values(groups).forEach(txs => {
      const existing = Invest.match(txs[0].description), id = existing?._key || Store.newKey();
      const node = existing ? null : { ...Invest.newNode(txs[0].description), criado: txs.map(t => t.date).sort()[0], movs: {} };
      txs.forEach(t => {
        const m = Invest.mov(t, t._key);
        if (node) node.movs[t._key] = m; else upd[`Investimentos/${id}/movs/${t._key}`] = m;
        upd[`transactions/${t._key}/investId`] = id;
      });
      if (node) upd[`Investimentos/${id}`] = node;
    });
    await Store.multi(upd); toast(`${list.length} lançamento(s) vinculado(s)`);
  }
};
