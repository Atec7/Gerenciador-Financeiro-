/* ═══════════════════════════════════════════════════════════
   UI — toasts, sheets (modais), confirmação, componentes
   compartilhados e formulário de transação.
   ═══════════════════════════════════════════════════════════ */

/* ── Toast ── */
function toast(msg, type = 'ok', { action, onAction, ms = 3200 } = {}) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'check-circle')}<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { onAction?.(); el.remove(); };
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), action ? 5500 : ms);
  setTimeout(() => el.remove(), (action ? 5500 : ms) + 300);
}

/* ── Sheet (bottom sheet no celular, modal no desktop) ── */
const Sheet = {
  get el() { return $('#sheet'); },
  pushed: false,
  onClose: null,
  open({ title, body, foot = '', onMount, onClose }) {
    const el = this.el;
    el.innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-sheet-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
    this.onClose = onClose || null;
    if (!el.open) el.showModal();
    if (!this.pushed) { history.pushState({ sheet: 1 }, ''); this.pushed = true; }
    onMount?.(el);
    const first = el.querySelector('[autofocus]');
    if (first && matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 60);
    return el;
  },
  /** Fecha e resolve quando o histórico já voltou (evita conflito com navegação logo em seguida) */
  close() {
    this._close();
    if (!this.pushed) return Promise.resolve();
    this.pushed = false;
    return new Promise(res => { this._afterPop = res; history.back(); setTimeout(res, 400); });
  },
  _close() {
    const el = this.el;
    if (el.open) el.close();
    const f = this.onClose; this.onClose = null; f?.();
  },
  init() {
    const el = this.el;
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-sheet-close]')) this.close();
    });
    el.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
    window.addEventListener('popstate', () => {
      if (this.pushed) { this.pushed = false; this._close(); }
      const f = this._afterPop; this._afterPop = null; f?.();
    });
  }
};

/* ── Confirmação ── */
function confirmDialog(msg, { title = 'Confirmar', ok = 'Confirmar', danger = false } = {}) {
  return new Promise(res => {
    const el = $('#confirm');
    el.innerHTML = `
      <div class="sheet-head"><h3>${esc(title)}</h3></div>
      <div class="sheet-body"><p class="muted">${esc(msg)}</p></div>
      <div class="sheet-foot"><button class="btn" data-r="0">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`;
    const done = v => { el.close(); res(v); };
    el.onclick = e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === el) done(false); };
    el.oncancel = e => { e.preventDefault(); done(false); };
    el.showModal();
    setTimeout(() => el.querySelector('[data-r="1"]').focus(), 50);
  });
}

/** Diálogo com várias opções. Resolve com o valor escolhido ou null. options: [[valor, rótulo, perigoso?]] */
function choiceDialog(msg, { title = 'Escolha', options = [] } = {}) {
  return new Promise(res => {
    const el = $('#confirm');
    el.innerHTML = `
      <div class="sheet-head"><h3>${esc(title)}</h3></div>
      <div class="sheet-body"><p class="muted" style="margin-bottom:14px">${esc(msg)}</p>
        <div class="stack" style="gap:8px">${options.map(([v, l, d]) => `<button class="btn block ${d ? 'soft-danger' : ''}" data-r="${v}" style="justify-content:flex-start">${esc(l)}</button>`).join('')}</div></div>
      <div class="sheet-foot"><button class="btn" data-r="">Cancelar</button></div>`;
    const done = v => { el.close(); res(v || null); };
    el.onclick = e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r); else if (e.target === el) done(null); };
    el.oncancel = e => { e.preventDefault(); done(null); };
    el.showModal();
  });
}

/* ── Componentes ── */
const empty = (ic, title, sub = '', btn = '') =>
  `<div class="empty"><div class="empty-ic">${icon(ic)}</div><b>${title}</b>${sub ? `<div>${sub}</div>` : ''}${btn ? `<div class="mt">${btn}</div>` : ''}</div>`;

