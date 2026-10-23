/* ═══════════════════════════════════════════════════════════
   DATA — estado em memória, regras de negócio e sincronização.
   Caminhos no Firebase (compatíveis com o sistema antigo):
     transactions/   Lembretes/   AcessosESenhas/
   Novos:
     Metas/   config/categories   config/budgets   config/auth
   ═══════════════════════════════════════════════════════════ */

const DB = {
  tx: [], notes: [], goals: [], vault: [], invest: [],
  budgets: {}, cats: {}, loaded: { tx: false },
  descIndex: new Map()
};

const DEFAULT_CATS = {
  salario:       { nome: 'Salário',        cor: '#15803d', tipo: 'income' },
  freela:        { nome: 'Renda extra',    cor: '#0f766e', tipo: 'income' },
  alimentacao:   { nome: 'Alimentação',    cor: '#c2410c' },
  moradia:       { nome: 'Moradia',        cor: '#1d4ed8' },
  contas:        { nome: 'Contas da casa', cor: '#a16207' },
  transporte:    { nome: 'Transporte',     cor: '#0369a1' },
  saude:         { nome: 'Saúde',          cor: '#b91c1c' },
  farmacia:      { nome: 'Farmácia',       cor: '#be185d' },
  educacao:      { nome: 'Educação',       cor: '#6d28d9' },
  lazer:         { nome: 'Lazer',          cor: '#7e22ce' },
  assinaturas:   { nome: 'Assinaturas',    cor: '#475569' },
  compras:       { nome: 'Compras',        cor: '#9d174d' },
  emprestimo:    { nome: 'Empréstimo',     cor: '#57534e' },
  investimentos: { nome: 'Investimentos',  cor: '#047857', tipo: 'both' },
  outros:        { nome: 'Outros',         cor: '#64748b', tipo: 'both' }
};
const CAT_ICONS = {
  salario: 'briefcase', freela: 'coins', alimentacao: 'cart', moradia: 'home', contas: 'bolt', transporte: 'car',
  saude: 'heart', farmacia: 'pill', educacao: 'book', lazer: 'ticket', assinaturas: 'tv', compras: 'bag',
  emprestimo: 'bank', investimentos: 'up', outros: 'box'
};
/** Ícone de linha da categoria, na cor da categoria */
const catIcon = c => `<span style="color:${c.cor};display:inline-flex">${icon(CAT_ICONS[c.id] || 'tag')}</span>`;
const catAvatar = c => `<div class="avatar">${catIcon(c)}</div>`;

