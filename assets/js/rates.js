/* ═══════════ RENTABILIDADE AUTOMÁTICA ═══════════
   Rates   → busca CDI, Selic (diárias) e IPCA (mensal) na API pública do Banco Central (SGS)
             e guarda em cache no aparelho, para funcionar offline.
   Rentab  → interpreta a "rentabilidade contratada" (ex.: "110% do CDI", "IPCA + 6%",
             "CDI + 1,5%", "12% a.a.", "1% a.m.", "Selic", "poupança") e calcula quanto
             cada aporte vale hoje, dia útil a dia útil. */

const Rates = {
  KEY: 'fin_rates',
  SERIES: { cdi: 12, selic: 11, ipca: 433 },
  /* usadas só se nunca foi possível baixar as taxas (sem internet no 1º uso) */
  FALLBACK: { cdiAA: 0.149, selicAA: 0.15, ipcaAA: 0.05 },
  data: null, loading: null, failedAt: 0,

  load() {
    if (!this.data) this.data = LS.get(this.KEY) || { cdi: {}, selic: {}, ipca: {}, from: null, fetchedAt: null };
    return this.data;
  },

  /** 'live' (atualizado hoje) · 'cache' (de outro dia) · 'estimado' (sem dados) */
  status() {
    const d = this.load();
    if (!Object.keys(d.cdi).length) return 'estimado';
    return (d.fetchedAt || '').slice(0, 10) === today() ? 'live' : 'cache';
  },
  lastDate(serie = 'cdi') { const k = Object.keys(this.load()[serie]).sort(); return k[k.length - 1] || null; },

  /** Garante taxas desde `from`. Não bloqueia: dispara a busca e avisa a tela quando chegar. */
  need(from) {
    const d = this.load();
    if (!from) return;
    const covered = d.from && d.from <= from;
    const fresh = d.fetchedAt && (Date.now() - new Date(d.fetchedAt)) < 6 * 3600e3;
    if (covered && fresh) return;
    if (this.loading || Date.now() - this.failedAt < 10 * 60e3) return;
    this.loading = this.fetchAll(covered ? addDays(this.lastDate() || from, -10) : from, from)
      .then(() => { this.loading = null; Bus.emit('data', 'rates'); })
      .catch(e => { console.warn('Taxas BCB', e); this.loading = null; this.failedAt = Date.now(); });
  },

  async fetchAll(start, from) {
    const d = this.load(), end = today();
    const [cdi, selic, ipca] = await Promise.all([
      this.fetchSerie(this.SERIES.cdi, start, end),
      this.fetchSerie(this.SERIES.selic, start, end),
      this.fetchSerie(this.SERIES.ipca, addMonths(start.slice(0, 7) + '-01', -2), end)
    ]);
    if (!cdi.length) throw new Error('CDI vazio');
    cdi.forEach(([k, v]) => d.cdi[k] = v);
    selic.forEach(([k, v]) => d.selic[k] = v);
    ipca.forEach(([k, v]) => d.ipca[k.slice(0, 7)] = v);
    d.from = d.from && d.from < from ? d.from : from;
    d.fetchedAt = new Date().toISOString();
    LS.set(this.KEY, d);
  },

  /** A API limita séries diárias a 10 anos por consulta: busca em janelas */
  async fetchSerie(code, a, b) {
    const br = s => s.split('-').reverse().join('/'), out = [];
    for (let s = a; s <= b;) {
      const e = [addDays(addMonths(s, 12 * 9), -1), b].sort()[0];
      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${br(s)}&dataFinal=${br(e)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) { s = addDays(e, 1); continue; } // período sem dados
      if (!res.ok) throw new Error(`BCB ${code}: ${res.status}`);
      const arr = await res.json();
      (Array.isArray(arr) ? arr : []).forEach(x => {
        const [dd, mm, yy] = x.data.split('/'), v = parseFloat(String(x.valor).replace(',', '.'));
        if (!isNaN(v)) out.push([`${yy}-${mm}-${dd}`, v]);
      });
      s = addDays(e, 1);
    }
    return out;
  },

  /* ── consultas usadas pelo cálculo ── */
  /** taxa diária (fração) do CDI/Selic no dia útil `s`; sem publicação ainda → última conhecida */
  daily(serie, s) {
    const d = this.load()[serie], v = d[s];
    if (v != null) return v / 100;
    const last = this.lastDate(serie);
    if (last && s > last) return d[last] / 100;
    const aa = serie === 'cdi' ? this.FALLBACK.cdiAA : this.FALLBACK.selicAA;
    return Math.pow(1 + aa, 1 / 252) - 1;
  },
  /** IPCA do mês (fração); mês ainda não divulgado → último divulgado */
  ipca(ym) {
    const d = this.load().ipca;
    if (d[ym] != null) return d[ym] / 100;
    const ks = Object.keys(d).sort(), prev = ks.filter(k => k < ym).pop();
    if (prev) return d[prev] / 100;
    return Math.pow(1 + this.FALLBACK.ipcaAA, 1 / 12) - 1;
  },
  /** taxas atuais anualizadas, para exibir "≈ x% a.a." */
  annual(serie) {
    if (serie === 'ipca') {
      const d = this.load().ipca, ks = Object.keys(d).sort().slice(-12);
      return ks.length ? ks.reduce((f, k) => f * (1 + d[k] / 100), 1) - 1 : this.FALLBACK.ipcaAA;
    }
    return Math.pow(1 + this.daily(serie, '9999-12-31'), 252) - 1;
  },
  /** dia útil bancário: dentro do período baixado vale a série oficial do CDI; fora dele, calendário de feriados nacionais */
  isBiz(s) {
    const d = this.load(), last = this.lastDate();
    if (d.from && last && s >= d.from && s <= last) return d.cdi[s] != null;
    return isBusinessDay(s, false);
  }
};

