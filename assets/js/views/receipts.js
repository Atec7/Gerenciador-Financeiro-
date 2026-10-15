/* ═══════════ COMPROVANTES ═══════════ */

Views.receipts = {
  filter: 'missing', type: 'expense', uploading: new Set(),

  render(el) {
    const month = txOfMonth(App.ym).filter(t => this.type === 'all' || t.type === this.type);
    const withP = month.filter(t => t.comprovanteUrl), paidNo = month.filter(t => isPaid(t) && !t.comprovanteUrl);
    let list = this.filter === 'missing' ? month.filter(t => !t.comprovanteUrl) : this.filter === 'with' ? withP : month;
    list = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const pct = month.length ? Math.round(withP.length / month.length * 100) : 0;

    el.innerHTML = `
      <div class="toolbar">${monthNav()}
        <select class="input" id="rc-type" style="width:auto">
          <option value="expense" ${this.type === 'expense' ? 'selected' : ''}>Só despesas</option>
          <option value="income" ${this.type === 'income' ? 'selected' : ''}>Só receitas</option>
          <option value="all" ${this.type === 'all' ? 'selected' : ''}>Tudo</option>
        </select>
        <span class="spacer"></span>
        <button class="btn" id="rc-pdf">${icon('file')} PDF com imagens</button>
      </div>
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><small>Comprovantes anexados</small><b>${pct}%</b><div class="progress mt" style="margin-top:8px"><i style="width:${pct}%;background:var(--success)"></i></div></div>
        <div class="stat"><small>Com comprovante</small><b class="pos">${withP.length}</b><em>de ${month.length}</em></div>
        <div class="stat"><small>Pagos sem comprovante</small><b class="${paidNo.length ? 'warn' : ''}">${paidNo.length}</b><em>${money(sum(paidNo, t => t.amount))}</em></div>
        <div class="stat"><small>Total pago no mês</small><b>${money(sum(month.filter(isPaid), t => t.amount))}</b></div>
      </div>
      <div class="chips" id="rc-chips" style="margin-bottom:12px">
        ${[['missing', 'Sem comprovante', month.length - withP.length], ['with', 'Com comprovante', withP.length], ['all', 'Todos', month.length]]
          .map(([f, l, n]) => `<button class="chip ${this.filter === f ? 'active' : ''}" data-f="${f}">${l} <span class="count">${n}</span></button>`).join('')}
      </div>
      <p class="muted only-desktop" style="font-size:13px;margin:0 4px 10px">Dica: arraste uma imagem do computador direto para cima de um lançamento.</p>
      <div class="card flush">
        ${list.length ? `<div class="list">${list.map(t => {
          const c = cat(t.category), st = txStatus(t), up = this.uploading.has(t._key);
          return `<div class="item rc-item" data-rc="${t._key}" style="cursor:default">
            ${t.comprovanteUrl ? `<img class="thumb" src="${esc(t.comprovanteUrl)}" alt="" loading="lazy" data-r="view" data-k="${t._key}">` : `${catAvatar(c)}`}
            <div class="item-body">
              <div class="item-title">${esc(t.description)}</div>
              <div class="item-sub">${fmtDate(t.date)} · ${money(t.amount)} <span class="pill ${st.toLowerCase()}">${statusLabel(t, st)}</span></div>
            </div>
            <div class="tx-actions">
              ${up ? `<span class="muted" style="font-size:13px">Enviando…</span>`
                : t.comprovanteUrl
                  ? `<button class="btn sm" data-r="view" data-k="${t._key}">${icon('eye', 'i-sm')} Ver</button>
                     <button class="icon-btn sm" data-r="up" data-k="${t._key}" title="Trocar">${icon('refresh', 'i-sm')}</button>
                     <button class="icon-btn sm" data-r="del" data-k="${t._key}" title="Remover">${icon('trash', 'i-sm')}</button>`
                  : `<button class="btn sm primary" data-r="up" data-k="${t._key}">${icon('upload', 'i-sm')} Anexar</button>`}
            </div>
          </div>`;
        }).join('')}</div>` : empty(this.filter === 'missing' ? 'check-circle' : 'receipt', this.filter === 'missing' ? 'Todos os comprovantes anexados!' : 'Nada por aqui')}
      </div>`;

    $('#rc-type', el).onchange = e => { this.type = e.target.value; this.render(el); };
    $('#rc-chips', el).onclick = e => { const c = e.target.closest('[data-f]'); if (c) { this.filter = c.dataset.f; this.render(el); } };
    $('#rc-pdf', el).onclick = () => this.pdf(list);
    el.querySelector('.card.flush').onclick = async e => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const t = DB.tx.find(x => x._key === b.dataset.k); if (!t) return;
      if (b.dataset.r === 'view') viewImage(t.comprovanteUrl, t.description);
      if (b.dataset.r === 'up') { const f = await pickFile(); if (f) this.upload(t, f); }
      if (b.dataset.r === 'del' && await confirmDialog('Remover o comprovante deste lançamento?', { ok: 'Remover', danger: true })) {
        await Store.update(`transactions/${t._key}`, { comprovanteUrl: null }); toast('Comprovante removido', 'info');
      }
    };
    // arrastar e soltar (desktop)
    $$('[data-rc]', el).forEach(row => {
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drop-hover'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-hover'));
      row.addEventListener('drop', e => {
        e.preventDefault(); row.classList.remove('drop-hover');
        const f = e.dataTransfer.files[0], t = DB.tx.find(x => x._key === row.dataset.rc);
        if (f && t) f.type.startsWith('image/') ? this.upload(t, f) : toast('Envie uma imagem (JPG/PNG)', 'err');
      });
    });
  },

  async upload(t, file) {
    this.uploading.add(t._key); App.refresh();
    try {
      const url = await uploadImage(file);
      await Store.update(`transactions/${t._key}`, { comprovanteUrl: url });
      toast('Comprovante anexado');
    } catch (err) { toast('Erro no envio: ' + err.message, 'err'); }
    finally { this.uploading.delete(t._key); App.refresh(); }
  },

  async pdf(list) {
    if (!list.length) return toast('Nada para exportar', 'err');
    toast('Gerando PDF (pode levar alguns segundos)…', 'info');
    let jsPDF; try { jsPDF = await loadPDF(); } catch (e) { return toast(e.message, 'err'); }
    const doc = new jsPDF('p', 'pt', 'a4');
    let y = 50;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(`Comprovantes · ${ymLabel(App.ym)}`, 40, y); y += 30;
    for (const t of list) {
      if (y > 640) { doc.addPage(); y = 50; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(String(t.description || ''), 40, y); y += 15;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text(`${fmtDate(t.date)}  ·  ${fmt(t.amount)}  ·  ${statusLabel(t)}  ·  ${t.comprovanteUrl ? 'Comprovante anexado' : 'Sem comprovante'}`, 40, y); y += 12;
      if (t.comprovanteUrl) {
        try {
          const data = await fetch(t.comprovanteUrl).then(r => r.blob()).then(b => new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(b); }));
          const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = data; });
          const w = Math.min(260, img.width), h = img.height * (w / img.width), hh = Math.min(h, 300);
          if (y + hh > 800) { doc.addPage(); y = 50; }
          doc.addImage(data, 'JPEG', 40, y + 4, w * (hh / h), hh); y += hh + 10;
        } catch { doc.setTextColor(200, 0, 0); doc.text('(não foi possível carregar a imagem)', 40, y + 12); doc.setTextColor(0); y += 16; }
      }
      y += 18; doc.setDrawColor(230); doc.line(40, y - 10, 555, y - 10);
    }
    doc.save(`comprovantes-${App.ym}.pdf`); toast('PDF exportado');
  }
};
