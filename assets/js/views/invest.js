/* ═══════════ INVESTIMENTOS ═══════════
   Cada investimento guarda seus movimentos (aportes +, resgates −).
   Lançamentos do extrato na categoria "Investimentos" entram aqui automaticamente;
   também é possível cadastrar e movimentar direto nesta tela. */

const pctFmt = v => (v >= 0 ? '+' : '') + fmtNum(v * 100, 2) + '%';
/** de onde vieram as taxas usadas no cálculo automático */
function ratesNote() {
  const st = Rates.status(), last = Rates.lastDate();
  if (Rates.loading && st === 'estimado') return 'buscando taxas no Banco Central…';
  if (st === 'estimado') return 'taxas aproximadas (sem conexão com o Banco Central)';
  return `CDI/Selic/IPCA do Banco Central até ${fmtDate(last)}`;
}

const hhmm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const chgTag = c => `<span class="${c >= 0 ? 'pos' : 'neg'}" style="font-size:12px">${c >= 0 ? '+' : ''}${fmtNum(c, 2)}%</span>`;
const tickerAvatar = (t, logo) => logo ? `<div class="avatar tk"><img src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()"><span>${esc(t.slice(0, 4))}</span></div>` : `<div class="avatar tk"><span>${esc(t.slice(0, 4))}</span></div>`;

