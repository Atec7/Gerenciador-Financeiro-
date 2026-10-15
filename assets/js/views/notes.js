/* ═══════════ LEMBRETES / ANOTAÇÕES ═══════════ */

const NOTE_COLORS = ['', '#6366f1', '#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899'];
const nowLocal = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

Views.notes = {
  tab: 'open', q: '',

  render(el) {
    const q = norm(this.q);
    let list = DB.notes.filter(n => this.tab === 'all' || (this.tab === 'done' ? n.feito : !n.feito));
    if (q) list = list.filter(n => norm(n.titulo).includes(q) || norm(n.texto).includes(q));
    list.sort((a, b) => (b.fixado ? 1 : 0) - (a.fixado ? 1 : 0) || (noteDue(a) || '~').localeCompare(noteDue(b) || '~') || (b.data || '').localeCompare(a.data || ''));
    const open = DB.notes.filter(n => !n.feito).length, done = DB.notes.length - open, now = nowLocal();

    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <form class="quick-note" id="nt-quick">
          <input class="input" id="nt-q-title" placeholder="Novo lembrete rápido… (Enter para salvar)" autocomplete="off">
          <button class="btn primary" type="submit">${icon('plus')}</button>
          <button class="btn" type="button" id="nt-full" title="Com data, cor e detalhes">${icon('edit')}<span class="only-desktop">Detalhado</span></button>
        </form>
      </div>
      <div class="toolbar">
        <div class="chips" id="nt-tabs">
          ${[['open', 'Pendentes', open], ['done', 'Concluídos', done], ['all', 'Todos', DB.notes.length]].map(([t, l, n]) => `<button class="chip ${this.tab === t ? 'active' : ''}" data-t="${t}">${l} <span class="count">${n}</span></button>`).join('')}
        </div>
        <div class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="nt-search" type="search" placeholder="Buscar lembretes" value="${esc(this.q)}"></div>
        ${'Notification' in window && Notification.permission !== 'granted' ? `<button class="btn" id="nt-notif">${icon('bell')} Ativar alertas</button>` : ''}
      </div>
      ${list.length ? `<div class="notes-grid">${list.map(n => {
        const due = noteDue(n), over = due && due <= now;
        return `<div class="note ${n.feito ? 'done' : ''}" data-nk="${n._key}" style="--nc:${n.cor || 'var(--border)'}">
          <h4><span>${esc(n.titulo || 'Sem título')}</span>${n.fixado ? icon('pin') : ''}</h4>
          ${n.texto ? `<p>${esc(n.texto)}</p>` : ''}
          <div class="note-foot">
            ${due ? `<span class="pill ${over ? 'atrasado' : 'info'}">${icon('clock')}${relDay(due.slice(0, 10))} ${due.slice(11, 16)}</span>` : `<span>${n.data ? fmtDate(n.data.slice(0, 10)) : ''}</span>`}
            <span class="spacer"></span>
            ${n.texto ? `<button class="icon-btn sm" data-n="copy" title="Copiar texto">${icon('copy', 'i-sm')}</button>` : ''}
            <button class="pay-toggle ${n.feito ? 'on' : ''}" data-n="done" title="${n.feito ? 'Reabrir' : 'Concluir'}">${icon('check')}</button>
          </div>
        </div>`;
      }).join('')}</div>`
      : `<div class="card">${empty('bell', this.q ? 'Nada encontrado' : this.tab === 'done' ? 'Nenhum lembrete concluído' : 'Nenhum lembrete pendente', 'Anote contas para lembrar, recados, listas de compras…')}</div>`}`;

    $('#nt-quick', el).onsubmit = e => {
      e.preventDefault();
      const t = $('#nt-q-title', el).value.trim(); if (!t) return;
      Notes.save(null, { titulo: t, texto: '' }); toast('Lembrete salvo');
      this.tab = 'open';
    };
    $('#nt-full', el).onclick = () => this.form(null, $('#nt-q-title', el).value.trim());
    $('#nt-tabs', el).onclick = e => { const c = e.target.closest('[data-t]'); if (c) { this.tab = c.dataset.t; this.render(el); } };
    $('#nt-search', el).addEventListener('input', debounce(e => { this.q = e.target.value; this.render(el); const s = $('#nt-search', el); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250));
    $('#nt-notif', el)?.addEventListener('click', () => App.enableNotifications());
    el.querySelector('.notes-grid')?.addEventListener('click', e => {
      const card = e.target.closest('[data-nk]'); if (!card) return;
      const n = DB.notes.find(x => x._key === card.dataset.nk); if (!n) return;
      const a = e.target.closest('[data-n]')?.dataset.n;
      if (a === 'done') { Store.update(`Lembretes/${n._key}`, { feito: !n.feito }); toast(n.feito ? 'Lembrete reaberto' : 'Lembrete concluído', n.feito ? 'info' : 'ok'); }
      else if (a === 'copy') copyText(n.texto);
      else this.form(n);
    });
  },

  form(n = null, title = '') {
    let cor = n?.cor || '';
    Sheet.open({
      title: n ? 'Editar lembrete' : 'Novo lembrete',
      body: `
        <div class="field"><label for="nf-t">Título</label><input id="nf-t" value="${esc(n?.titulo || title)}" placeholder="Ex.: Pagar IPVA" autofocus></div>
        <div class="field"><label for="nf-x">Anotação</label><textarea id="nf-x" rows="5" placeholder="Detalhes, lista de compras, códigos de barras…">${esc(n?.texto || '')}</textarea></div>
        <div class="field"><label for="nf-q">Lembrar em (opcional)</label>
          <input type="datetime-local" id="nf-q" value="${n?.quando || ''}">
          <div class="chips mt" style="margin-top:8px">
            <button type="button" class="chip" data-q="1h">+1 hora</button>
            <button type="button" class="chip" data-q="tom">Amanhã 9h</button>
            <button type="button" class="chip" data-q="week">Em 1 semana</button>
            <button type="button" class="chip" data-q="clear">Sem data</button>
          </div>
        </div>
        <div class="field"><label>Cor</label><div class="color-pick" id="nf-c">${NOTE_COLORS.map(c => `<button type="button" style="--c:${c || 'var(--surface-3)'}" class="${c === cor ? 'active' : ''}" data-c="${c}"></button>`).join('')}</div></div>
        <div class="row wrap" style="gap:20px">
          <label class="switch"><input type="checkbox" id="nf-pin" ${n?.fixado ? 'checked' : ''}><i></i>Fixar no topo</label>
          ${n ? `<label class="switch"><input type="checkbox" id="nf-done" ${n.feito ? 'checked' : ''}><i></i>Concluído</label>` : ''}
        </div>`,
      foot: `${n ? `<button class="btn soft-danger" data-nf="del" style="flex:0 0 auto">${icon('trash')}</button>` : ''}<button class="btn primary" data-nf="save">Salvar</button>`,
      onMount: el => {
        const q = $('#nf-q', el);
        el.querySelector('.chips').onclick = e => {
          const v = e.target.closest('[data-q]')?.dataset.q; if (!v) return;
          const d = new Date();
          if (v === '1h') d.setHours(d.getHours() + 1);
          if (v === 'tom') { d.setDate(d.getDate() + 1); d.setHours(9, 0); }
          if (v === 'week') { d.setDate(d.getDate() + 7); d.setHours(9, 0); }
          q.value = v === 'clear' ? '' : `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };
        $('#nf-c', el).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cor = b.dataset.c; $$('#nf-c button', el).forEach(x => x.classList.toggle('active', x === b)); };
        el.querySelector('.sheet-foot').onclick = async e => {
          const a = e.target.closest('[data-nf]')?.dataset.nf; if (!a) return;
          if (a === 'del') {
            if (!(await confirmDialog('Excluir este lembrete?', { ok: 'Excluir', danger: true }))) return;
            const backup = clean(n); await Notes.remove(n._key); Sheet.close();
            return toast('Lembrete excluído', 'info', { action: 'Desfazer', onAction: () => Store.set(`Lembretes/${n._key}`, backup) });
          }
          const titulo = $('#nf-t', el).value.trim(), texto = $('#nf-x', el).value.trim();
          if (!titulo && !texto) return toast('Escreva algo', 'err');
          await Notes.save(n?._key, { titulo, texto, quando: q.value || null, cor: cor || null, fixado: $('#nf-pin', el).checked || null, feito: $('#nf-done', el)?.checked || null });
          if (q.value && 'Notification' in window && Notification.permission === 'default') App.enableNotifications();
          Sheet.close(); toast('Lembrete salvo');
        };
      }
    });
  }
};