const Rentab = {
  /** "110% do CDI" → { kind:'cdi', pct:1.1 } ... ou null se não reconhecer */
  parse(txt) {
    const s = norm(txt).replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ');
    if (!s) return null;
    const num = '(\\d+(?:\\.\\d+)?)';
    let m;
    if (/poupan/.test(s)) return { kind: 'poupanca' };
    if ((m = s.match(new RegExp(`${num}\\s*%?\\s*(?:do|da|de)?\\s*(cdi|di|selic)\\b`)))) return { kind: m[2] === 'selic' ? 'selic' : 'cdi', pct: +m[1] / 100 };
    if ((m = s.match(new RegExp(`\\b(cdi|di|selic)\\s*\\+\\s*${num}`)))) return { kind: m[1] === 'selic' ? 'selic' : 'cdi', pct: 1, spread: +m[2] / 100 };
    if ((m = s.match(new RegExp(`\\b(ipca|inflacao)\\s*\\+?\\s*${num}?`)))) return { kind: 'ipca', spread: m[2] ? +m[2] / 100 : 0 };
    if (/\b(cdi|di)\b/.test(s)) return { kind: 'cdi', pct: 1 };
    if (/\bselic\b/.test(s)) return { kind: 'selic', pct: 1 };
    if ((m = s.match(new RegExp(`${num}\\s*%\\s*(?:a\\.?\\s*m\\.?|ao mes|mensal|am\\b)`)))) return { kind: 'pre', aa: Math.pow(1 + m[1] / 100, 12) - 1, am: +m[1] / 100 };
    if ((m = s.match(new RegExp(`${num}\\s*%`)))) return { kind: 'pre', aa: +m[1] / 100 };
    return null;
  },

  /** regra do investimento: taxa digitada → nome → padrão do tipo */
  rule(inv) {
    const r = this.parse(inv.taxa) || this.parse(inv.nome);
    if (r) return r;
    if (inv.tipo === 'CDB / LCI / LCA' || inv.tipo === 'Conta remunerada / Caixinha') return { kind: 'cdi', pct: 1, assumed: true };
    if (inv.tipo === 'Poupança') return { kind: 'poupanca' };
    return null; // ações, FIIs, cripto... dependem do mercado: só com saldo informado
  },

  label(r) {
    if (!r) return 'Sem cálculo automático';
    const p = v => { const x = Math.round(v * 10000) / 100; return fmtNum(x, Number.isInteger(x) ? 0 : 2); };
    switch (r.kind) {
      case 'cdi': case 'selic': {
        const idx = r.kind === 'cdi' ? 'CDI' : 'Selic';
        return r.spread ? `${idx} + ${p(r.spread)}% a.a.` : `${p(r.pct)}% ${r.kind === 'cdi' ? 'do' : 'da'} ${idx}${r.assumed ? ' (padrão do tipo)' : ''}`;
      }
      case 'ipca': return r.spread ? `IPCA + ${p(r.spread)}% a.a.` : 'IPCA';
      case 'pre': return r.am ? `${p(r.am)}% a.m. (prefixado)` : `${p(r.aa)}% a.a. (prefixado)`;
      case 'poupanca': return 'Regra da poupança';
    }
  },

  /** rentabilidade anual equivalente hoje */
  annualNow(r) {
    if (!r) return null;
    if (r.kind === 'cdi' || r.kind === 'selic') {
      const d = Rates.daily(r.kind, '9999-12-31');
      return Math.pow((1 + d * r.pct) * Math.pow(1 + (r.spread || 0), 1 / 252), 252) - 1;
    }
    if (r.kind === 'ipca') return (1 + Rates.annual('ipca')) * (1 + r.spread) - 1;
    if (r.kind === 'pre') return r.aa;
    if (r.kind === 'poupanca') return Math.pow(1 + this.poupMonth(), 12) - 1;
  },

  /** poupança: 0,5% a.m. se Selic > 8,5% a.a.; senão 70% da Selic (TR desconsiderada) */
  poupMonth() {
    const selic = Rates.annual('selic');
    return selic > 0.085 ? 0.005 : Math.pow(1 + selic * 0.7, 1 / 12) - 1;
  },

  /** fator de correção de `a` (data do aporte) até `b` (hoje): dias úteis em [a, b).
      Usa um índice acumulado por regra (calculado uma vez) → cada aporte custa O(1). */
  factor(r, a, b = today()) {
    if (!r || !a || a >= b) return 1;
    if (r.kind === 'poupanca') {
      // rende só nos aniversários mensais
      let n = 0; while (addMonths(a, n + 1) <= b) n++;
      return Math.pow(1 + this.poupMonth(), n);
    }
    const idx = this.index(r, a);
    return (idx.c[b] ?? idx.c[idx.end]) / idx.c[a];
  },
  _idx: {},
  index(r, from) {
    const key = JSON.stringify([r.kind, r.pct, r.spread, r.aa]), stamp = (Rates.load().fetchedAt || '') + today();
    let idx = this._idx[key];
    if (idx && idx.stamp === stamp && idx.start <= from) return idx;
    const start = idx && idx.stamp === stamp ? [idx.start, from].sort()[0] : from, end = today();
    const spreadD = Math.pow(1 + (r.spread || 0), 1 / 252);
    const preD = r.kind === 'pre' ? Math.pow(1 + r.aa, 1 / 252) : 1;
    const duMes = {}, c = {};
    let f = 1;
    for (let s = start; s <= end; s = addDays(s, 1)) {
      c[s] = f; // valor acumulado no início do dia s
      if (!Rates.isBiz(s)) continue;
      if (r.kind === 'cdi' || r.kind === 'selic') f *= (1 + Rates.daily(r.kind, s) * r.pct) * spreadD;
      else if (r.kind === 'pre') f *= preD;
      else if (r.kind === 'ipca') {
        const ym = s.slice(0, 7);
        duMes[ym] ??= this.bizInMonth(ym);
        f *= Math.pow(1 + Rates.ipca(ym), 1 / duMes[ym]) * spreadD;
      }
    }
    return this._idx[key] = { c, start, end, stamp };
  },
  bizInMonth(ym) { const [a, b] = ymRange(ym); let c = 0; for (let s = a; s <= b; s = addDays(s, 1)) if (Rates.isBiz(s)) c++; return c || 21; },

  /** Imposto de renda (tabela regressiva) — só para o que é tributado */
  irRate(days) { return days <= 180 ? 0.225 : days <= 360 ? 0.2 : days <= 720 ? 0.175 : 0.15; },
  taxed(inv, r) {
    const t = norm(`${inv.nome} ${inv.taxa || ''}`);
    if (!r || r.kind === 'poupanca' || inv.tipo === 'Poupança') return false;
    if (/\b(lci|lca|lig|cri|cra|isento|incentivad)/.test(t)) return false;
    return ['CDB / LCI / LCA', 'Tesouro Direto', 'Conta remunerada / Caixinha'].includes(inv.tipo);
  }
};
