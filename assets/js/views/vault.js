/* ═══════════ COFRE DE SENHAS ═══════════ */

const Vault = {
  subscribed: false, shown: new Set(),
  isOpen() { return LS.get('fin_vault_until', 0) > Date.now(); },
  touch() { if (this.isOpen()) LS.set('fin_vault_until', Date.now() + Math.max(1, Settings.get('lockMinutes')) * 60000); },
  async unlock(pass) {
    let ok = Auth.checkPass(pass);
    // compatibilidade: senha antiga do cofre guardada no nó "Senha"
    if (!ok && Store.db && Auth.current().id === 'main') { try { ok = pass === String(await Store.get('/Senha')); } catch {} }
    if (!ok) return false;
    LS.set('fin_vault_until', Date.now() + Math.max(1, Settings.get('lockMinutes')) * 60000);
    this.subscribe();
    return true;
  },
  lock() { LS.del('fin_vault_until'); this.shown.clear(); DB.vault = []; Bus.emit('data', 'vault'); },
  subscribe() {
    if (this.subscribed) return; this.subscribed = true;
    Store.on('AcessosESenhas', val => {
      DB.vault = val ? Object.entries(val).map(([k, v]) => ({ ...v, _key: k })) : [];
      Bus.emit('data', 'vault');
    }, { cache: false });
  }
};