Views.invest = {
  /** Radar, ações acompanhadas e alertas recentes */
  marketSection() {
    const M = Market.load(), radar = M.radar, { own, watch, tickers } = Alerts.watched(), log = Alerts.log().slice(0, 5);
    const perm = window.Notification?.permission;
    const notes = [
      perm !== 'granted' ? `<div class="notice">${icon('bell')}<span>Ative as notificações para receber os alertas com som, mesmo com o app em segundo plano.</span><button class="btn sm primary" data-iv="perm">Ativar</button></div>` : '',
      !Market.token() ? `<div class="notice">${icon('info')}<span>Sem chave da brapi.dev, só dá para ver PETR4, VALE3, MGLU3 e ITUB4. A chave é grátis.</span><button class="btn sm" data-iv="cfg">Configurar</button></div>` : '',
      Market.error ? `<div class="notice err">${icon('alert')}<span>${esc(Market.error)}</span></div>` : ''
    ].join('');
    return `
      <div class="page-head" style="margin-top:22px">
        <div style="flex:1;min-width:200px"><h2 style="font-size:18px">Ações e alertas</h2><p>Cotações da B3 com atraso de até 30 min${M.at ? ` · atualizado às ${hhmm(M.at)}` : ''}</p></div>
        <button class="btn" data-iv="cfg">${icon('bell')} Alertas</button>
        <button class="btn" data-iv="watch">${icon('plus')} Acompanhar ação</button>
      </div>
      ${notes}
      <div class="grid-2" style="align-items:start">
        <div class="card flush">
          <div class="card-head"><h3>⭐ Radar do dia</h3><button class="btn sm" data-iv="radar" ${Market.busy ? 'disabled' : ''}>${icon('refresh', 'i-sm')} Atualizar</button></div>
          ${radar?.items?.length ? `<div class="list">${radar.items.map((x, i) => `
            <div class="item" data-watch="${esc(x.t)}">
              ${tickerAvatar(x.t, x.logo)}
              <div class="item-body"><div class="item-title">${i + 1}. ${esc(x.t)} <span class="faint" style="font-weight:400">${esc(x.name || '')}</span></div>
                <div class="item-sub">P/L ${fmtNum(x.pl, 1)} · ${fmtNum(x.desc * 100, 0)}% abaixo da máxima de 52 sem.</div></div>
              <div class="item-end"><span class="item-amount">${money(x.price)}</span>${chgTag(x.chg)}</div>
            </div>`).join('')}</div>
            <p class="faint radar-note">Entre ${radar.n} grandes empresas da B3: P/L baixo e preço abaixo da máxima de 52 semanas. Critério automático, não é recomendação de investimento. Atualizado em ${fmtDate(radar.day)} às ${hhmm(radar.at)}.</p>`
          : `<p class="muted" style="padding:14px 16px">${Market.busy ? 'Buscando cotações…' : 'O radar aparece todo dia útil a partir das 11h. Toque em Atualizar para ver agora.'}</p>`}
        </div>
        <div>
          <div class="card flush">
            <div class="card-head"><h3>Acompanhando</h3><span class="muted" style="font-size:12px">${tickers.length ? `alerta a partir de ±${fmtNum(Alerts.move(), 0)}%` : ''}</span></div>
            ${tickers.length ? `<div class="list">${tickers.map(t => {
              const q = Market.quote(t), w = watch[t], mine = own[t];
              const sub = [mine ? 'na carteira' : '', w?.compra ? `compra ≤ ${fmt(w.compra)}` : '', w?.venda ? `venda ≥ ${fmt(w.venda)}` : '', !Market.allowed(t) ? 'precisa da chave brapi' : ''].filter(Boolean).join(' · ');
              return `<div class="item" data-watch="${esc(t)}">${tickerAvatar(t, q?.logo)}
                <div class="item-body"><div class="item-title">${esc(t)} <span class="faint" style="font-weight:400">${esc(q?.name || '')}</span></div><div class="item-sub">${sub || 'sem alvo de preço'}</div></div>
                <div class="item-end">${q ? `<span class="item-amount">${money(q.price)}</span>${chgTag(q.chg)}` : '<span class="faint">—</span>'}</div></div>`;
            }).join('')}</div>` : `<p class="muted" style="padding:14px 16px">Nenhuma ação ainda. Toque em <b>Acompanhar ação</b> ou cadastre uma ação na carteira com o código (ex.: PETR4).</p>`}
          </div>
          <div class="card flush mt">
            <div class="card-head"><h3>Alertas recentes</h3>${log.length ? `<button class="btn sm" data-iv="test">${icon('bell', 'i-sm')} Testar</button>` : ''}</div>
            ${log.length ? `<div class="list">${log.map(a => `
              <div class="item" style="cursor:default"><div class="avatar al ${a.kind}">${icon(a.kind === 'down' ? 'down' : a.kind === 'star' ? 'target' : 'up')}</div>
                <div class="item-body"><div class="item-title" style="white-space:normal">${esc(a.title)}</div><div class="item-sub" style="white-space:normal">${esc(a.body)}</div></div>
                <div class="item-end"><span class="faint" style="font-size:12px">${a.at.slice(0, 10) === today() ? hhmm(a.at) : fmtDateShort(a.at.slice(0, 10))}</span></div></div>`).join('')}</div>`
              : `<p class="muted" style="padding:14px 16px">Os alertas aparecem aqui. <button class="link" data-iv="test">Testar agora</button></p>`}
          </div>
        </div>
      </div>`;
  },

  render(el) {
    const list = DB.invest.map(i => ({ ...i, st: Invest.stats(i) })).sort((a, b) => b.st.saldo - a.st.saldo);
    const aplicado = sum(list, i => i.st.aplicado), saldo = sum(list, i => i.st.saldo), rend = saldo - aplicado, irTot = sum(list, i => i.st.ir);
    const ym = curYM(), mesMov = sum(list.flatMap(i => i.st.movs).filter(m => (m.data || '').startsWith(ym)), m => m.valor);
    const unlinked = DB.tx.filter(t => t.category === 'investimentos' && !t.investId);
    const byType = {};
    list.forEach(i => { const k = i.tipo || 'Outro'; byType[k] = (byType[k] || 0) + Math.max(0, i.st.saldo); });
    const types = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const totT = sum(types, x => x[1]);

    el.innerHTML = `
      <div class="page-head">
        <div style="flex:1;min-width:200px"><h1>Investimentos</h1><p>Carteira consolidada · rendimento calculado automaticamente${list.some(i => i.st.auto) ? ` · <span class="faint">${ratesNote()}</span>` : ''}</p></div>
        ${unlinked.length ? `<button class="btn" data-iv="import">${icon('download')} Importar do extrato (${unlinked.length})</button>` : ''}
        <button class="btn primary" data-iv="new">${icon('plus')} Novo investimento</button>
      </div>
      <div class="stats" style="margin-bottom:12px">
        <div class="stat"><small>Total aplicado</small><b>${money(aplicado)}</b><em>aportes − resgates</em></div>
        <div class="stat"><small>Saldo atual</small><b>${money(saldo)}</b><em>${list.length} investimento(s)</em></div>
        <div class="stat"><small>Rendimento</small><b class="${rend >= 0 ? 'pos' : 'neg'}">${money(rend)}</b><em>${aplicado > 0 ? pctFmt(rend / aplicado) : '—'} sobre o aplicado${irTot > 0 ? ` · IR est. ${fmt(irTot)}` : ''}</em></div>
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
                <div class="item-sub">${esc(i.tipo || 'Outro')}${i.instituicao ? ' · ' + esc(i.instituicao) : ''} · ${i.st.auto ? esc(Rentab.label(i.st.rule)) : i.taxa ? esc(i.taxa) : 'saldo manual'}</div>
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
          `<button class="btn primary" data-iv="new">${icon('plus')} Novo investimento</button>`)}</div>`}
      ${this.marketSection()}`;

    if (types.length) Charts.make('inv-donut', $('#inv-donut', el), c => ({
      type: 'doughnut',
      data: { labels: types.map(x => x[0]), datasets: [{ data: types.map(x => x[1]), backgroundColor: types.map(x => colorFor(x[0])), borderColor: c.surface, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.label}: ${fmt(x.parsed)}` } } } }
    }));

    el.onclick = async e => {
      const b = e.target.closest('[data-iv]'), a = b?.dataset.iv;
      if (a === 'new') return this.form();
      if (a === 'import') return this.importFromTx();
      if (a === 'cfg') return this.alertsCfg();
      if (a === 'watch') return this.watchForm();
      if (a === 'test') return Alerts.test();
      if (a === 'perm') { await App.enableNotifications(); return this.render(el); }
      if (a === 'radar') {
        Market.busy = true; this.render(el);
        try { await Market.radar(); const { tickers } = Alerts.watched(); if (tickers.length) await Market.refresh(tickers); } catch (err) { Market.error = err.message; }
        Market.busy = false; return this.render(el);
      }
      const w = e.target.closest('[data-watch]');
      if (w) return this.watchForm(w.dataset.watch);
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
          <div class="row"><span class="muted">Rentabilidade</span><b>${st.auto ? `${esc(Rentab.label(st.rule))}${st.anual != null ? ` <span class="faint">≈ ${fmtNum(st.anual * 100, 2)}% a.a. hoje</span>` : ''}` : 'Não calculada automaticamente'}</b></div>
          <div class="row"><span class="muted">Total aplicado</span><b class="num">${money(st.aplicado)}</b></div>
          <div class="row"><span class="muted">Rendimento bruto</span><b class="num ${st.rend >= 0 ? 'pos' : 'neg'}">${money(st.rend)} ${st.aplicado > 0 ? `(${pctFmt(st.pct)})` : ''}</b></div>
          ${st.ir > 0 ? `<div class="row"><span class="muted">IR estimado no resgate</span><b class="num neg">− ${money(st.ir)}</b></div>` : ''}
          <div class="row total"><span>Saldo atual${st.auto ? ' (bruto)' : ''}</span><b class="num">${money(st.saldo)}</b></div>
          ${st.ir > 0 ? `<div class="row"><span class="muted">Líquido estimado</span><b class="num">${money(st.liquido)}</b></div>` : ''}
          ${st.rule?.kind === 'mercado' ? `<div class="row"><span class="muted">Hoje</span><b class="num ${st.rule.pos.dia >= 0 ? 'pos' : 'neg'}">${st.rule.pos.dia >= 0 ? '+' : '−'} ${money(Math.abs(st.rule.pos.dia))} (${chgTag(st.rule.pos.chg)})</b></div>` : ''}
          <div class="faint" style="font-size:12px">${st.rule?.kind === 'mercado' ? `Saldo pela cotação da B3 (${fmtNum(st.rule.pos.qtd, st.rule.pos.qtd % 1 ? 2 : 0)} cotas × ${fmt(st.rule.pos.price)}), atraso de até 30 min.` : st.auto
            ? `Calculado automaticamente${inv.saldoEm ? ` a partir do saldo informado em ${fmtDate(inv.saldoEm.slice(0, 10))}` : ' desde cada aporte'} · ${ratesNote()}`
            : `${inv.saldoEm ? `Saldo informado em ${fmtDate(inv.saldoEm.slice(0, 10))}. ` : ''}${MARKET_TYPES.includes(inv.tipo) ? 'Para o saldo seguir a cotação da B3, edite e informe o código (ex.: PETR4) e a quantidade de cotas.' : 'Para calcular sozinho, edite e preencha a rentabilidade (ex.: 110% do CDI, IPCA + 6%, 12% a.a.).'}`}</div>
        </div>
        <div class="row wrap mt">
          <button class="btn sm primary" data-d="dep">${icon('plus', 'i-sm')} Aporte</button>
          <button class="btn sm" data-d="wd">${icon('minus', 'i-sm')} Resgate</button>
          ${st.rule?.kind === 'mercado' ? '' : `<button class="btn sm" data-d="bal">${icon('refresh', 'i-sm')} ${st.auto ? 'Corrigir saldo' : 'Atualizar saldo'}</button>`}
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
        <div class="fields-2 ${MARKET_TYPES.includes(inv?.tipo) ? '' : 'hidden'}" id="if-mk">
          <div class="field"><label for="if-tk">Código na bolsa</label><input id="if-tk" value="${esc(inv?.ticker || '')}" placeholder="Ex.: PETR4, MXRF11" autocapitalize="characters" style="text-transform:uppercase"></div>
          <div class="field"><label for="if-q">Quantidade de cotas</label><input id="if-q" inputmode="decimal" value="${inv?.qtd ? fmtNum(inv.qtd, inv.qtd % 1 ? 2 : 0) : ''}" placeholder="Ex.: 100"></div>
        </div>
        <div class="field" id="if-xw"><label for="if-x">Rentabilidade contratada</label><input id="if-x" value="${esc(inv?.taxa || '')}" placeholder="Ex.: 110% do CDI, IPCA + 6%, CDI + 1,5%, 12% a.a.">
          <span class="hint" id="if-xh"></span></div>
        ${inv ? '' : `
        <div class="fields-2">
          <div class="field"><label for="if-v">Valor inicial (opcional)</label><input id="if-v" inputmode="decimal" placeholder="0,00"></div>
          <div class="field"><label for="if-d">Data</label><input type="date" id="if-d" value="${today()}"></div>
        </div>
        <label class="switch"><input type="checkbox" id="if-tx"><i></i>Lançar o valor inicial no extrato (sai do saldo)</label>`}
        <div class="field mt"><label for="if-o">Observação</label><textarea id="if-o" rows="2" style="min-height:56px">${esc(inv?.obs || '')}</textarea></div>`,
      foot: `<button class="btn primary" data-if>Salvar</button>`,
      onMount: el => {
        // mostra como a rentabilidade digitada será entendida
        const hint = () => {
          const mk = MARKET_TYPES.includes($('#if-t', el).value);
          $('#if-mk', el).classList.toggle('hidden', !mk);
          $('#if-xw', el).classList.toggle('hidden', mk && !!$('#if-tk', el).value.trim());
          const r = Rentab.rule({ nome: $('#if-n', el).value, tipo: $('#if-t', el).value, taxa: $('#if-x', el).value });
          const a = Rentab.annualNow(r);
          $('#if-xh', el).textContent = r ? `Cálculo automático: ${Rentab.label(r)}${a != null ? ` (≈ ${fmtNum(a * 100, 2)}% a.a. hoje)` : ''}`
            : 'Sem cálculo automático: o rendimento vem do saldo que você informar (renda variável, fundos…)';
        };
        ['#if-n', '#if-t', '#if-x', '#if-tk'].forEach(q => $(q, el).addEventListener('input', hint)); $('#if-t', el).addEventListener('change', hint); hint();
        el.querySelector('[data-if]').onclick = async () => {
        const nome = $('#if-n', el).value.trim(); if (!nome) return toast('Informe o nome', 'err');
        const tipo = $('#if-t', el).value, mk = MARKET_TYPES.includes(tipo);
        const ticker = mk ? $('#if-tk', el).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null, qtd = mk ? parseMoney($('#if-q', el).value) || null : null;
        if (ticker && !/^[A-Z]{4}\d{1,2}F?$/.test(ticker)) return toast('Código inválido (ex.: PETR4, MXRF11)', 'err');
        const data = { nome, tipo, instituicao: $('#if-i', el).value.trim() || null, taxa: $('#if-x', el).value.trim() || null, obs: $('#if-o', el).value.trim() || null, ticker, qtd };
        if (ticker) setTimeout(() => Market.refresh([ticker]).then(() => Bus.emit('data', 'market')).catch(() => {}), 300);
        if (inv) { await Store.update(`Investimentos/${inv._key}`, data); Sheet.close(); return toast('Investimento atualizado'); }
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
        };
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
        <p class="muted" style="font-size:13px;margin-bottom:10px">${st.auto
          ? `O saldo já é calculado automaticamente (${esc(Rentab.label(st.rule))}). Se o banco mostrar um valor diferente, informe aqui: ele passa a ser o ponto de partida e o cálculo continua a partir de hoje.`
          : 'Informe o saldo que aparece hoje no banco/corretora.'} Total aplicado: ${money(st.aplicado)}.</p>
        <div class="amount-input"><span>R$</span><input id="ib-v" inputmode="decimal" value="${fmtNum(st.saldo)}" autofocus></div>
        <div class="result"><div class="row"><span class="muted">Rendimento</span><b id="ib-r" class="num">—</b></div></div>`,
      foot: `${st.auto && inv.saldoAtual != null ? '<button class="btn" data-ibr>Voltar ao cálculo automático</button>' : ''}<button class="btn primary" data-ib>Salvar saldo</button>`,
      onMount: el => {
        const inp = $('#ib-v', el), upd = () => { const r = (parseMoney(inp.value) || 0) - st.aplicado; $('#ib-r', el).textContent = `${fmt(r)}${st.aplicado > 0 ? ' (' + pctFmt(r / st.aplicado) + ')' : ''}`; $('#ib-r', el).className = `num ${r >= 0 ? 'pos' : 'neg'}`; };
        upd(); inp.addEventListener('input', upd);
        const reset = el.querySelector('[data-ibr]');
        if (reset) reset.onclick = async () => {
          await Store.update(`Investimentos/${inv._key}`, { saldoAtual: null, saldoEm: null });
          toast('Saldo recalculado desde os aportes'); this.detail(inv._key);
        };
        el.querySelector('[data-ib]').onclick = async () => {
          const v = parseMoney(inp.value); if (!(v >= 0)) return toast('Informe o saldo', 'err');
          await Store.update(`Investimentos/${inv._key}`, { saldoAtual: Math.round(v * 100) / 100, saldoEm: new Date().toISOString() });
          toast('Saldo atualizado'); this.detail(inv._key);
        };
      }
    });
  },

  /** Ajustes dos alertas (salvos na nuvem) */
  alertsCfg() {
    const c = DB.alerts || {}, on = k => c[k] !== false, perm = window.Notification?.permission;
    const sw = (id, label, sub, k) => `<label class="switch" style="margin:10px 0"><input type="checkbox" id="${id}" ${on(k) ? 'checked' : ''}><i></i><span>${label}<br><span class="faint" style="font-size:12px">${sub}</span></span></label>`;
    Sheet.open({
      title: 'Alertas de investimentos',
      body: `
        <div class="result" style="margin-bottom:14px"><div class="row"><span class="muted">Notificações</span><b>${perm === 'granted' ? 'Ativadas' : perm === 'denied' ? 'Bloqueadas no navegador' : 'Desativadas'}</b></div>
          ${perm === 'denied' ? '<div class="faint" style="font-size:12px">Libere nas configurações do navegador/celular para este site.</div>' : ''}</div>
        ${sw('ac-sound', 'Tocar som', 'Um “ding” quando chegar um alerta', 'sound')}
        ${sw('ac-stocks', 'Ações que tenho e acompanho', 'Variação forte no dia e preço-alvo', 'stocks')}
        ${sw('ac-radar', 'Radar diário de ações', 'Um aviso por dia útil com os destaques', 'radar')}
        ${sw('ac-inv', 'Rendimento da renda fixa e Selic', 'Quanto seus investimentos renderam e mudanças da Selic', 'invest')}
        <div class="field mt"><label for="ac-mv">Avisar quando uma ação variar a partir de</label>
          <select id="ac-mv">${[2, 3, 5, 8, 10].map(v => `<option value="${v}" ${Alerts.move() === v ? 'selected' : ''}>${v}% no dia</option>`).join('')}</select></div>
        <div class="field"><label for="ac-tk">Chave da brapi.dev (grátis)</label><input id="ac-tk" value="${esc(c.token || '')}" placeholder="Cole aqui a sua chave" autocomplete="off" spellcheck="false">
          <span class="hint">Crie em <a href="https://brapi.dev/dashboard" target="_blank" rel="noopener">brapi.dev/dashboard</a> (sem cartão). Sem chave, só PETR4, VALE3, MGLU3 e ITUB4.</span></div>
        <p class="faint" style="font-size:12px;margin-top:10px">Os alertas são verificados a cada 30 min com o app aberto. No Android, com o app instalado, o sistema também verifica em segundo plano de tempos em tempos.</p>`,
      foot: `${perm === 'granted' ? '<button class="btn" data-ac="test">Testar</button>' : '<button class="btn" data-ac="perm">Ativar notificações</button>'}<button class="btn primary" data-ac="save">Salvar</button>`,
      onMount: el => el.querySelector('.sheet-foot').onclick = async e => {
        const a = e.target.closest('[data-ac]')?.dataset.ac; if (!a) return;
        if (a === 'test') { Chime.unlock(); return Alerts.test(); }
        if (a === 'perm') { await App.enableNotifications(); return this.alertsCfg(); }
        const patch = { sound: $('#ac-sound', el).checked, stocks: $('#ac-stocks', el).checked, radar: $('#ac-radar', el).checked, invest: $('#ac-inv', el).checked, move: +$('#ac-mv', el).value, token: $('#ac-tk', el).value.trim() || null };
        const tokenChanged = (patch.token || '') !== (c.token || '');
        await Alerts.saveCfg(patch); Sheet.close(); toast('Alertas salvos');
        if (tokenChanged) { Market.error = null; Alerts.run(true); }
      }
    });
  },

  /** Acompanhar uma ação (com preços-alvo opcionais) */
  watchForm(t = '') {
    t = t.toUpperCase();
    const w = (DB.alerts?.watch || {})[t], q = Market.quote(t), owned = t && DB.invest.some(i => Market.tickerOf(i) === t);
    Sheet.open({
      title: w ? `Acompanhando ${esc(t)}` : t ? `Acompanhar ${esc(t)}` : 'Acompanhar ação',
      body: `
        ${q ? `<div class="result" style="margin-bottom:12px"><div class="row"><span class="muted">${esc(q.name || t)}</span><b class="num">${money(q.price)} ${chgTag(q.chg)}</b></div>
          ${q.pl ? `<div class="row"><span class="muted">P/L</span><b>${fmtNum(q.pl, 1)}</b></div>` : ''}
          ${q.lo52 && q.hi52 ? `<div class="row"><span class="muted">Mín./máx. 52 semanas</span><b class="num">${fmt(q.lo52)} – ${fmt(q.hi52)}</b></div>` : ''}</div>` : ''}
        <div class="field"><label for="wf-t">Código na bolsa</label><input id="wf-t" value="${esc(t)}" placeholder="Ex.: ITUB4, MXRF11" ${t ? 'readonly' : 'autofocus'} autocapitalize="characters" style="text-transform:uppercase"></div>
        <div class="fields-2">
          <div class="field"><label for="wf-c">Avisar se cair até (R$)</label><input id="wf-c" inputmode="decimal" value="${w?.compra ? fmtNum(w.compra) : ''}" placeholder="preço de compra"></div>
          <div class="field"><label for="wf-v">Avisar se subir até (R$)</label><input id="wf-v" inputmode="decimal" value="${w?.venda ? fmtNum(w.venda) : ''}" placeholder="preço de venda"></div>
        </div>
        <p class="faint" style="font-size:12px">Você também recebe um alerta quando ela variar ±${fmtNum(Alerts.move(), 0)}% ou mais no dia.${owned ? ' Esta ação já está na sua carteira, então é acompanhada automaticamente.' : ''}</p>`,
      foot: `${w ? '<button class="btn soft-danger" data-wf="del">Parar de acompanhar</button>' : ''}<button class="btn primary" data-wf="save">Salvar</button>`,
      onMount: el => el.querySelector('.sheet-foot').onclick = async e => {
        const a = e.target.closest('[data-wf]')?.dataset.wf; if (!a) return;
        const tk = $('#wf-t', el).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (a === 'del') {
          await Store.remove(`config/alerts/watch/${tk}`); if (DB.alerts?.watch) delete DB.alerts.watch[tk];
          Sheet.close(); toast(`${tk} removida`, 'info'); return Bus.emit('data', 'market');
        }
        if (!/^[A-Z]{4}\d{1,2}F?$/.test(tk)) return toast('Código inválido (ex.: PETR4, MXRF11)', 'err');
        const item = clean({ compra: parseMoney($('#wf-c', el).value) || null, venda: parseMoney($('#wf-v', el).value) || null, desde: w?.desde || today() });
        await Store.update('config/alerts/watch', { [tk]: item });
        DB.alerts = { ...(DB.alerts || {}), watch: { ...(DB.alerts?.watch || {}), [tk]: item } };
        Sheet.close(); toast(`Acompanhando ${tk}`);
        if (!Market.allowed(tk)) toast('Configure a chave da brapi para ver a cotação desta ação', 'info');
        else Market.refresh([tk]).then(() => Bus.emit('data', 'market')).catch(err => { Market.error = err.message; Bus.emit('data', 'market'); });
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
