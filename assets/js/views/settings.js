/* ═══════════ AJUSTES · IMPORTAÇÃO · BACKUP ═══════════ */

/* ── Importação de extrato bancário (OFX ou CSV) ── */
const Importer = {
  async read(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }
  },
  parseOFX(text) {
    return text.split(/<STMTTRN>/i).slice(1).map(b => {
      const g = tag => (b.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || '';
      const amt = parseFloat(g('TRNAMT').replace(',', '.')), dt = g('DTPOSTED');
      const description = (g('MEMO') || g('NAME') || 'Lançamento').replace(/\s+/g, ' ');
      return { importId: 'ofx-' + (g('FITID') || dt + amt + description), date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
        amount: Math.abs(amt), type: amt < 0 ? 'expense' : 'income', description };
    }).filter(t => t.amount > 0 && /^\d{4}-\d\d-\d\d$/.test(t.date));
  },
  parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
    const head = split(lines[0]).map(norm);
    const find = re => head.findIndex(h => re.test(h));
    const iD = find(/^(data|date)/), iV = find(/valor|amount|value|quantia/), iT = find(/descri|title|titulo|historico|memo|estabelec|lancamento/);
    if (iD < 0 || iV < 0) throw new Error('Não encontrei as colunas de data e valor no CSV');
    const cardStyle = head.includes('title'); // fatura Nubank: valores positivos = gastos
    return lines.slice(1).map(l => {
      const c = split(l), raw = c[iD] || '';
      const date = /^\d{4}-\d\d-\d\d/.test(raw) ? raw.slice(0, 10) : raw.replace(/^(\d\d)\/(\d\d)\/(\d{4}).*/, '$3-$2-$1');
      let v = c[iV] || '';
      v = delim === ',' && /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : parseMoney(v);
      const description = (c[iT] || 'Lançamento').replace(/\s+/g, ' ');
      const type = cardStyle ? (v >= 0 ? 'expense' : 'income') : (v < 0 ? 'expense' : 'income');
      return { importId: 'csv-' + date + '|' + v + '|' + norm(description), date, amount: Math.abs(v), type, description };
    }).filter(t => t.amount > 0 && /^\d{4}-\d\d-\d\d$/.test(t.date));
  },
  async start() {
    const file = await pickFile('.ofx,.csv,.txt,application/x-ofx,text/csv'); if (!file) return;
    let items;
    try {
      const text = await this.read(file);
      items = /<OFX>|<STMTTRN>/i.test(text) ? this.parseOFX(text) : this.parseCSV(text);
    } catch (e) { return toast(e.message || 'Arquivo inválido', 'err'); }
    if (!items.length) return toast('Nenhum lançamento encontrado no arquivo', 'err');
    const ids = new Set(DB.tx.map(t => t.importId).filter(Boolean));
    const sig = new Set(DB.tx.map(t => `${t.date}|${(+t.amount).toFixed(2)}|${t.type}`));
    items.forEach(t => { t.dup = ids.has(t.importId) || sig.has(`${t.date}|${t.amount.toFixed(2)}|${t.type}`); t.category = guessCategory(t.description, t.type) || 'outros'; });
    const fresh = items.filter(t => !t.dup);
    Sheet.open({
      title: 'Importar extrato',
      body: `
        <div class="alert info" style="margin-bottom:12px">${icon('info')}<span><b>${fresh.length}</b> novo(s) lançamento(s) · ${items.length - fresh.length} já existente(s) serão ignorados.</span></div>
        <p class="muted" style="font-size:13px;margin-bottom:8px">As categorias foram sugeridas automaticamente. Você pode ajustá-las depois no extrato. Todos entram como pagos/recebidos.</p>
        <div class="list">${items.slice(0, 80).map(t => { const c = cat(t.category); return `
          <div class="item" style="cursor:default;${t.dup ? 'opacity:.45' : ''}">
            ${catAvatar(c)}
            <div class="item-body"><div class="item-title">${esc(t.description)}</div><div class="item-sub">${fmtDate(t.date)} · ${esc(c.nome)}${t.dup ? ' · <b>duplicado</b>' : ''}</div></div>
            <span class="item-amount ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'} ${fmt(t.amount)}</span>
          </div>`; }).join('')}
          ${items.length > 80 ? `<p class="muted" style="text-align:center;padding:8px">… e mais ${items.length - 80}</p>` : ''}</div>`,
      foot: `<button class="btn primary" ${fresh.length ? '' : 'disabled'} data-imp>Importar ${fresh.length}</button>`,
      onMount: el => el.querySelector('[data-imp]').onclick = async () => {
        const upd = {};
        fresh.forEach(t => { upd[`transactions/${Store.newKey()}`] = { description: t.description, amount: Math.round(t.amount * 100) / 100, type: t.type, category: t.category, date: t.date, status: 'Pago', paidAt: t.date, importId: t.importId }; });
        await Store.multi(upd); Sheet.close(); toast(`${fresh.length} lançamento(s) importado(s)`);
      }
    });
  }
};