Views.vault = {
  q: '',
  render(el) {
    if (!Vault.isOpen()) {
      el.innerHTML = `
        <form class="card vault-lock" id="vl-form">
          <div class="lock-ic">${icon('lock')}</div>
          <h3 style="font-size:18px">Cofre de senhas bloqueado</h3>
          <p class="muted" style="font-size:14px;margin:4px 0 18px">Digite sua senha para ver seus acessos.</p>
          <div class="field input-group"><input type="password" id="vl-pass" placeholder="Senha" autocomplete="current-password" autofocus>
            <button type="button" class="icon-btn" data-toggle-pass="vl-pass">${icon('eye')}</button></div>
          <button class="btn primary block lg" type="submit">${icon('unlock')} Desbloquear</button>
          <p class="faint" style="font-size:12px;margin-top:12px">Bloqueia sozinho após ${Settings.get('lockMinutes')} min sem uso.</p>
        </form>`;
      const inp = $('#vl-pass', el);
      if (matchMedia('(pointer:fine)').matches) setTimeout(() => inp.focus(), 50);
      $('#vl-form', el).onsubmit = async e => {
        e.preventDefault();
        if (await Vault.unlock(inp.value)) { toast('Cofre desbloqueado'); this.render(el); }
        else { inp.value = ''; e.target.classList.remove('shake'); void e.target.offsetWidth; e.target.classList.add('shake'); toast('Senha incorreta', 'err'); }
      };
      return;
    }
    Vault.subscribe();
    const q = norm(this.q);
    const list = DB.vault.filter(a => !q || norm(a.sistema).includes(q) || norm(a.usuario).includes(q) || norm(a.url).includes(q))
      .sort((a, b) => String(a.sistema || '').localeCompare(String(b.sistema || ''), 'pt-BR'));

    el.innerHTML = `
      <div class="toolbar">
        <div class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="va-q" type="search" placeholder="Buscar acesso (${DB.vault.length})" value="${esc(this.q)}"></div>
        <button class="btn primary" data-va="new">${icon('plus')} Novo</button>
        <button class="btn" data-va="lock" title="Bloquear agora">${icon('lock')}</button>
      </div>
      <div class="card flush">
        ${list.length ? `<div class="list">${list.map(a => {
          const show = Vault.shown.has(a._key), letter = (a.sistema || '?').trim().charAt(0).toUpperCase();
          return `<div class="item" style="cursor:default;flex-wrap:wrap" data-vk="${a._key}">
            <div class="avatar letter" style="background:${colorFor(a.sistema)}">${esc(letter)}</div>
            <div class="item-body">
              <div class="item-title">${esc(a.sistema)}</div>
              <div class="item-sub"><span style="overflow:hidden;text-overflow:ellipsis">${esc(a.usuario)}</span></div>
              <div class="secret" style="margin-top:4px">${show ? esc(a.senha) : '••••••••••'}</div>
            </div>
            <div class="tx-actions">
              <button class="icon-btn sm" data-va="cu" title="Copiar usuário">${icon('user', 'i-sm')}</button>
              <button class="icon-btn sm" data-va="cp" title="Copiar senha">${icon('copy', 'i-sm')}</button>
              <button class="icon-btn sm" data-va="show" title="${show ? 'Ocultar' : 'Mostrar'}">${icon(show ? 'eye-off' : 'eye', 'i-sm')}</button>
              ${a.url ? `<a class="icon-btn sm" href="${esc(/^https?:/i.test(a.url) ? a.url : 'https://' + a.url)}" target="_blank" rel="noopener" title="Abrir site">${icon('external', 'i-sm')}</a>` : ''}
              <button class="icon-btn sm" data-va="edit" title="Editar">${icon('edit', 'i-sm')}</button>
            </div>
          </div>`;
        }).join('')}</div>` : empty('lock', this.q ? 'Nada encontrado' : 'Nenhum acesso salvo', 'Guarde logins de sites, apps, Wi-Fi…')}
      </div>
      <p class="faint" style="font-size:12px;margin:12px 4px">O cofre bloqueia automaticamente após ${Settings.get('lockMinutes')} min sem uso. Ajuste em Ajustes › Segurança.</p>`;

    $('#va-q', el).addEventListener('input', debounce(e => { this.q = e.target.value; this.render(el); const s = $('#va-q', el); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200));
    el.onclick = e => {
      const b = e.target.closest('[data-va]'); if (!b) return;
      Vault.touch();
      const a = DB.vault.find(x => x._key === b.closest('[data-vk]')?.dataset.vk);
      switch (b.dataset.va) {
        case 'new': return this.form();
        case 'lock': Vault.lock(); toast('Cofre bloqueado', 'info'); return this.render(el);
        case 'cu': return copyText(a.usuario, 'Usuário copiado');
        case 'cp': return copyText(a.senha, 'Senha copiada');
        case 'show': Vault.shown.has(a._key) ? Vault.shown.delete(a._key) : Vault.shown.add(a._key); return this.render(el);
        case 'edit': return this.form(a);
      }
    };
  },

  form(a = null) {
    Sheet.open({
      title: a ? 'Editar acesso' : 'Novo acesso',
      body: `
        <div class="field"><label for="vf-s">Sistema / site</label><input id="vf-s" value="${esc(a?.sistema || '')}" placeholder="Ex.: Banco, Netflix, Wi-Fi de casa" autofocus></div>
        <div class="field"><label for="vf-url">Endereço (opcional)</label><input id="vf-url" value="${esc(a?.url || '')}" placeholder="exemplo.com.br" inputmode="url"></div>
        <div class="field"><label for="vf-u">Usuário / e-mail</label><input id="vf-u" value="${esc(a?.usuario || '')}" autocomplete="off"></div>
        <div class="field"><label for="vf-p">Senha</label>
          <div class="input-group"><input id="vf-p" type="text" value="${esc(a?.senha || '')}" autocomplete="off" class="secret">
            <button type="button" class="icon-btn" id="vf-gen" title="Gerar senha forte">${icon('dice')}</button></div>
          <div class="strength" id="vf-str"><i></i><i></i><i></i><i></i></div>
          <span class="hint" id="vf-str-l"></span>
        </div>
        <div class="field"><label for="vf-o">Observação</label><textarea id="vf-o" rows="2" style="min-height:60px" placeholder="PIN, perguntas de segurança, etc.">${esc(a?.obs || '')}</textarea></div>`,
      foot: `${a ? `<button class="btn soft-danger" data-vf="del" style="flex:0 0 auto">${icon('trash')}</button>` : ''}<button class="btn primary" data-vf="save">Salvar</button>`,
      onMount: el => {
        const p = $('#vf-p', el);
        const str = () => {
          const s = passwordStrength(p.value), colors = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--success)'];
          $$('#vf-str i', el).forEach((i, n) => i.style.background = n < s ? colors[s] : '');
          $('#vf-str-l', el).textContent = p.value ? ['', 'Fraca', 'Razoável', 'Boa', 'Forte'][s] : '';
        };
        str(); p.addEventListener('input', str);
        $('#vf-gen', el).onclick = () => { p.value = genPassword(16); str(); };
        el.querySelector('.sheet-foot').onclick = async e => {
          const act = e.target.closest('[data-vf]')?.dataset.vf; if (!act) return;
          if (act === 'del') {
            if (!(await confirmDialog(`Excluir o acesso "${a.sistema}"?`, { ok: 'Excluir', danger: true }))) return;
            await Store.remove(`AcessosESenhas/${a._key}`); Sheet.close(); return toast('Acesso excluído', 'info');
          }
          const d = { sistema: $('#vf-s', el).value.trim(), usuario: $('#vf-u', el).value.trim(), senha: p.value, url: $('#vf-url', el).value.trim() || null, obs: $('#vf-o', el).value.trim() || null, data: new Date().toISOString() };
          if (!d.sistema || !d.senha) return toast('Preencha ao menos o sistema e a senha', 'err');
          a ? await Store.update(`AcessosESenhas/${a._key}`, d) : Store.push('AcessosESenhas', clean(d));
          Sheet.close(); toast('Acesso salvo');
        };
      }
    });
  }
};