function monthNav() {
  return `<div class="month-nav">
    <button class="icon-btn sm" data-action="ym-prev" aria-label="Mês anterior">${icon('chev-l')}</button>
    <b data-action="ym-today" title="Ir para o mês atual">${ymLabel(App.ym)}</b>
    <button class="icon-btn sm" data-action="ym-next" aria-label="Próximo mês">${icon('chev-r')}</button>
  </div>`;
}

function txItemHTML(t, { showDate = false, toggle = true } = {}) {
  const c = cat(t.category), st = txStatus(t), inc = t.type === 'income';
  const tags = [
    t.isRecurring ? `<span class="pill info">${icon('repeat')}mensal</span>` : '',
    t.installmentInfo ? `<span class="pill gray">${esc(t.installmentInfo)}</span>` : ''
  ].join('');
  return `<div class="item" data-tx="${t._key}">
    ${catAvatar(c)}
    <div class="item-body">
      <div class="item-title"><span style="overflow:hidden;text-overflow:ellipsis">${esc(t.description || 'Sem descrição')}</span>${t.comprovanteUrl ? icon('clip', 'i-sm faint') : ''}</div>
      <div class="item-sub">${esc(c.nome)}${showDate ? ` · ${relDay(t.date)}` : ''} ${tags}</div>
    </div>
    <div class="item-end">
      <span class="item-amount ${inc ? 'pos' : ''}">${inc ? '+' : '−'} ${money(t.amount)}</span>
      <span class="pill ${st.toLowerCase()}">${statusLabel(t, st)}</span>
    </div>
    ${toggle ? `<button class="pay-toggle ${st === 'Pago' ? 'on' : ''}" data-pay="${t._key}" title="${st === 'Pago' ? 'Marcar como pendente' : (inc ? 'Marcar como recebido' : 'Marcar como pago')}">${icon('check')}</button>` : ''}
  </div>`;
}

/* ── Gráficos (Chart.js) ── */
const Charts = {
  inst: {},
  vars() {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    return { text: v('--muted'), grid: v('--border'), success: v('--success'), danger: v('--danger'), primary: v('--primary-2'), surface: v('--surface') };
  },
  make(id, canvas, cfg) {
    if (!window.Chart || !canvas) return;
    this.inst[id]?.destroy();
    const c = this.vars();
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.color = c.text;
    this.inst[id] = new Chart(canvas, cfg(c));
  },
  moneyTick: v => Math.abs(v) >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$ ' + v
};