/* ── Backup completo ── */
const Backup = {
  obj: list => Object.fromEntries(list.map(x => [x._key, clean(x)])),
  export() {
    const data = {
      app: 'fin', version: 2, exportedAt: new Date().toISOString(),
      transactions: this.obj(DB.tx), Lembretes: this.obj(DB.notes), Metas: this.obj(DB.goals),
      config: { categories: DB.cats, budgets: DB.budgets }
    };
    if (Vault.isOpen() && DB.vault.length) data.AcessosESenhas = this.obj(DB.vault);
    downloadBlob(JSON.stringify(data, null, 1), `fin-backup-${today()}.json`, 'application/json');
    toast(Vault.isOpen() ? 'Backup completo salvo (inclui senhas — guarde em local seguro)' : 'Backup salvo (desbloqueie o cofre para incluir as senhas)', 'ok', { ms: 5000 });
  },
  async restore() {
    const file = await pickFile('.json,application/json'); if (!file) return;
    let data; try { data = JSON.parse(await file.text()); } catch { return toast('Arquivo de backup inválido', 'err'); }
    const paths = ['transactions', 'Lembretes', 'Metas', 'AcessosESenhas'].filter(p => data[p] && typeof data[p] === 'object');
    if (!paths.length && !data.config) return toast('Esse arquivo não parece um backup do Fin', 'err');
    const counts = paths.map(p => `${Object.keys(data[p]).length} em ${p}`).join(', ');
    if (!(await confirmDialog(`Restaurar ${counts}? Itens com o mesmo ID serão substituídos; os demais dados atuais são mantidos.`, { title: 'Restaurar backup', ok: 'Restaurar' }))) return;
    const upd = {};
    paths.forEach(p => Object.entries(data[p]).forEach(([k, v]) => { upd[`${p}/${k}`] = v; }));
    if (data.config?.categories) upd['config/categories'] = data.config.categories;
    if (data.config?.budgets) upd['config/budgets'] = data.config.budgets;
    await Store.multi(upd); toast('Backup restaurado');
  }
};

