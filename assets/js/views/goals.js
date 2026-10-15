/* ═══════════ METAS / OBJETIVOS ═══════════ */


function goalPlan(g) {
  const falta = Math.max(0, g.alvo - (g.guardado || 0));
  if (!g.prazo || falta <= 0) return { falta, meses: null, porMes: null };
  const meses = Math.max(1, (+g.prazo.slice(0, 4) - +today().slice(0, 4)) * 12 + (+g.prazo.slice(5, 7) - +today().slice(5, 7)));
  return { falta, meses, porMes: falta / meses, vencida: g.prazo < today() };
}

Views.goals = {
  render(el) {
    const goals = [...DB.goals].sort((a, b) => ((a.guardado || 0) >= a.alvo) - ((b.guardado || 0) >= b.alvo) || (a.prazo || '9').localeCompare(b.prazo || '9'));
    const tot = sum(goals, g => g.guardado || 0), alvo = sum(goals, g => g.alvo);
    el.innerHTML = `
      <div class="toolbar">
        <div style="flex:1"><div class="muted" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Total guardado</div><div class="num" style="font-size:22px;font-weight:600">${money(tot)} <span class="faint" style="font-size:15px;font-weight:500">de ${money(alvo)}</span></div></div>
        <button class="btn primary" data-g="new">${icon('plus')} Nova meta</button>
      </div>
      ${goals.length ? `<div class="grid-3">${goals.map(g => {
        const p = clamp((g.guardado || 0) / g.alvo, 0, 1), plan = goalPlan(g), done = p >= 1, cor = g.cor || '#6366f1';
        return `<div class="card goal">
          <div class="goal-top">
            <div class="avatar" style="color:${cor}">${icon('target')}</div>
            <div style="flex:1;min-width:0"><b style="font-size:15.5px">${esc(g.nome)}</b>
              <div class="muted" style="font-size:12.5px">${g.prazo ? `até ${fmtDate(g.prazo)}` : 'sem prazo'}</div></div>
            <button class="icon-btn sm" data-g="edit" data-k="${g._key}" title="Editar">${icon('edit')}</button>
          </div>
          <div>
            <div class="prog-row"><b class="num" style="font-size:18px">${money(g.guardado || 0)}</b><span class="muted">${Math.round(p * 100)}%</span></div>
            <div class="progress lg"><i style="width:${p * 100}%;background:${done ? 'var(--success)' : cor}"></i></div>
          </div>
          <div class="goal-meta">
            <span>Meta: ${money(g.alvo)}</span>
            ${done ? '<span class="pos">Concluída</span>' : plan.porMes ? `<span class="${plan.vencida ? 'neg' : ''}">${plan.vencida ? 'Prazo vencido' : `Guarde ${fmt(plan.porMes)}/mês`}</span>` : `<span>Faltam ${fmt(plan.falta)}</span>`}
          </div>
          <div class="row">
            <button class="btn sm success" style="flex:1" data-g="dep" data-k="${g._key}">${icon('plus', 'i-sm')} Guardar</button>
            <button class="btn sm" style="flex:1" data-g="wd" data-k="${g._key}">${icon('minus', 'i-sm')} Retirar</button>
          </div>
        </div>`;
      }).join('')}</div>`
      : `<div class="card">${empty('target', 'Nenhuma meta ainda', 'Reserva de emergência, viagem, carro novo… defina um valor e um prazo e o Fin calcula quanto guardar por mês.',
          `<button class="btn primary" data-g="new">${icon('plus')} Criar primeira meta</button>`)}</div>`}`;

    el.onclick = e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const g = DB.goals.find(x => x._key === b.dataset.k);
      ({ new: () => this.form(), edit: () => this.form(g), dep: () => this.move(g, 1), wd: () => this.move(g, -1) })[b.dataset.g]?.();
    };
  },

  form(g = null) {
    let cor = g?.cor || PALETTE[0];
    Sheet.open({
      title: g ? 'Editar meta' : 'Nova meta',
      body: `
        <div class="field"><label for="gf-nome">Nome</label><input id="gf-nome" placeholder="Ex.: Reserva de emergência" value="${esc(g?.nome || '')}" autofocus></div>
        <div class="fields-2">
          <div class="field"><label for="gf-alvo">Valor da meta</label><input id="gf-alvo" inputmode="decimal" placeholder="0,00" value="${g ? fmtNum(g.alvo) : ''}"></div>
          <div class="field"><label for="gf-guard">Já guardado</label><input id="gf-guard" inputmode="decimal" placeholder="0,00" value="${g ? fmtNum(g.guardado || 0) : ''}"></div>
        </div>
        <div class="field"><label for="gf-prazo">Prazo (opcional)</label><input type="date" id="gf-prazo" value="${g?.prazo || ''}"></div>
        <div class="field"><label>Cor</label><div class="color-pick" id="gf-cor">${PALETTE.map(c => `<button type="button" style="--c:${c}" class="${c === cor ? 'active' : ''}" data-c="${c}"></button>`).join('')}</div></div>
        <p class="hint muted" style="font-size:13px">Referência: reserva de emergência ideal = 6× seus gastos mensais (≈ ${money(totals(txOfMonth(ymAdd(curYM(), -1))).exp * 6)}).</p>`,
      foot: `${g ? `<button class="btn soft-danger" data-gf="del" style="flex:0 0 auto">${icon('trash')}</button>` : ''}<button class="btn primary" data-gf="save">Salvar</button>`,
      onMount: el => {
        $('#gf-cor', el).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cor = b.dataset.c; $$('#gf-cor button', el).forEach(x => x.classList.toggle('active', x === b)); };
        el.querySelector('.sheet-foot').onclick = async e => {
          const a = e.target.closest('[data-gf]')?.dataset.gf; if (!a) return;
          if (a === 'del') {
            if (!(await confirmDialog(`Excluir a meta "${g.nome}"?`, { ok: 'Excluir', danger: true }))) return;
            await Goals.remove(g._key); Sheet.close(); return toast('Meta excluída', 'info');
          }
          const nome = $('#gf-nome', el).value.trim(), alvo = parseMoney($('#gf-alvo', el).value), guardado = parseMoney($('#gf-guard', el).value) || 0;
          if (!nome) return toast('Dê um nome à meta', 'err');
          if (!(alvo > 0)) return toast('Informe o valor da meta', 'err');
          await Goals.save(g?._key, { nome, alvo, guardado, prazo: $('#gf-prazo', el).value || null, cor });
          Sheet.close(); toast('Meta salva');
        };
      }
    });
  },

  move(g, dir) {
    Sheet.open({
      title: `${dir > 0 ? 'Aportar em' : 'Resgatar de'}: ${esc(g.nome)}`,
      body: `
        <div class="amount-input ${dir > 0 ? 'income' : 'expense'}"><span>R$</span><input id="gm-v" inputmode="decimal" placeholder="0,00" autofocus></div>
        <p class="muted" style="text-align:center;font-size:13.5px">Saldo atual da meta: <b>${money(g.guardado || 0)}</b></p>
        <label class="switch mt"><input type="checkbox" id="gm-tx"><i></i>Registrar também no extrato (categoria Investimentos)</label>`,
      foot: `<button class="btn ${dir > 0 ? 'success' : 'primary'}" data-gm="ok">Confirmar</button>`,
      onMount: el => {
        const inp = $('#gm-v', el);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.querySelector('[data-gm]').click(); });
        el.querySelector('[data-gm]').onclick = async () => {
          const v = parseMoney(inp.value);
          if (!(v > 0)) return toast('Informe um valor', 'err');
          const novo = Math.max(0, Math.round(((g.guardado || 0) + dir * v) * 100) / 100);
          await Store.update(`Metas/${g._key}`, { guardado: novo });
          Store.push(`Metas/${g._key}/historico`, { data: today(), valor: dir * v });
          if ($('#gm-tx', el).checked) Tx.add({
            description: `${dir > 0 ? 'Aporte' : 'Resgate'} meta: ${g.nome}`, amount: v, type: dir > 0 ? 'expense' : 'income',
            category: 'investimentos', date: today(), status: 'Pago', paidAt: today()
          });
          Sheet.close();
          toast(novo >= g.alvo && dir > 0 ? 'Meta atingida' : (dir > 0 ? 'Aporte registrado' : 'Resgate registrado'));
        };
      }
    });
  }
};
