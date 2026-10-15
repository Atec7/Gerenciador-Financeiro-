/* ═══════════ TRANSAÇÕES (extrato) ═══════════ */

const Exporter = {
  rows(list) {
    return [...list].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(t => ({
      Data: fmtDate(t.date), Descrição: t.description || '', Categoria: cat(t.category).nome,
      Tipo: t.type === 'income' ? 'Receita' : 'Despesa', Valor: Number(t.amount), Status: statusLabel(t), Observação: t.notes || ''
    }));
  },
  csv(list, name = 'transacoes') {
    const rows = this.rows(list); if (!rows.length) return toast('Nada para exportar', 'err');
    const cols = Object.keys(rows[0]);
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿' + cols.join(';') + '\n' + rows.map(r => cols.map(c => c === 'Valor' ? fmtNum(r[c]) : q(r[c])).join(';')).join('\n');
    downloadBlob(csv, `${name}.csv`, 'text/csv;charset=utf-8'); toast('CSV exportado');
  },
  async xlsx(list, name = 'transacoes') {
    const rows = this.rows(list); if (!rows.length) return toast('Nada para exportar', 'err');
    toast('Gerando Excel…', 'info');
    try { await loadScript(LIBS.xlsx); } catch (e) { return toast(e.message, 'err'); }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 11 }, { wch: 38 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 30 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Transações');
    XLSX.writeFile(wb, `${name}.xlsx`); toast('Excel exportado');
  },
  async pdf(list, title = 'Relatório financeiro', name = 'relatorio') {
    if (!list.length) return toast('Nada para exportar', 'err');
    toast('Gerando PDF…', 'info');
    let jsPDF; try { jsPDF = await loadPDF(); } catch (e) { return toast(e.message, 'err'); }
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' }), T = totals(list);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(title, 40, 50);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100);
    doc.text(`Gerado em ${fmtDate(today())} · ${list.length} lançamentos`, 40, 68);
    doc.setTextColor(20); doc.setFontSize(11);
    doc.text(`Receitas: ${fmt(T.inc)}    Despesas: ${fmt(T.exp)}    Saldo: ${fmt(T.bal)}`, 40, 90);
    const cats = byCategory(list);
    doc.autoTable({
      startY: 106, head: [['Data', 'Descrição', 'Categoria', 'Valor', 'Status']],
      body: this.rows(list).map(r => [r.Data, r.Descrição, r.Categoria, (r.Tipo === 'Receita' ? '+ ' : '- ') + fmt(r.Valor), r.Status]),
      styles: { fontSize: 8.5, cellPadding: 5 }, headStyles: { fillColor: [79, 70, 229] },
      alternateRowStyles: { fillColor: [246, 247, 251] }, columnStyles: { 3: { halign: 'right' } },
      didParseCell: d => { if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = String(d.cell.raw).startsWith('+') ? [18, 161, 80] : [229, 56, 59]; }
    });
    if (cats.length) doc.autoTable({
      startY: doc.lastAutoTable.finalY + 24, head: [['Despesas por categoria', 'Total', '%']],
      body: cats.map(([id, v]) => [cat(id).nome, fmt(v), (v / T.exp * 100).toFixed(1) + '%']),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } }
    });
    doc.save(`${name}.pdf`); toast('PDF exportado');
  },
  menu(list, label) {
    const slug = 'fin-' + label.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-');
    Sheet.open({
      title: 'Exportar', body: `
        <p class="muted" style="margin-bottom:14px">${list.length} lançamento(s) · ${esc(label)}</p>
        <div class="stack">
          <button class="btn lg block" data-x="pdf">${icon('file')} Relatório em PDF</button>
          <button class="btn lg block" data-x="xlsx">${icon('grid')} Planilha Excel (.xlsx)</button>
          <button class="btn lg block" data-x="csv">${icon('download')} CSV</button>
          <button class="btn lg block" data-x="print">${icon('file')} Imprimir esta tela</button>
        </div>`,
      onMount: el => el.querySelector('.stack').onclick = e => {
        const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
        Sheet.close();
        if (x === 'pdf') this.pdf(list, `Relatório · ${label}`, slug);
        if (x === 'xlsx') this.xlsx(list, slug);
        if (x === 'csv') this.csv(list, slug);
        if (x === 'print') setTimeout(() => print(), 300);
      }
    });
  }
};