/* ── Formulário de transação ── */
function openTxForm(t = null, preset = {}) {
  const edit = !!t;
  const f = edit ? { ...t } : {
    type: 'expense', description: '', amount: '', category: '', date: today(),
    status: undefined, isRecurring: false, notes: '', comprovanteUrl: '', ...preset
  };
  let paid = edit ? isPaid(t) : f.date <= today();
  let paidTouched = edit, catTouched = edit, repeat = 'none';

  const descOpts = [...DB.descIndex.values()].slice(-300).map(d => `<option value="${esc(d.description)}">`).join('');

  const catGrid = () => catList(f.type).map(c =>
    `<button type="button" class="cat-opt ${c.id === f.category ? 'active' : ''}" data-cat="${esc(c.id)}">${catIcon(c)}${esc(c.nome)}</button>`).join('');

  const body = `
    <div class="segmented type" id="tf-type">
      <button type="button" data-v="expense" class="${f.type === 'expense' ? 'active' : ''}">Despesa</button>
      <button type="button" data-v="income" class="${f.type === 'income' ? 'active' : ''}">Receita</button>
    </div>
    <div class="amount-input ${f.type}" id="tf-amount-wrap">
      <span>R$</span><input id="tf-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${f.amount ? fmtNum(f.amount) : ''}" ${edit ? '' : 'autofocus'}>
    </div>
    <div class="field">
      <label for="tf-desc">Descrição</label>
      <input id="tf-desc" list="tf-desc-list" placeholder="Ex.: Mercado, Aluguel, Salário…" value="${esc(f.description)}" autocomplete="off">
      <datalist id="tf-desc-list">${descOpts}</datalist>
    </div>
    <div class="field"><label>Categoria</label><div class="cat-grid" id="tf-cats">${catGrid()}</div></div>
    <div class="field hidden" id="tf-inv-wrap"><label for="tf-inv">Investimento vinculado</label>
      <select id="tf-inv"></select>
      <span class="hint">Lançamentos em Investimentos entram automaticamente na aba Investimentos (despesa = aporte, receita = resgate).</span>
    </div>
    <div class="fields-2">
      <div class="field"><label for="tf-date">Data / vencimento</label><input type="date" id="tf-date" value="${f.date}"></div>
      <div class="field"><label>Situação</label>
        <label class="switch" style="height:46px"><input type="checkbox" id="tf-paid" ${paid ? 'checked' : ''}><i></i><span id="tf-paid-l"></span></label>
      </div>
    </div>
    ${edit ? `
      <label class="switch" style="margin-bottom:14px"><input type="checkbox" id="tf-rec" ${f.isRecurring ? 'checked' : ''}><i></i>Repete todo mês</label>
    ` : `
      <div class="field"><label>Repetição</label>
        <div class="segmented" id="tf-repeat">
          <button type="button" data-v="none" class="active">Única</button>
          <button type="button" data-v="inst">Parcelada</button>
          <button type="button" data-v="rec">Todo mês</button>
        </div>
      </div>
      <div class="field hidden" id="tf-inst-wrap">
        <label for="tf-inst">Número de parcelas (o valor acima é de cada parcela)</label>
        <input type="number" id="tf-inst" min="2" max="120" value="2" inputmode="numeric">
        <span class="hint" id="tf-inst-hint"></span>
      </div>
    `}
    <div class="field"><label for="tf-notes">Observação</label><textarea id="tf-notes" rows="2" style="min-height:60px" placeholder="Opcional">${esc(f.notes || '')}</textarea></div>
    <div class="field"><label>Comprovante</label>
      <div class="row" id="tf-proof"></div>
    </div>`;

  const foot = edit
    ? `<button class="btn soft-danger" data-tf="del" style="flex:0 0 auto">${icon('trash')}</button>
       <button class="btn" data-tf="dup" style="flex:0 0 auto" title="Duplicar">${icon('copy')}</button>
       <button class="btn primary" data-tf="save">Salvar</button>`
    : `<button class="btn primary lg" data-tf="save">Adicionar</button>`;

  Sheet.open({
    title: edit ? 'Editar transação' : 'Nova transação', body, foot,
    onMount(el) {
      const amountIn = $('#tf-amount', el), desc = $('#tf-desc', el), dateIn = $('#tf-date', el), paidIn = $('#tf-paid', el);
      const paidLabel = () => { $('#tf-paid-l', el).textContent = paidIn.checked ? (f.type === 'income' ? 'Recebido' : 'Pago') : (f.type === 'income' ? 'A receber' : 'Pendente'); };
      const renderProof = () => {
        $('#tf-proof', el).innerHTML = f.comprovanteUrl
          ? `<img src="${esc(f.comprovanteUrl)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;cursor:zoom-in" data-tf="view">
             <button type="button" class="btn sm" data-tf="proof">${icon('refresh', 'i-sm')} Trocar</button>
             <button type="button" class="btn sm soft-danger" data-tf="unproof">${icon('x', 'i-sm')} Remover</button>`
          : `<button type="button" class="btn sm" data-tf="proof">${icon('clip', 'i-sm')} Anexar imagem</button>`;
      };
      const instHint = () => {
        const n = parseInt($('#tf-inst', el)?.value, 10) || 0, v = parseMoney(amountIn.value) || 0;
        if ($('#tf-inst-hint', el)) $('#tf-inst-hint', el).textContent = n > 1 ? `Total: ${fmt(v * n)} · última parcela em ${fmtDate(addMonths(dateIn.value || today(), n - 1))}` : '';
      };
      let invTouched = false;
      const invField = () => {
        const on = f.category === 'investimentos', sel = $('#tf-inv', el);
        $('#tf-inv-wrap', el).classList.toggle('hidden', !on);
        if (!on) return;
        const cur = invTouched ? sel.value : (t?.investId || Invest.match(desc.value)?._key || '__new');
        sel.innerHTML = `<option value="__new">Novo investimento (usa a descrição como nome)</option>`
          + DB.invest.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(i => `<option value="${i._key}">${esc(i.nome)}${i.tipo ? ' · ' + esc(i.tipo) : ''}</option>`).join('')
          + `<option value="">Não vincular</option>`;
        sel.value = [...sel.options].some(o => o.value === cur) ? cur : '__new';
      };
      $('#tf-inv', el).addEventListener('change', () => { invTouched = true; });
      desc.addEventListener('input', () => { if (!invTouched) invField(); });
      paidLabel(); renderProof(); invField();

      $('#tf-type', el).onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        f.type = b.dataset.v;
        $$('#tf-type button', el).forEach(x => x.classList.toggle('active', x === b));
        $('#tf-amount-wrap', el).className = `amount-input ${f.type}`;
        if (cat(f.category).tipo !== 'both' && cat(f.category).tipo !== f.type) { f.category = ''; catTouched = false; }
        $('#tf-cats', el).innerHTML = catGrid(); paidLabel(); invField();
      };
      $('#tf-cats', el).onclick = e => {
        const b = e.target.closest('[data-cat]'); if (!b) return;
        f.category = b.dataset.cat; catTouched = true;
        $$('.cat-opt', el).forEach(x => x.classList.toggle('active', x === b));
        invField();
      };
      desc.addEventListener('change', () => {
        const hit = DB.descIndex.get(norm(desc.value));
        if (!hit) {
          const g = !catTouched && guessCategory(desc.value, f.type);
          if (g) { f.category = g; $('#tf-cats', el).innerHTML = catGrid(); invField(); }
          return;
        }
        if (!catTouched && hit.category) {
          if (hit.type !== f.type) $(`#tf-type [data-v="${hit.type}"]`, el).click();
          f.category = hit.category; $('#tf-cats', el).innerHTML = catGrid(); invField();
        }
        if (!amountIn.value && hit.amount) amountIn.value = fmtNum(hit.amount);
      });
      dateIn.addEventListener('change', () => { if (!paidTouched) { paidIn.checked = dateIn.value <= today(); paidLabel(); } instHint(); });
      paidIn.addEventListener('change', () => { paidTouched = true; paidLabel(); });
      amountIn.addEventListener('input', instHint);
      amountIn.addEventListener('keydown', e => { if (e.key === 'Enter') desc.focus(); });

      $('#tf-repeat', el)?.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        repeat = b.dataset.v;
        $$('#tf-repeat button', el).forEach(x => x.classList.toggle('active', x === b));
        $('#tf-inst-wrap', el).classList.toggle('hidden', repeat !== 'inst');
        instHint();
      });
      $('#tf-inst', el)?.addEventListener('input', instHint);

      el.querySelector('.sheet-body').addEventListener('click', async e => {
        const a = e.target.closest('[data-tf]')?.dataset.tf;
        if (a === 'proof') {
          const file = await pickFile(); if (!file) return;
          toast('Enviando imagem…', 'info');
          try { f.comprovanteUrl = await uploadImage(file); renderProof(); toast('Imagem anexada'); }
          catch (err) { toast('Erro no envio: ' + err.message, 'err'); }
        } else if (a === 'unproof') { f.comprovanteUrl = ''; renderProof(); }
        else if (a === 'view') window.open(f.comprovanteUrl, '_blank');
      });

      el.querySelector('.sheet-foot').addEventListener('click', async e => {
        const a = e.target.closest('[data-tf]')?.dataset.tf; if (!a) return;
        if (a === 'del') {
          const ser = Tx.series(t);
          if (ser.length > 1) {
            const next = ser.filter(x => (x.date || '') >= (t.date || ''));
            const opts = [['one', 'Somente este lançamento']];
            if (next.length > 1 && next.length < ser.length) opts.push(['next', `Este e os próximos (${next.length})`]);
            opts.push(['all', `Todos da série (${ser.length})`, true]);
            const v = await choiceDialog(`"${baseDesc(t.description)}" faz parte de uma série com ${ser.length} lançamentos. O que deseja excluir?`, { title: 'Excluir lançamento', options: opts });
            if (!v) return;
            Sheet.close(); Tx.removeMany(v === 'one' ? [t] : v === 'next' ? next : ser); return;
          }
          if (!(await confirmDialog(`Excluir "${t.description}"?`, { title: 'Excluir transação', ok: 'Excluir', danger: true }))) return;
          Sheet.close(); Tx.remove(t); return;
        }
        if (a === 'dup') {
          Sheet.close().then(() => openTxForm(null, { type: t.type, description: t.description, amount: t.amount, category: t.category, date: today(), notes: t.notes || '' }));
          return;
        }
        // salvar
        const amount = parseMoney(amountIn.value), description = desc.value.trim(), date = dateIn.value;
        if (!(amount > 0)) { toast('Informe um valor válido', 'err'); amountIn.focus(); return; }
        if (!description) { toast('Informe uma descrição', 'err'); desc.focus(); return; }
        if (!date) { toast('Informe a data', 'err'); return; }
        const data = {
          description, amount: Math.round(amount * 100) / 100, type: f.type, category: f.category || 'outros', date,
          status: paidIn.checked ? 'Pago' : 'Pendente', paidAt: paidIn.checked ? (t?.paidAt || today()) : null,
          notes: $('#tf-notes', el).value.trim() || null, comprovanteUrl: f.comprovanteUrl || null
        };
        // investimento vinculado (criado na hora, se for novo)
        const invSel = data.category === 'investimentos' ? $('#tf-inv', el).value : '';
        const upd = {};
        let investId = invSel || null, newInv = null;
        if (invSel === '__new') { investId = Store.newKey(); newInv = { ...Invest.newNode(description), movs: {} }; }
        data.investId = investId;
        const link = (key, tx) => {
          if (!investId) return;
          const prev = DB.invest.find(i => i._key === investId)?.movs?.[key];
          const mov = { ...Invest.mov(tx, key), em: prev?.em || new Date().toISOString() };
          if (newInv) newInv.movs[key] = mov; else upd[`Investimentos/${investId}/movs/${key}`] = mov;
        };
        try {
          let msg;
          if (edit) {
            data.isRecurring = $('#tf-rec', el).checked;
            Object.entries(data).forEach(([k, v]) => { upd[`transactions/${t._key}/${k}`] = v ?? null; });
            if (t.investId && t.investId !== investId) upd[`Investimentos/${t.investId}/movs/${t._key}`] = null;
            link(t._key, data); msg = 'Transação atualizada';
          } else if (repeat === 'inst') {
            const n = clamp(parseInt($('#tf-inst', el).value, 10) || 0, 2, 120);
            Object.entries(Tx.installments(data, n)).forEach(([k, v]) => { upd[`transactions/${k}`] = v; link(k, v); });
            msg = `${n} parcelas criadas`;
          } else {
            data.isRecurring = repeat === 'rec';
            const k = Store.newKey(); upd[`transactions/${k}`] = clean(data); link(k, data);
            msg = f.type === 'income' ? 'Receita adicionada' : 'Despesa adicionada';
          }
          if (newInv) upd[`Investimentos/${investId}`] = newInv;
          await Store.multi(upd);
          toast(investId ? msg + ' · registrado em Investimentos' : msg);
          Sheet.close();
        } catch (err) { console.error(err); toast('Erro ao salvar: ' + err.message, 'err'); }
      });
      // Enter no desktop salva
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.querySelector('[data-tf="save"]').click(); });
    }
  });
}

/* ── Visualizador de imagem ── */
function viewImage(url, title = 'Comprovante') {
  Sheet.open({
    title, body: `<div class="viewer"><img src="${esc(url)}" alt="${esc(title)}"></div>`,
    foot: `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon('external')} Abrir original</a>`
  });
}

/* registro das telas */
const Views = {};