/* ── Categorias ── */
function buildCategories(remote) {
  if (remote && Object.keys(remote).length) return remote;
  // Primeira execução: padrões + categorias criadas no sistema antigo (localStorage)
  const cats = JSON.parse(JSON.stringify(DEFAULT_CATS));
  (LS.get('user_categories', []) || []).forEach(id => {
    if (!cats[id]) cats[id] = { nome: cap(id.replace(/-/g, ' ')), cor: colorFor(id) };
  });
  return cats;
}
function cat(id) {
  const c = DB.cats[id] || DEFAULT_CATS[id];
  // categorias padrão sempre usam a paleta sóbria atual
  if (c) return { id, tipo: 'expense', ...c, ...(DEFAULT_CATS[id] ? { cor: DEFAULT_CATS[id].cor } : {}) };
  return { id, nome: cap(String(id || 'Sem categoria').replace(/-/g, ' ')), cor: colorFor(id), tipo: 'both' };
}
function catList(type) {
  const ids = new Set(Object.keys(DB.cats));
  // inclui categorias usadas em transações mas não cadastradas
  DB.tx.forEach(t => t.category && ids.add(t.category));
  return [...ids].map(cat)
    .filter(c => !type || c.tipo === 'both' || c.tipo === type || (!c.tipo && type === 'expense'))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
function saveCategories() { return Store.set('config/categories', DB.cats); }

/** Adivinha a categoria pela descrição (histórico primeiro, depois palavras-chave) */
const CAT_RULES = [
  ['salario', 'income', /sal[aá]rio|folha|pagamento de sal|vencimento|proventos/],
  ['freela', 'income', /pix recebido|transf.*recebida|ted recebida|freela|venda|reembolso|cashback/],
  ['alimentacao', null, /ifood|rappi|restaur|lanch|padaria|mercad|supermerc|atacad|assa[ií]|carrefour|p[aã]o de a[cç]|hortifruti|a[cç]ougue|pizza|burger|mc ?donald|bk |subway|cafe|caf[eé]/],
  ['transporte', null, /uber|99 ?(app|pop|taxi)|cabify|posto|combust|gasolina|etanol|shell|ipiranga|petrobras|estaciona|ped[aá]gio|sem parar|conectcar|metr[oô]|[oô]nibus|bilhete/],
  ['farmacia', null, /farm[aá]cia|drogaria|droga ?raia|pacheco|pague menos|drogasil|panvel/],
  ['saude', null, /hospital|cl[ií]nica|m[eé]dic|unimed|hapvida|amil|sulam[eé]rica|odonto|laborat|exame|dentista|psic/],
  ['assinaturas', null, /netflix|spotify|prime video|amazon prime|disney|youtube|hbo|max\b|globoplay|deezer|apple\.com|icloud|google (one|storage)|chatgpt|openai|claude/],
  ['contas', null, /energia|enel|cemig|light\b|copel|celpe|coelba|equatorial|neoenergia|[aá]gua|saneamento|sabesp|cedae|compesa|internet|vivo|claro|tim\b|oi\b|g[aá]s\b|net\b/],
  ['moradia', null, /aluguel|condom[ií]nio|iptu|imobili/],
  ['educacao', null, /escola|curso|faculdade|universidade|udemy|alura|livraria|mensalidade/],
  ['lazer', null, /cinema|ingresso|show|bar\b|cervej|steam|playstation|xbox|nintendo|viagem|hotel|airbnb|booking/],
  ['compras', null, /amazon|mercado ?livre|shopee|magalu|magazine|americanas|shein|aliexpress|renner|riachuelo|c&a|casas bahia/],
  ['emprestimo', null, /empr[eé]stimo|financiamento|consignado|parcela cr[eé]dito/],
  ['investimentos', null, /aplica[cç][aã]o|invest|cdb|tesouro|poupan[cç]a|corretora/]
];
function guessCategory(desc, type) {
  const hit = DB.descIndex.get(norm(desc));
  if (hit?.category && hit.type === type) return hit.category;
  const d = ' ' + norm(desc) + ' ';
  for (const [id, t, re] of CAT_RULES) if ((!t || t === type) && re.test(d)) return id;
  return null;
}

/* ── Transações ── */
function txStatus(t) {
  if (t.status === 'Pago') return 'Pago';
  // receitas antigas não tinham status: consideradas recebidas
  if (t.type === 'income' && !t.status) return 'Pago';
  return (t.date || '') < today() ? 'Atrasado' : 'Pendente';
}
const isPaid = t => txStatus(t) === 'Pago';
const statusLabel = (t, s = txStatus(t)) =>
  t.type === 'income' ? ({ Pago: 'Recebido', Pendente: 'A receber', Atrasado: 'Atrasado' })[s] : s;

function txOfMonth(ym, list = DB.tx) { return list.filter(t => (t.date || '').startsWith(ym)); }
function totals(list) {
  const inc = list.filter(t => t.type === 'income'), exp = list.filter(t => t.type === 'expense');
  return {
    inc: sum(inc, t => t.amount), exp: sum(exp, t => t.amount),
    incPaid: sum(inc.filter(isPaid), t => t.amount), expPaid: sum(exp.filter(isPaid), t => t.amount),
    get bal() { return this.inc - this.exp; },
    get balPaid() { return this.incPaid - this.expPaid; }
  };
}
function byCategory(list) {
  const m = {};
  list.filter(t => t.type === 'expense').forEach(t => { m[t.category || 'outros'] = (m[t.category || 'outros'] || 0) + Number(t.amount); });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
/** Saldo acumulado (tudo que já foi pago/recebido até hoje) */
function accumulatedBalance() {
  return sum(DB.tx.filter(isPaid), t => (t.type === 'income' ? 1 : -1) * t.amount);
}

const baseDesc = d => String(d || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();

const Tx = {
  add(data) { return Store.push('transactions', data); },
  update(key, data) { return Store.update(`transactions/${key}`, clean(data)); },
  /** Exclui um ou vários lançamentos (e os aportes vinculados), com opção de desfazer */
  async removeMany(list) {
    const upd = {}, undo = {};
    list.forEach(t => {
      upd[`transactions/${t._key}`] = null; undo[`transactions/${t._key}`] = clean(t);
      if (t.investId) {
        upd[`Investimentos/${t.investId}/movs/${t._key}`] = null;
        const m = DB.invest.find(i => i._key === t.investId)?.movs?.[t._key];
        if (m) undo[`Investimentos/${t.investId}/movs/${t._key}`] = m;
      }
    });
    await Store.multi(upd);
    toast(list.length > 1 ? `${list.length} lançamentos excluídos` : 'Transação excluída', 'info', { action: 'Desfazer', onAction: () => Store.multi(undo) });
  },
  remove(t) { return this.removeMany([t]); },
  /** Lançamentos da mesma série (parcelas "(n/N)" ou conta mensal recorrente), incluindo o próprio */
  series(t) {
    const b = norm(baseDesc(t.description)), m = String(t.description || '').match(/\((\d+)\/(\d+)\)\s*$/);
    if (m) {
      const re = new RegExp(`\\(\\d+\\/${m[2]}\\)\\s*$`);
      return DB.tx.filter(x => x.type === t.type && norm(baseDesc(x.description)) === b && re.test(x.description || ''));
    }
    if (t.isRecurring) return DB.tx.filter(x => x.isRecurring && x.type === t.type && norm(baseDesc(x.description)) === b);
    return [t];
  },
  togglePaid(t) {
    const paid = isPaid(t);
    Store.update(`transactions/${t._key}`, paid ? { status: 'Pendente', paidAt: null } : { status: 'Pago', paidAt: today() });
    toast(paid ? 'Marcado como pendente' : (t.type === 'income' ? 'Marcado como recebido' : 'Marcado como pago'), paid ? 'info' : 'ok');
  },
  /** Monta as parcelas "Descrição (1/10)" com datas mensais. Retorna { chave: dados } */
  installments(base, n) {
    const out = {};
    for (let i = 0; i < n; i++) {
      out[Store.newKey()] = clean({
        ...base, description: `${base.description} (${i + 1}/${n})`,
        date: addMonths(base.date, i), installmentInfo: `${i + 1}/${n}`, isRecurring: false,
        status: i === 0 ? base.status : undefined, paidAt: i === 0 ? base.paidAt : undefined
      });
    }
    return out;
  },
  seriesKey: t => t.type + '|' + norm(baseDesc(t.description)),
  stopRecurrence(t) {
    const k = Tx.seriesKey(t), updates = {};
    DB.tx.filter(x => x.isRecurring && Tx.seriesKey(x) === k).forEach(x => { updates[`transactions/${x._key}/isRecurring`] = false; });
    return Store.multi(updates);
  }
};

/* ── Investimentos ── */
const INVEST_TYPES = ['CDB / LCI / LCA', 'Tesouro Direto', 'Poupança', 'Conta remunerada / Caixinha', 'Ações', 'Fundos imobiliários', 'Fundos', 'Previdência', 'Criptomoedas', 'Outro'];
const Invest = {
  /** aplicado = aportes − resgates.
      saldo: com rentabilidade reconhecida (ex.: "110% do CDI"), cada movimento é corrigido
      automaticamente até hoje pelas taxas oficiais (Rentab/Rates). Se o usuário informou o saldo
      do banco, ele vira o ponto de partida e só o período seguinte é calculado.
      Sem regra reconhecida (ações, FIIs...): último saldo informado + movimentos posteriores. */
  stats(inv) {
    const movs = Object.entries(inv.movs || {}).map(([k, m]) => ({ ...m, _key: k }))
      .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.em || '').localeCompare(a.em || ''));
    const aplicado = sum(movs, m => m.valor);
    const hoje = today(), rule = Rentab.rule(inv);
    const anchor = inv.saldoAtual != null ? { valor: Number(inv.saldoAtual), data: (inv.saldoEm || '').slice(0, 10) || hoje } : null;
    const after = anchor ? movs.filter(m => (m.em || '') > (inv.saldoEm || '')) : movs;
    let saldo, auto = false;
    if (rule) {
      const chunks = (anchor ? [anchor] : []).concat(after.map(m => ({ valor: m.valor, data: [m.data || hoje, anchor?.data || ''].sort()[1] })));
      const first = chunks.map(c => c.data).sort()[0];
      if (first && first < hoje) Rates.need(first);
      saldo = sum(chunks, c => c.valor * Rentab.factor(rule, c.data, hoje));
      auto = true;
    } else saldo = anchor ? anchor.valor + sum(after, m => m.valor) : aplicado;
    saldo = Math.round(saldo * 100) / 100;
    const rend = saldo - aplicado;
    // IR estimado (tabela regressiva) pelo prazo médio ponderado dos aportes
    let ir = 0;
    if (auto && rend > 0 && Rentab.taxed(inv, rule)) {
      const deps = movs.filter(m => m.valor > 0 && m.data), tot = sum(deps, m => m.valor);
      const dias = tot ? sum(deps, m => m.valor * diffDays(m.data, hoje)) / tot : 0;
      ir = Math.round(rend * Rentab.irRate(dias) * 100) / 100;
    }
    return { movs, aplicado, saldo, rend, pct: aplicado > 0 ? rend / aplicado : 0, auto, rule, ir, liquido: saldo - ir, anual: auto ? Rentab.annualNow(rule) : null };
  },
  mov(t, key) { return { data: t.date, valor: (t.type === 'income' ? -1 : 1) * Number(t.amount), origem: 'extrato', tx: key, em: new Date().toISOString() }; },
  /** Investimento cujo nome bate com a descrição do lançamento */
  match(desc) { const d = norm(baseDesc(desc)); return DB.invest.find(i => norm(i.nome) === d) || null; },
  newNode(nome) { return { nome: baseDesc(nome) || 'Investimento', tipo: 'Outro', criado: today() }; },
  save(key, data) { return key ? Store.update(`Investimentos/${key}`, clean(data)) : Store.push('Investimentos', clean({ ...data, criado: today() })); },
  remove(inv) {
    const upd = { [`Investimentos/${inv._key}`]: null };
    // os lançamentos do extrato continuam existindo, apenas perdem o vínculo
    DB.tx.filter(t => t.investId === inv._key).forEach(t => { upd[`transactions/${t._key}/investId`] = null; });
    return Store.multi(upd);
  }
};

/** Contas fixas (recorrentes) do mês anterior que ainda não foram lançadas no mês atual.
    Nada é criado automaticamente: o painel mostra um aviso e o usuário decide. */
function pendingRecurrences(ym = curYM()) {
  const prev = ymAdd(ym, -1), series = {};
  DB.tx.filter(t => t.isRecurring && t.date && t.date.slice(0, 7) <= ym).forEach(t => {
    const k = Tx.seriesKey(t);
    if (!series[k] || t.date > series[k].date) series[k] = t;
  });
  // só séries ativas: último lançamento no mês anterior (séries paradas há meses são ignoradas)
  return Object.values(series).filter(last => last.date.slice(0, 7) === prev);
}
function applyRecurrences(list = pendingRecurrences()) {
  const updates = {};
  list.forEach(last => {
    updates[`transactions/${Store.newKey()}`] = clean({
      description: last.description, amount: Number(last.amount), type: last.type,
      category: last.category, date: addMonths(last.date, 1), isRecurring: true, notes: last.notes, investId: last.investId
    });
  });
  // contas fixas vinculadas a um investimento também geram o aporte
  Object.entries(updates).forEach(([p, t]) => { const k = p.split('/')[1]; if (t.investId) updates[`Investimentos/${t.investId}/movs/${k}`] = Invest.mov(t, k); });
  if (!list.length) return Promise.resolve();
  return Store.multi(updates).then(() => toast(`${list.length} conta(s) fixa(s) lançada(s) neste mês`));
}

/* ── Metas ── */
const Goals = {
  save(key, data) { return key ? Store.update(`Metas/${key}`, clean(data)) : Store.push('Metas', { ...data, criado: today() }); },
  remove(key) { return Store.remove(`Metas/${key}`); }
};

/* ── Lembretes ── */
const Notes = {
  save(key, data) { const d = { ...data, data: new Date().toISOString() }; return key ? Store.update(`Lembretes/${key}`, clean(d)) : Store.push('Lembretes', d); },
  remove(key) { return Store.remove(`Lembretes/${key}`); }
};
function noteDue(n) { return n.quando && !n.feito ? n.quando : null; }

/* ── Autenticação e usuários (hash SHA-256; nenhuma senha em texto no código) ──
   Conta principal (administrador): /config/auth · demais usuários: /config/users/<id>
   Cada usuário usa os dados principais ("shared") ou dados próprios em usuarios/<id>/ ("own"). */
const Auth = {
  DEFAULT: { user: 'ARNALDO', hash: '910b76ff7b9df63a5f2829077f7a5ac00d7851508c5cf4409ccbde8e08903cbb' },
  creds() { return LS.get('fin_auth') || this.DEFAULT; },
  users() { return LS.get('fin_users', {}) || {}; },
  main() { const c = this.creds(); return { id: 'main', user: c.user, nome: cap(c.user.toLowerCase()), papel: 'admin', dados: 'shared' }; },
  find(user, pass) {
    const u = user.trim().toUpperCase(), h = sha256(pass), c = this.creds();
    if (u === c.user.toUpperCase() && h === c.hash) return this.main();
    const hit = Object.entries(this.users()).find(([, x]) => x.user === u && x.hash === h && !x.bloqueado);
    return hit ? { id: hit[0], user: hit[1].user, nome: hit[1].nome || cap(hit[1].user.toLowerCase()), papel: hit[1].papel || 'membro', dados: hit[1].dados || 'own' } : null;
  },
  current() {
    try { return JSON.parse(sessionStorage.getItem('fin_current') || 'null') || LS.get('fin_current') || this.main(); }
    catch { return this.main(); }
  },
  isAdmin() { return this.current().papel === 'admin'; },
  prefix(acc = this.current()) { return acc.dados === 'own' ? `usuarios/${acc.id}/` : ''; },
  checkPass(pass) {
    const acc = this.current(), h = sha256(pass);
    return acc.id === 'main' ? h === this.creds().hash : this.users()[acc.id]?.hash === h;
  },
  isLogged() { return sessionStorage.getItem('fin_session') === '1' || (LS.get('fin_remember_until', 0) > Date.now()); },
  login(acc, remember) {
    sessionStorage.setItem('fin_session', '1');
    sessionStorage.setItem('fin_current', JSON.stringify(acc));
    if (remember) { LS.set('fin_remember_until', Date.now() + 30 * 86400000); LS.set('fin_current', acc); }
  },
  logout() {
    ['fin_session', 'fin_current'].forEach(k => sessionStorage.removeItem(k));
    ['fin_remember_until', 'fin_vault_until', 'fin_current'].forEach(k => LS.del(k));
    // não deixa dados em cache no aparelho depois de sair (importante em aparelho compartilhado)
    Object.keys(localStorage).filter(k => k.startsWith('fin_cache:')).forEach(k => LS.del(k));
  },
  /** Busca as contas atualizadas na nuvem (login em um aparelho novo, senha trocada) */
  async refresh() {
    if (!Store.db) return;
    const t = ms => new Promise(r => setTimeout(() => r(undefined), ms));
    const [a, u] = await Promise.all([Promise.race([Store.get('/config/auth'), t(4000)]), Promise.race([Store.get('/config/users'), t(4000)])]);
    if (a?.hash) LS.set('fin_auth', a);
    if (u !== undefined) LS.set('fin_users', u || {});
  },
  /** Altera usuário/senha da conta logada */
  async change(user, pass) {
    const acc = this.current(), u = user.trim().toUpperCase(), h = sha256(pass);
    if (acc.id === 'main') { const c = { user: u, hash: h }; LS.set('fin_auth', c); await Store.set('/config/auth', c); }
    else await Store.update(`/config/users/${acc.id}`, { user: u, hash: h });
    const next = { ...acc, user: u };
    sessionStorage.setItem('fin_current', JSON.stringify(next));
    if (LS.get('fin_current')) LS.set('fin_current', next);
  },
  userTaken(u, exceptId) {
    u = u.trim().toUpperCase();
    return u === this.creds().user.toUpperCase() || Object.entries(this.users()).some(([id, x]) => id !== exceptId && x.user === u);
  },
  saveUser(id, data) {
    const d = clean({ ...data, user: data.user.trim().toUpperCase() });
    return id ? Store.update(`/config/users/${id}`, d) : Store.push('/config/users', { ...d, criado: today() });
  },
  removeUser(id) { return Store.remove(`/config/users/${id}`); }
};

/* ── Carregamento e sincronização ── */
function startData() {
  DB.cats = buildCategories(null);
  Store.on('transactions', (val, fromCache) => {
    DB.tx = val ? Object.entries(val).map(([k, v]) => ({ ...v, _key: k, amount: Number(v.amount) || 0 })) : [];
    DB.descIndex = new Map();
    [...DB.tx].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(t => {
      const d = String(t.description || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
      if (d) DB.descIndex.set(norm(d), { description: d, category: t.category, type: t.type, amount: t.amount });
    });
    DB.loaded.tx = !fromCache || DB.loaded.tx;
    Bus.emit('data', 'tx');
  });
  Store.on('Lembretes', val => {
    DB.notes = val ? Object.entries(val).map(([k, v]) => ({ ...v, _key: k })) : [];
    Bus.emit('data', 'notes');
  });
  Store.on('Investimentos', val => {
    DB.invest = val ? Object.entries(val).map(([k, v]) => ({ ...v, _key: k })) : [];
    Bus.emit('data', 'invest');
  });
  // lista de usuários (para o administrador gerenciar)
  if (Auth.isAdmin()) Store.on('/config/users', val => { LS.set('fin_users', val || {}); Bus.emit('data', 'users'); }, { cache: false });
  Store.on('Metas', val => {
    DB.goals = val ? Object.entries(val).map(([k, v]) => ({ ...v, _key: k })) : [];
    Bus.emit('data', 'goals');
  });
  Store.on('config', (val, fromCache) => {
    val = val || {};
    DB.budgets = val.budgets || {};
    DB.cats = buildCategories(val.categories);
    if (!Store.prefix && val.auth?.hash) LS.set('fin_auth', val.auth);
    // migra as categorias para a nuvem na primeira vez
    if (!fromCache && !val.categories) saveCategories();
    Bus.emit('data', 'config');
  });
}