Views.settings = {
  render(el) {
    const theme = Settings.get('theme'), acc = Auth.current();
    const sync = Store.mode === 'local' ? ['off', 'Modo local (somente neste aparelho)'] : Store.connected ? ['on', 'Sincronizado com a nuvem'] : ['off', 'Offline — sincroniza ao reconectar'];
    const notif = !('Notification' in window) ? 'Não suportado neste navegador' : Notification.permission === 'granted' ? 'Ativadas' : Notification.permission === 'denied' ? 'Bloqueadas no navegador' : 'Desativadas';
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const row = (ic, title, sub, end) => `<div class="item"><div class="item-body"><div class="item-title" style="white-space:normal">${title}</div>${sub ? `<div class="item-sub">${sub}</div>` : ''}</div><div class="item-end">${end}</div></div>`;

    el.innerHTML = `
      <div class="grid-2" style="align-items:start">
      <div>
        <div class="section-title" style="margin-top:0">Conta</div>
        <div class="card flush settings-list">
          ${row('', `${esc(acc.nome)} <span class="pill gray">${acc.papel === 'admin' ? 'Administrador' : 'Membro'}</span>`, `<span class="sync-dot ${sync[0]}"></span> ${sync[1]}`, `<button class="btn sm" data-s="logout">${icon('logout', 'i-sm')} Sair</button>`)}
          ${row('', 'Alterar usuário e senha', 'Usada para entrar no app e abrir o cofre', `<button class="btn sm" data-s="pass">Alterar</button>`)}
          ${Auth.isAdmin() ? row('', 'Usuários', `${Object.keys(Auth.users()).length + 1} conta(s) com acesso ao Fin`, `<button class="btn sm" data-s="users">Gerenciar</button>`) : ''}
          ${row('', 'Bloqueio automático do cofre', 'Tempo sem uso até bloquear as senhas', `<select class="input" data-s="lock" style="width:auto;height:36px">${[1, 5, 15, 30, 60].map(m => `<option value="${m}" ${Settings.get('lockMinutes') === m ? 'selected' : ''}>${m} min</option>`).join('')}</select>`)}
        </div>

        <div class="section-title">Aparência</div>
        <div class="card flush settings-list">
          <div class="item" style="cursor:default"><div class="item-body"><div class="item-title">Tema</div></div>
            <div class="segmented" data-s="theme" style="min-width:220px">${[['system', 'Auto'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<button data-v="${v}" class="${theme === v ? 'active' : ''}">${l}</button>`).join('')}</div></div>
          ${row('', 'Ocultar valores ao abrir', 'Bom para usar em público. Toque no olho para mostrar.', `<label class="switch"><input type="checkbox" data-s="hide" ${Settings.get('hideValues') ? 'checked' : ''}><i></i></label>`)}
          ${row('', 'Tela inicial', '', `<select class="input" data-s="start" style="width:auto;height:36px">${App.VIEWS.filter(v => v.id !== 'settings').map(v => `<option value="${v.id}" ${Settings.get('startView') === v.id ? 'selected' : ''}>${v.title}</option>`).join('')}</select>`)}
        </div>

        <div class="section-title">Finanças</div>
        <div class="card flush settings-list">
          ${row('', 'Dia do pagamento', 'Qual dia útil do mês você recebe', `<select class="input" data-s="payday" style="width:auto;height:36px">${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<option value="${n}" ${Settings.get('payday') === n ? 'selected' : ''}>${n}º dia útil</option>`).join('')}</select>`)}
          ${row('', 'Sábado conta como dia útil', 'Algumas empresas consideram (CLT)', `<label class="switch"><input type="checkbox" data-s="sat" ${Settings.get('saturdayBusiness') ? 'checked' : ''}><i></i></label>`)}
          ${row('', 'Categorias', `${Object.keys(DB.cats).length} categorias`, `<button class="btn sm" data-s="cats">Gerenciar</button>`)}
        </div>
      </div>
      <div>
        <div class="section-title" style="margin-top:0">Dados</div>
        <div class="card flush settings-list">
          ${row('', 'Importar extrato do banco', 'Arquivo OFX ou CSV (Nubank, Itaú, Inter, BB…)', `<button class="btn sm primary" data-s="import">${icon('upload', 'i-sm')} Importar</button>`)}
          ${row('', 'Exportar todos os lançamentos', `${DB.tx.length} transações · PDF, Excel ou CSV`, `<button class="btn sm" data-s="export">${icon('download', 'i-sm')} Exportar</button>`)}
          ${row('', 'Backup completo', 'Baixa um arquivo .json com tudo', `<button class="btn sm" data-s="backup">Baixar</button>`)}
          ${row('', 'Restaurar backup', 'A partir de um arquivo .json', `<button class="btn sm" data-s="restore">Restaurar</button>`)}
        </div>

        <div class="section-title">Aplicativo</div>
        <div class="card flush settings-list">
          ${row('', 'Instalar no celular / computador', standalone ? 'Já instalado' : ios ? 'No Safari: Compartilhar › Adicionar à Tela de Início' : App.installEvt ? 'Abre como app, com ícone e em tela cheia' : 'Use o menu do navegador › Instalar app',
              standalone || ios || !App.installEvt ? '' : `<button class="btn sm primary" data-s="install">Instalar</button>`)}
          ${row('', 'Notificações', `${notif} · avisos de contas, lembretes e investimentos`, window.Notification?.permission === 'granted' ? `<button class="btn sm" data-s="test-notif">Testar</button>` : `<button class="btn sm" data-s="notif">Ativar</button>`)}
          ${row('', 'Alertas de investimentos', 'Ações, radar diário, rendimento e Selic · com som', `<button class="btn sm" data-s="alerts">Ajustar</button>`)}
          ${row('', 'Atalhos de teclado', '<span class="kbd">N</span> nova transação · <span class="kbd">/</span> buscar · <span class="kbd">H</span> ocultar valores · <span class="kbd">←</span><span class="kbd">→</span> mês', '')}
        </div>

        <div class="section-title" style="color:var(--danger)">Zona de perigo</div>
        <div class="card flush settings-list">
          ${row('', 'Apagar todas as transações', 'Não pode ser desfeito. Faça um backup antes.', `<button class="btn sm soft-danger" data-s="wipe">Apagar</button>`)}
        </div>
        <p class="faint" style="font-size:12px;text-align:center;margin-top:18px">Fin 2.0 · seus dados ficam no seu Firebase</p>
      </div>
      </div>`;

    el.onclick = async e => {
      const b = e.target.closest('[data-s]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      const a = b.dataset.s;
      if (a === 'theme') { const v = e.target.closest('[data-v]')?.dataset.v; if (v) { Settings.set('theme', v); App.applyTheme(); this.render(el); } }
      if (a === 'logout') App.logout();
      if (a === 'pass') this.passForm();
      if (a === 'users') this.usersSheet();
      if (a === 'cats') this.catsSheet();
      if (a === 'import') Importer.start();
      if (a === 'export') Exporter.menu(DB.tx, 'todos os lançamentos');
      if (a === 'backup') Backup.export();
      if (a === 'restore') Backup.restore();
      if (a === 'install') { App.installEvt?.prompt(); App.installEvt = null; }
      if (a === 'notif') App.enableNotifications().then(() => this.render(el));
      if (a === 'test-notif') App.notify('Fin', 'Notificações funcionando corretamente.');
      if (a === 'alerts') Views.invest.alertsCfg();
      if (a === 'wipe') {
        if (!(await confirmDialog(`Apagar TODAS as ${DB.tx.length} transações? Esta ação não pode ser desfeita.`, { title: 'Apagar tudo', ok: 'Continuar', danger: true }))) return;
        if (!(await confirmDialog('Tem certeza absoluta? Recomendo baixar um backup antes.', { title: 'Última confirmação', ok: 'Apagar tudo', danger: true }))) return;
        await Store.remove('transactions'); toast('Transações apagadas', 'info');
      }
    };
    el.onchange = e => {
      const s = e.target.dataset.s;
      if (s === 'lock') Settings.set('lockMinutes', +e.target.value);
      if (s === 'hide') Settings.set('hideValues', e.target.checked);
      if (s === 'start') Settings.set('startView', e.target.value);
      if (s === 'payday') Settings.set('payday', +e.target.value);
      if (s === 'sat') { Settings.set('saturdayBusiness', e.target.checked); for (const k in _holCache) delete _holCache[k]; }
      toast('Preferência salva');
    };
  },

  /* ── Usuários (somente administradores) ── */
  usersSheet() {
    const main = Auth.main(), users = Object.entries(Auth.users()).sort((a, b) => (a[1].nome || '').localeCompare(b[1].nome || '', 'pt-BR'));
    const line = (id, u, isMain) => `
      <div class="item" ${isMain ? 'style="cursor:default"' : `data-uid="${id}"`}>
        <div class="avatar letter">${esc((u.nome || u.user || '?').charAt(0).toUpperCase())}</div>
        <div class="item-body"><div class="item-title">${esc(u.nome || cap(u.user.toLowerCase()))}${u.bloqueado ? ' <span class="pill atrasado">Bloqueado</span>' : ''}</div>
          <div class="item-sub">${esc(u.user)} · ${(u.papel || 'membro') === 'admin' ? 'Administrador' : 'Membro'} · ${isMain ? 'conta principal' : (u.dados || 'own') === 'own' ? 'dados próprios' : 'dados compartilhados'}</div></div>
        ${isMain ? '' : icon('chev-r', 'faint')}
      </div>`;
    Sheet.open({
      title: 'Usuários',
      body: `
        <p class="muted" style="font-size:13px;margin-bottom:12px">Cada pessoa entra com o próprio usuário e senha. Escolha se ela terá <b>dados próprios</b> (finanças separadas) ou se vai <b>compartilhar</b> os dados da conta principal.</p>
        <div class="card flush"><div class="list">${line('main', main, true)}${users.map(([id, u]) => line(id, u, false)).join('')}</div></div>`,
      foot: `<button class="btn primary" data-unew>${icon('plus')} Novo usuário</button>`,
      onMount: el => {
        el.querySelector('.list').onclick = e => { const it = e.target.closest('[data-uid]'); if (it) this.userForm(it.dataset.uid); };
        el.querySelector('[data-unew]').onclick = () => this.userForm(null);
      }
    });
  },

  userForm(id) {
    const u = id ? Auth.users()[id] : null;
    let dados = u?.dados || 'own';
    Sheet.open({
      title: u ? 'Editar usuário' : 'Novo usuário',
      body: `
        <div class="field"><label for="uf-n">Nome</label><input id="uf-n" value="${esc(u?.nome || '')}" placeholder="Ex.: Maria" autofocus></div>
        <div class="fields-2">
          <div class="field"><label for="uf-u">Usuário (login)</label><input id="uf-u" value="${esc(u?.user || '')}" autocapitalize="characters" autocomplete="off"></div>
          <div class="field"><label for="uf-p">${u ? 'Nova senha (opcional)' : 'Senha'}</label><input id="uf-p" type="password" autocomplete="new-password" placeholder="${u ? 'manter a atual' : 'mín. 6 caracteres'}"></div>
        </div>
        <div class="field"><label>Dados</label>
          <div class="segmented" id="uf-d">
            <button type="button" data-v="own" class="${dados === 'own' ? 'active' : ''}">Dados próprios</button>
            <button type="button" data-v="shared" class="${dados === 'shared' ? 'active' : ''}">Compartilhar os meus</button>
          </div>
          <span class="hint" id="uf-d-h"></span>
        </div>
        <div class="field"><label for="uf-r">Permissão</label>
          <select id="uf-r"><option value="membro" ${(u?.papel || 'membro') === 'membro' ? 'selected' : ''}>Membro — usa o app</option><option value="admin" ${u?.papel === 'admin' ? 'selected' : ''}>Administrador — também gerencia usuários</option></select>
        </div>
        ${u ? `<label class="switch"><input type="checkbox" id="uf-b" ${u.bloqueado ? 'checked' : ''}><i></i>Bloquear acesso</label>` : ''}`,
      foot: `${u ? `<button class="btn soft-danger" data-uf="del" style="flex:0 0 auto">${icon('trash')}</button>` : ''}<button class="btn" data-uf="back">Voltar</button><button class="btn primary" data-uf="save">Salvar</button>`,
      onMount: el => {
        const hint = () => { $('#uf-d-h', el).textContent = dados === 'own' ? 'Começa com o app vazio; ninguém mais vê as finanças desta pessoa (exceto pelo banco de dados).' : 'Vê e altera as mesmas transações, metas, lembretes e senhas da conta principal.'; };
        hint();
        $('#uf-d', el).onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; dados = b.dataset.v; $$('#uf-d button', el).forEach(x => x.classList.toggle('active', x === b)); hint(); };
        el.querySelector('.sheet-foot').onclick = async e => {
          const a = e.target.closest('[data-uf]')?.dataset.uf; if (!a) return;
          if (a === 'back') return this.usersSheet();
          if (a === 'del') {
            if (!(await confirmDialog(`Remover o acesso de "${u.nome || u.user}"? ${u.dados === 'own' ? 'Os dados dessa pessoa ficam guardados no banco e voltam se ela for recriada com o mesmo cadastro.' : ''}`, { title: 'Remover usuário', ok: 'Remover', danger: true }))) return;
            await Auth.removeUser(id); toast('Usuário removido', 'info'); return this.usersSheet();
          }
          const nome = $('#uf-n', el).value.trim(), user = $('#uf-u', el).value.trim(), pass = $('#uf-p', el).value;
          if (!nome || !user) return toast('Preencha nome e usuário', 'err');
          if (!/^[A-Za-z0-9._-]{3,}$/.test(user)) return toast('Usuário: ao menos 3 caracteres, sem espaços', 'err');
          if (Auth.userTaken(user, id)) return toast('Esse usuário já existe', 'err');
          if (!u && pass.length < 6) return toast('A senha precisa ter ao menos 6 caracteres', 'err');
          if (u && pass && pass.length < 6) return toast('A senha precisa ter ao menos 6 caracteres', 'err');
          const data = { nome, user, papel: $('#uf-r', el).value, dados, bloqueado: $('#uf-b', el)?.checked || null };
          if (pass) data.hash = sha256(pass);
          await Auth.saveUser(id, data);
          toast(u ? 'Usuário atualizado' : `Usuário ${user.toUpperCase()} criado`);
          this.usersSheet();
        };
      }
    });
  },

  passForm() {
    Sheet.open({
      title: 'Alterar usuário e senha',
      body: `
        <div class="field"><label>Senha atual</label><input type="password" id="pf-cur" autocomplete="current-password" autofocus></div>
        <div class="field"><label>Usuário</label><input id="pf-user" value="${esc(Auth.current().user)}" autocapitalize="characters"></div>
        <div class="field"><label>Nova senha</label><input type="password" id="pf-new" autocomplete="new-password"></div>
        <div class="field"><label>Repita a nova senha</label><input type="password" id="pf-new2" autocomplete="new-password"></div>
        <p class="muted" style="font-size:13px">A senha nunca é salva em texto: guardamos apenas uma “impressão digital” (hash SHA-256). Vale para todos os seus aparelhos.</p>`,
      foot: `<button class="btn primary" data-pf>Salvar</button>`,
      onMount: el => el.querySelector('[data-pf]').onclick = async () => {
        const cur = $('#pf-cur', el).value, user = $('#pf-user', el).value.trim(), p1 = $('#pf-new', el).value, p2 = $('#pf-new2', el).value;
        if (!Auth.checkPass(cur)) return toast('Senha atual incorreta', 'err');
        if (!user) return toast('Informe o usuário', 'err');
        if (p1.length < 6) return toast('A nova senha precisa ter ao menos 6 caracteres', 'err');
        if (p1 !== p2) return toast('As senhas não conferem', 'err');
        await Auth.change(user, p1); Sheet.close(); toast('Usuário e senha alterados');
      }
    });
  },

  catsSheet() {
    const render = () => catList().map(c => `
      <div class="item" data-ck="${esc(c.id)}">
        ${catAvatar(c)}
        <div class="item-body"><div class="item-title">${esc(c.nome)}</div><div class="item-sub">${c.tipo === 'income' ? 'Receita' : c.tipo === 'both' ? 'Receita e despesa' : 'Despesa'}${DB.cats[c.id] ? '' : ' · <i>não cadastrada</i>'}</div></div>
        ${icon('chev-r', 'faint')}
      </div>`).join('');
    Sheet.open({
      title: 'Categorias', body: `<div class="list" id="ck-list">${render()}</div>`,
      foot: `<button class="btn primary" data-ck-new>${icon('plus')} Nova categoria</button>`,
      onMount: el => {
        $('#ck-list', el).onclick = e => { const it = e.target.closest('[data-ck]'); if (it) this.catForm(cat(it.dataset.ck)); };
        el.querySelector('[data-ck-new]').onclick = () => this.catForm(null);
      }
    });
  },

  catForm(c) {
    let cor = c?.cor || PALETTE[0], tipo = c?.tipo || 'expense';
    const exists = c && DB.cats[c.id];
    Sheet.open({
      title: c ? 'Editar categoria' : 'Nova categoria',
      body: `
        <div>
          <div class="field"><label>Nome</label><input id="cf-n" value="${esc(c?.nome || '')}" placeholder="Ex.: Pets" autofocus></div>
        </div>
        <div class="field"><label>Usada em</label><div class="segmented" id="cf-t">${[['expense', 'Despesas'], ['income', 'Receitas'], ['both', 'Ambos']].map(([v, l]) => `<button type="button" data-v="${v}" class="${tipo === v ? 'active' : ''}">${l}</button>`).join('')}</div></div>
        <div class="field"><label>Cor</label><div class="color-pick" id="cf-c">${PALETTE.map(x => `<button type="button" style="--c:${x}" class="${x === cor ? 'active' : ''}" data-c="${x}"></button>`).join('')}</div></div>`,
      foot: `${exists ? `<button class="btn soft-danger" data-cf="del" style="flex:0 0 auto">${icon('trash')}</button>` : ''}<button class="btn primary" data-cf="save">Salvar</button>`,
      onMount: el => {
        $('#cf-t', el).onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; tipo = b.dataset.v; $$('#cf-t button', el).forEach(x => x.classList.toggle('active', x === b)); };
        $('#cf-c', el).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cor = b.dataset.c; $$('#cf-c button', el).forEach(x => x.classList.toggle('active', x === b)); };
        el.querySelector('.sheet-foot').onclick = async e => {
          const a = e.target.closest('[data-cf]')?.dataset.cf; if (!a) return;
          if (a === 'del') {
            const used = DB.tx.filter(t => t.category === c.id).length;
            if (!(await confirmDialog(`Remover "${c.nome}"?${used ? ` ${used} transação(ões) continuarão com essa categoria.` : ''}`, { ok: 'Remover', danger: true }))) return;
            delete DB.cats[c.id]; await saveCategories(); toast('Categoria removida', 'info'); return this.catsSheet();
          }
          const nome = $('#cf-n', el).value.trim(); if (!nome) return toast('Informe o nome', 'err');
          const id = c?.id || norm(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat-' + Date.now();
          if (!c && DB.cats[id]) return toast('Já existe uma categoria com esse nome', 'err');
          DB.cats[id] = { nome, cor, tipo };
          await saveCategories(); toast('Categoria salva'); this.catsSheet();
        };
      }
    });
  }
};