Views.tx = {
  q: '', filter: 'all', cat: 'all', sort: 'date',

  filtered() {
    const q = norm(this.q);
    // com busca: procura em todos os meses
    let l = q ? DB.tx.filter(t => norm(t.description).includes(q) || norm(t.notes).includes(q) || norm(cat(t.category).nome).includes(q) || String(t.amount).includes(q.replace(',', '.')))
              : txOfMonth(App.ym);
    if (this.cat !== 'all') l = l.filter(t => t.category === this.cat);
    const f = this.filter;
    if (f === 'income' || f === 'expense') l = l.filter(t => t.type === f);
    if (f === 'pending') l = l.filter(t => txStatus(t) === 'Pendente');
    if (f === 'late') l = l.filter(t => txStatus(t) === 'Atrasado');
    if (f === 'paid') l = l.filter(isPaid);
    if (f === 'rec') l = l.filter(t => t.isRecurring || t.installmentInfo);
    return l;
  },

  render(el) {
    const cats = catList();
    el.innerHTML = `
      <div class="toolbar">
        ${monthNav()}
        <div class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="tx-q" type="search" placeholder="Buscar em todos os meses…  ( / )" value="${esc(this.q)}"></div>
        <select class="input" id="tx-cat" style="width:auto;max-width:200px">
          <option value="all">Todas as categorias</option>
          ${cats.map(c => `<option value="${esc(c.id)}" ${this.cat === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select>
        <select class="input" id="tx-sort" style="width:auto">
          <option value="date" ${this.sort === 'date' ? 'selected' : ''}>Mais recentes</option>
          <option value="amount" ${this.sort === 'amount' ? 'selected' : ''}>Maior valor</option>
        </select>
        <button class="btn" id="tx-export">${icon('download')} <span class="only-desktop">Exportar</span></button>
      </div>
      <div class="chips" id="tx-chips" style="margin-bottom:12px"></div>
      <div id="tx-body"></div>`;

    $('#tx-q', el).addEventListener('input', debounce(e => { this.q = e.target.value; this.renderList(el); }, 150));
    $('#tx-cat', el).onchange = e => { this.cat = e.target.value; this.renderList(el); };
    $('#tx-sort', el).onchange = e => { this.sort = e.target.value; this.renderList(el); };
    $('#tx-chips', el).onclick = e => { const c = e.target.closest('[data-f]'); if (c) { this.filter = c.dataset.f; this.renderList(el); } };
    $('#tx-export', el).onclick = () => Exporter.menu(this.filtered(), this.q ? `busca "${this.q}"` : ymLabel(App.ym));
    this.renderList(el);
  },

  renderList(el) {
    const list = this.filtered(), base = this.q ? DB.tx : txOfMonth(App.ym);
    const count = f => base.filter(f).length;
    const chips = [
      ['all', 'Todos', base.length], ['expense', 'Despesas', count(t => t.type === 'expense')], ['income', 'Receitas', count(t => t.type === 'income')],
      ['pending', 'Pendentes', count(t => txStatus(t) === 'Pendente')], ['late', 'Atrasados', count(t => txStatus(t) === 'Atrasado')],
      ['paid', 'Pagos', count(isPaid)], ['rec', 'Fixos', count(t => t.isRecurring || t.installmentInfo)]
    ];
    $('#tx-chips', el).innerHTML = chips.map(([f, l, n]) => `<button class="chip ${this.filter === f ? 'active' : ''}" data-f="${f}">${l} <span class="count">${n}</span></button>`).join('');

    const T = totals(list);
    let html = `
      <div class="summary-bar">
        <div><small>Entradas</small><b class="pos">${money(T.inc)}</b></div>
        <div><small>Saídas</small><b class="neg">${money(T.exp)}</b></div>
        <div><small>Saldo</small><b class="${T.bal >= 0 ? '' : 'neg'}">${money(T.bal)}</b></div>
      </div>
      ${this.q ? `<p class="muted" style="font-size:13px;margin:8px 4px">${list.length} resultado(s) para "${esc(this.q)}" em todos os meses</p>` : ''}`;

    if (!list.length) {
      html += `<div class="card mt">${empty('search', this.q || this.filter !== 'all' || this.cat !== 'all' ? 'Nada encontrado' : 'Nenhuma transação neste mês',
        'Toque no + para adicionar', `<button class="btn primary" data-action="new-tx">${icon('plus')} Nova transação</button>`)}</div>`;
    } else if (this.sort === 'amount') {
      html += `<div class="card flush mt"><div class="list">${[...list].sort((a, b) => b.amount - a.amount).map(t => txItemHTML(t, { showDate: true })).join('')}</div></div>`;
    } else {
      const groups = {};
      [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(t => (groups[t.date] ||= []).push(t));
      html += `<div class="card flush mt" style="padding-bottom:10px">${Object.entries(groups).map(([d, items]) => {
        const bal = sum(items, t => (t.type === 'income' ? 1 : -1) * t.amount);
        return `<div class="list-group-title" style="padding-left:14px;padding-right:14px"><span>${relDay(d)}${/\d/.test(relDay(d)) ? "" : " · " + fmtDateShort(d)}</span><span class="${bal >= 0 ? 'pos' : ''}">${money(bal)}</span></div>
          <div class="list">${items.map(t => txItemHTML(t)).join('')}</div>`;
      }).join('')}</div>`;
    }
    $('#tx-body', el).innerHTML = html;
  }
};
