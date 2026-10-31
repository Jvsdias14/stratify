import {
  store, save, subscribe, replaceData, resetData, monthEntries, monthTotals, cumulativeExpense,
  categoryById, categoriesOf, getStatus, setStatus, isActiveIn, PALETTE, NEUTRAL,
} from './store.js';
import { monthForecast, projectMonths } from './finance.js';
import * as Sync from './sync.js';
import * as Charts from './charts.js';
import { icon, catGlyph } from './icons.js';
import { ICON_GROUPS } from './category-icons.js';
import {
  uid, money, percent, num, parseNumber, round2, escapeHtml as esc, todayISO, currentYM, addMonths,
  daysInMonth, monthLabel, monthShort, monthShortYear, dayLabel, dateBR,
} from './utils.js';

const ui = { view: 'home', prevView: 'home', month: currentYM(), filter: 'all', catFilter: 'all', horizon: 12, barPreset: 'past', barShift: 0 };

// Janelas do gráfico receitas × despesas: início relativo ao mês selecionado e quantidade de meses.
const BAR_PRESETS = { past: { label: 'Passado', start: -5, span: 6 }, future: { label: 'Futuro', start: 0, span: 6 }, year: { label: '12 meses', start: -5, span: 12 } };
const $ = (s, r = document) => r.querySelector(s);

const TITLES = { home: 'Visão geral', list: 'Lançamentos', fixed: 'Fixos', invest: 'Rendimentos', pending: 'Dinheiro parado', settings: 'Ajustes' };
const MONTH_VIEWS = ['home', 'list', 'fixed'];

// ---------------------------------------------------------------- render

function render({ keepScroll = true } = {}) {
  const y = window.scrollY;
  Charts.destroyAll();
  renderHeader();
  const { html, mount } = VIEWS[ui.view]();
  $('#view').innerHTML = html;
  mount?.();
  document.querySelectorAll('.tab[data-view]').forEach((b) => {
    const on = b.dataset.view === ui.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  window.scrollTo(0, keepScroll ? y : 0);
}

function renderHeader() {
  const monthSwitch = MONTH_VIEWS.includes(ui.view)
    ? `<div class="month-switch">
        <button class="icon-btn sm" data-action="month" data-step="-1" aria-label="Mês anterior">${icon('left', 18)}</button>
        <button class="month-label" data-action="month" data-step="0">${monthLabel(ui.month)}</button>
        <button class="icon-btn sm" data-action="month" data-step="1" aria-label="Próximo mês">${icon('right', 18)}</button>
      </div>`
    : '';
  $('#topbar').innerHTML = `
    <div class="topbar-row">
      ${ui.view === 'settings'
        ? `<button class="back-btn" data-action="back">${icon('left', 20)} Voltar</button>`
        : `<div class="brand"><span class="brand-mark"></span>Stratify</div>`}
      <div class="topbar-actions">
        <span class="sync-dot" id="sync-dot" title=""></span>
        ${ui.view !== 'settings' ? `<button class="icon-btn" data-action="nav" data-view="settings" aria-label="Ajustes">${icon('gear', 20)}</button>` : ''}
      </div>
    </div>
    <div class="topbar-title"><h1>${TITLES[ui.view]}</h1>${monthSwitch}</div>`;
  updateSyncDot();
}

function updateSyncDot() {
  const dot = $('#sync-dot');
  if (dot) {
    dot.dataset.state = Sync.status.state;
    dot.title = Sync.status.message;
  }
  const s = $('#sync-status');
  if (s) s.innerHTML = syncStatusHtml();
}

// ---------------------------------------------------------------- pieces

const catDot = (cat, size = '') => `<span class="cat-dot ${size}" style="--c:${cat.color}" aria-hidden="true">${catGlyph(cat.icon, size.includes('lg') ? 26 : 18)}</span>`;

function entryRow(e) {
  const cat = categoryById(e.categoryId);
  const inc = e.kind === 'income';
  const badges = [
    e.source === 'recurring' ? '<span class="badge">Fixa</span>' : '',
    e.source === 'recurring' && !e.paid ? `<span class="badge warn">${inc ? 'A receber' : 'Pendente'}</span>` : '',
    e.customAmount ? '<span class="badge soft">Valor do mês</span>' : '',
  ].join('');
  return `<button class="row" data-action="open-entry" data-id="${e.id}">
    ${catDot(cat)}
    <span class="row-main"><span class="row-title">${esc(e.description)}</span><span class="row-sub">${esc(cat.name)}${badges}</span></span>
    <span class="row-amount ${inc ? 'pos' : ''}">${inc ? '+' : '−'} ${money(e.amount)}</span>
  </button>`;
}

const empty = (title, text, cta = '') => `<div class="empty"><div class="empty-art">${icon('wallet', 28)}</div><strong>${title}</strong><p>${text}</p>${cta}</div>`;

function deltaChip(cur, prev, { invert = false } = {}) {
  if (!prev && !cur) return '';
  if (!prev) return '<span class="delta neutral">novo</span>';
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return '<span class="delta neutral">= estável</span>';
  const up = d > 0;
  const bad = invert ? !up : up;
  return `<span class="delta ${bad ? 'bad' : 'good'}">${icon(up ? 'up' : 'down', 12)} ${num(Math.abs(d), 0)}%</span>`;
}

// ---------------------------------------------------------------- views

function viewHome() {
  const ym = ui.month;
  const prevYm = addMonths(ym, -1);
  const t = monthTotals(ym);
  const p = monthTotals(prevYm);
  const isCurrent = ym === currentYM();
  const hasData = t.entries.length > 0;

  const cats = Object.entries(t.byCat).map(([id, value]) => ({ cat: categoryById(id), value })).sort((a, b) => b.value - a.value);
  const items = cats.slice(0, 6).map((c) => ({ label: c.cat.name, value: c.value, color: c.cat.color, icon: c.cat.icon }));
  const rest = cats.slice(6).reduce((s, c) => s + c.value, 0);
  if (rest > 0) items.push({ label: 'Demais', value: round2(rest), color: NEUTRAL, icon: 'circle-ellipsis' });

  const preset = BAR_PRESETS[ui.barPreset];
  const firstMonth = addMonths(ym, preset.start + ui.barShift * preset.span);
  const months = Array.from({ length: preset.span }, (_, i) => addMonths(firstMonth, i));
  const series = months.map((m) => monthTotals(m));
  const future = months.map((m) => m > currentYM());


  const upcoming = t.entries.filter((e) => e.source === 'recurring' && e.kind === 'expense' && !e.paid).sort((a, b) => (a.date < b.date ? -1 : 1));

  const installHint = !navigator.standalone && /iphone|ipad/i.test(navigator.userAgent) && !localStorage.getItem('stratify:hint-dismissed')
    ? `<div class="card hint"><div>${icon('info', 18)}</div><p>Para usar como app: toque em <strong>Compartilhar</strong> no Safari e depois em <strong>Adicionar à Tela de Início</strong>.</p><button class="icon-btn sm" data-action="dismiss-hint" aria-label="Fechar">${icon('close', 16)}</button></div>`
    : '';

  // Meta de sobra: 6 meses antes, o mês selecionado e 5 depois.
  const goal = store.data.goals.monthlySurplus || 0;
  const gMonths = Array.from({ length: 12 }, (_, i) => addMonths(ym, i - 6));
  const gTotals = gMonths.map((m) => (m === ym ? t : monthTotals(m)));
  const gFuture = gMonths.map((m) => m > currentYM());
  const gPast = gMonths.map((m, i) => i).filter((i) => gMonths[i] < currentYM() && gTotals[i].entries.length);
  const gHits = gPast.filter((i) => gTotals[i].balance >= goal).length;
  const gPct = goal > 0 ? (Math.max(0, t.balance) / goal) * 100 : 0;
  const gMet = goal > 0 && t.balance >= goal;
  const projected = ym >= currentYM();
  const goalCard = `
    <section class="card">
      <div class="card-head"><h2>Meta de sobra</h2><button class="link" data-action="edit-goal">${goal ? 'Editar' : 'Definir meta'}</button></div>
      ${goal ? `
        <div class="goal-top">
          <div><span class="muted small">Sobra ${projected ? 'prevista ' : ''}em ${monthShort(ym).toLowerCase()}</span><strong class="${t.balance < 0 ? 'neg' : ''}">${money(t.balance)}</strong></div>
          <div class="goal-target"><span class="muted small">Meta mensal</span><strong>${money(goal)}</strong></div>
        </div>
        <div class="meter ${gMet ? 'met' : ''}" role="progressbar" aria-valuenow="${Math.round(gPct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, gPct)}%"></i></div>
        <p class="goal-status ${gMet ? 'ok' : ''}">${gMet
          ? `${icon('check', 15)} Meta atingida${t.balance > goal ? ` · ${money(t.balance - goal)} acima` : ''}`
          : `Faltam <strong>${money(goal - t.balance)}</strong> · ${num(gPct, 0)}% da meta`}</p>
        <div class="chart-box"><canvas id="ch-goal" role="img" aria-label="Sobra mensal comparada à meta"></canvas></div>
        <p class="muted small chart-note">${gPast.length ? `Bateu a meta em <strong>${gHits} de ${gPast.length}</strong> meses anteriores. ` : ''}${gFuture.some(Boolean) ? 'Barras claras = previsão.' : ''}</p>`
      : `<p class="card-sub">Defina quanto quer que sobre por mês (receitas − despesas) e acompanhe mês a mês.</p>`}
    </section>`;

  const lastBackup = getLastBackup();
  const backupHint = backupOverdue()
    ? `<div class="card hint"><div>${icon('download', 18)}</div><p>${lastBackup ? `Último backup em ${dateBR(lastBackup)}.` : 'Você ainda não fez backup.'} Guarde uma cópia dos seus dados fora do navegador.</p><button class="btn soft sm-btn" data-action="export">Exportar</button></div>`
    : '';

  const html = `
    ${installHint}${backupHint}
    <section class="hero">
      <div class="hero-label">Saldo de ${monthShort(ym).toLowerCase()}</div>
      <div class="hero-value">${money(t.balance)}</div>
      <div class="hero-split">
        <div><span>Receitas</span><strong>${money(t.income)}</strong></div>
        <div><span>Despesas</span><strong>${money(t.expense)}</strong></div>
      </div>
    </section>

    <div class="stat-row">
      <div class="stat"><span>A pagar</span><strong>${money(t.pending)}</strong></div>
      <div class="stat"><span>Fixas</span><strong>${money(t.fixed)}</strong></div>
      <div class="stat"><span>Variáveis</span><strong>${money(t.variable)}</strong></div>
    </div>

    ${hasData || goal ? goalCard : ''}

    ${!hasData ? `<div class="card">${empty('Nada em ' + monthLabel(ym), 'Cadastre seu salário, contas fixas e gastos para ver os gráficos.',
      `<div class="btn-row"><button class="btn primary" data-action="add">Novo lançamento</button><button class="btn soft" data-action="add-fixed" data-kind="income">Cadastrar salário</button></div>`)}</div>` : ''}

    ${items.length ? `
    <section class="card">
      <div class="card-head"><h2>Despesas por categoria</h2><span class="muted">${monthShortYear(ym)}</span></div>
      <div class="donut-wrap">
        <div class="donut-box"><canvas id="ch-donut" role="img" aria-label="Gráfico de despesas por categoria"></canvas>
          <div class="donut-center"><span>Total</span><strong>${money(t.expense)}</strong></div></div>
      </div>
      <ul class="legend-list">
        ${items.map((i) => `<li><span class="swatch" style="background:${i.color}"></span><span class="lg-name"><span class="lg-icon">${catGlyph(i.icon, 15)}</span>${esc(i.label)}</span><span class="lg-val">${money(i.value)}</span><span class="lg-pct">${num((i.value / t.expense) * 100, 0)}%</span></li>`).join('')}
      </ul>
    </section>` : ''}

    ${upcoming.length ? `
    <section class="card">
      <div class="card-head"><h2>Contas a pagar</h2><span class="muted">${money(t.pending)}</span></div>
      <div class="rows">
        ${upcoming.map((e) => {
          const cat = categoryById(e.categoryId);
          return `<div class="row" role="button" tabindex="0" data-action="open-entry" data-id="${e.id}">
            ${catDot(cat)}
            <span class="row-main"><span class="row-title">${esc(e.description)}</span><span class="row-sub">Vence ${dayLabel(e.date).toLowerCase()}</span></span>
            <span class="row-amount">${money(e.amount)}</span>
            <button class="check-btn" data-action="toggle-paid" data-rec="${e.recurringId}" data-ym="${ym}" aria-label="Marcar ${esc(e.description)} como paga">${icon('check', 16)}</button>
          </div>`;
        }).join('')}
      </div>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Receitas × despesas</h2></div>
      <div class="seg sm">${Object.entries(BAR_PRESETS).map(([k, p]) => `<button class="${ui.barPreset === k ? 'on' : ''}" data-action="bar-preset" data-preset="${k}">${p.label}</button>`).join('')}</div>
      <div class="range-nav">
        <button class="icon-btn sm" data-action="bar-shift" data-step="-1" aria-label="Período anterior">${icon('left', 18)}</button>
        <span>${monthShortYear(months[0])} – ${monthShortYear(months[months.length - 1])}</span>
        <button class="icon-btn sm" data-action="bar-shift" data-step="1" aria-label="Próximo período">${icon('right', 18)}</button>
      </div>
      <div class="chart-box"><canvas id="ch-bars" role="img" aria-label="Receitas e despesas de ${monthShortYear(months[0])} a ${monthShortYear(months[months.length - 1])}"></canvas></div>
      ${future.some(Boolean) ? '<p class="muted small chart-note">Barras claras = previsão (contas fixas e lançamentos já agendados).</p>' : ''}
      <table class="mini-table">
        <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead>
        <tbody>${months.map((m, i) => `<tr class="${future[i] ? 'forecast' : ''}"><td>${monthShortYear(m)}${future[i] ? ' <span class="badge soft">prev.</span>' : ''}</td><td>${money(series[i].income)}</td><td>${money(series[i].expense)}</td><td class="${series[i].balance < 0 ? 'neg' : ''}">${money(series[i].balance)}</td></tr>`).join('')}</tbody>
      </table>
    </section>

    <section class="card">
      <div class="card-head"><h2>Ritmo de gastos</h2>${deltaChip(t.expense, p.expense)}</div>
      <p class="card-sub">Gasto acumulado dia a dia, comparado a ${monthLabel(prevYm).toLowerCase()}.</p>
      <div class="chart-box"><canvas id="ch-cum" role="img" aria-label="Gasto acumulado no mês comparado ao mês anterior"></canvas></div>
    </section>

    ${categoryGoalsCard(ym, t)}
  `;

  const mount = () => {
    if (!Charts.available()) {
      document.querySelectorAll('.chart-box, .donut-wrap').forEach((b) => (b.innerHTML = '<p class="muted center">Gráficos indisponíveis offline na primeira abertura.</p>'));
      return;
    }
    if (items.length) Charts.donut('ch-donut', items);
    if (goal) Charts.goalBars('ch-goal', gMonths.map(monthShort), gTotals.map((g) => g.balance), goal, gFuture);
    Charts.incomeExpenseBars('ch-bars', months.map(preset.span > 6 ? monthShortYear : monthShort), series.map((s) => s.income), series.map((s) => s.expense), future);
    const dim = Math.max(daysInMonth(ym), daysInMonth(prevYm));
    const upto = isCurrent ? Number(todayISO().slice(8)) : null;
    const cur = cumulativeExpense(ym, upto);
    const prev = cumulativeExpense(prevYm);
    Charts.cumulativeLines('ch-cum', Array.from({ length: dim }, (_, i) => i + 1), cur, prev, [monthShort(ym), monthShort(prevYm)]);
  };
  return { html, mount };
}

// Metas (limites) de gasto por categoria no mês; o que não tem meta própria cai em "Outros".
function categoryGoalsCard(ym, t) {
  const { byCategory, others } = store.data.goals;
  const ids = Object.keys(byCategory).filter((id) => byCategory[id] > 0 && categoryById(id).id);
  if (!ids.length && !others) {
    return `<section class="card">
      <div class="card-head"><h2>Metas por categoria</h2><button class="link" data-action="edit-cat-goals">Definir metas</button></div>
      <p class="card-sub">Defina quanto quer gastar por mês em cada categoria. O que não tiver meta própria entra em "Outros".</p>
    </section>`;
  }
  const goalSpent = ids.reduce((s, id) => s + (t.byCat[id] || 0), 0);
  const rows = ids.map((id) => {
    const cat = categoryById(id);
    return { name: cat.name, icon: cat.icon, color: cat.color, spent: t.byCat[id] || 0, limit: byCategory[id] };
  }).sort((a, b) => b.spent / b.limit - a.spent / a.limit);
  rows.push({ name: 'Outros', icon: 'circle-ellipsis', color: NEUTRAL, spent: round2(t.expense - goalSpent), limit: others || 0 });
  const limitTotal = rows.reduce((s, r) => s + r.limit, 0);
  // Marca de ritmo: quanto do mês já passou (só no mês atual).
  const pace = ym === currentYM() ? (Number(todayISO().slice(8)) / daysInMonth(ym)) * 100 : null;

  const row = (r) => {
    const pct = r.limit ? (r.spent / r.limit) * 100 : 0;
    const over = r.limit && r.spent > r.limit;
    const status = !r.limit ? '<span class="muted">sem meta</span>'
      : over ? `<span class="neg">Estourou ${money(r.spent - r.limit)}</span>`
      : `<span class="muted">Restam ${money(r.limit - r.spent)}</span>`;
    return `<li>
      <div class="comp-top"><span class="comp-name"><span class="budget-icon" style="color:color-mix(in srgb, ${r.color} 82%, black)">${catGlyph(r.icon, 15)}</span>${esc(r.name)}</span>
        <span class="comp-val">${money(r.spent)}${r.limit ? `<span class="muted"> / ${money(r.limit)}</span>` : ''}</span></div>
      <div class="budget-bar ${over ? 'over' : ''}">${r.limit ? `<i style="width:${Math.min(100, pct)}%;background:${over ? 'var(--neg)' : r.color}"></i>` : ''}${r.limit && pace != null ? `<b style="left:${pace}%"></b>` : ''}</div>
      <div class="budget-sub">${status}${r.limit ? `<span class="muted">${num(pct, 0)}%</span>` : ''}</div>
    </li>`;
  };
  return `<section class="card">
    <div class="card-head"><h2>Metas por categoria</h2><button class="link" data-action="edit-cat-goals">Editar</button></div>
    <p class="card-sub">Gasto ${ym >= currentYM() ? 'previsto ' : ''}em ${monthShort(ym).toLowerCase()}: <strong>${money(t.expense)}</strong>${limitTotal ? ` de <strong>${money(limitTotal)}</strong> planejados` : ''}.${pace != null ? ' A marca na barra indica quanto do mês já passou.' : ''}</p>
    <ul class="comp-list">${rows.map(row).join('')}</ul>
  </section>`;
}

function viewList() {
  const t = monthTotals(ui.month);
  const filters = { all: 'Todos', expense: 'Despesas', income: 'Receitas', recurring: 'Fixos', once: 'Pontuais' };
  const byType = t.entries.filter((e) => ui.filter === 'all' || e.kind === ui.filter || e.source === ui.filter);
  // Filtro de categoria fica numa segunda faixa e combina com o de tipo. Só lista categorias com lançamentos
  // no recorte atual (mais a selecionada, para poder desmarcá-la).
  const catOf = (e) => categoryById(e.categoryId);
  const used = new Map();
  for (const e of byType) { const c = catOf(e); used.set(c.id, c); }
  if (ui.catFilter !== 'all' && !used.has(ui.catFilter)) used.set(ui.catFilter, categoryById(ui.catFilter));
  const catChips = [...used.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const entries = ui.catFilter === 'all' ? byType : byType.filter((e) => catOf(e).id === ui.catFilter);
  const sumKind = (k) => round2(entries.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0));
  const totals = ui.catFilter === 'all' ? t : { income: sumKind('income'), expense: sumKind('expense') };
  const groups = new Map();
  for (const e of entries) groups.set(e.date, [...(groups.get(e.date) || []), e]);

  const html = `
    <div class="chips scroll" role="tablist">
      ${Object.entries(filters).map(([k, v]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-action="filter" data-filter="${k}" role="tab" aria-selected="${ui.filter === k}">${v}</button>`).join('')}
    </div>
    ${catChips.length > 1 || ui.catFilter !== 'all' ? `<div class="chips scroll cat-chips" role="tablist" aria-label="Filtrar por categoria">
      <button class="chip sm ${ui.catFilter === 'all' ? 'on' : ''}" data-action="cat-filter" data-id="all" role="tab" aria-selected="${ui.catFilter === 'all'}">Todas as categorias</button>
      ${catChips.map((c) => `<button class="chip sm cat-chip ${ui.catFilter === c.id ? 'on' : ''}" style="--c:${c.color}" data-action="cat-filter" data-id="${c.id}" role="tab" aria-selected="${ui.catFilter === c.id}"><span class="cat-chip-icon">${catGlyph(c.icon, 15)}</span>${esc(c.name)}</button>`).join('')}
    </div>` : ''}
    <div class="stat-row two">
      <div class="stat"><span>Receitas</span><strong class="pos">${money(totals.income)}</strong></div>
      <div class="stat"><span>Despesas</span><strong>${money(totals.expense)}</strong></div>
    </div>
    ${groups.size ? [...groups].map(([date, list]) => `
      <section class="group">
        <div class="group-head"><span>${dayLabel(date)}</span><span>${money(list.reduce((s, e) => s + (e.kind === 'income' ? e.amount : -e.amount), 0))}</span></div>
        <div class="card rows flush">${list.map(entryRow).join('')}</div>
      </section>`).join('')
      : `<div class="card">${empty('Sem lançamentos', 'Toque no + para adicionar um gasto ou uma entrada.')}</div>`}
  `;
  return { html };
}

function viewFixed() {
  const ym = ui.month;
  const recs = store.data.recurring;
  const active = recs.filter((r) => isActiveIn(r, ym));
  const future = recs.filter((r) => r.start > ym);
  const ended = recs.filter((r) => r.end && r.end < ym);
  const amountOf = (r) => getStatus(r.id, ym).amount ?? r.amount;
  const sum = (list) => round2(list.filter((r) => !getStatus(r.id, ym).skip).reduce((s, r) => s + amountOf(r), 0));
  const inc = active.filter((r) => r.kind === 'income').sort((a, b) => a.day - b.day);
  const exp = active.filter((r) => r.kind === 'expense').sort((a, b) => a.day - b.day);
  const incSum = sum(inc), expSum = sum(exp);
  const commit = incSum ? (expSum / incSum) * 100 : 0;

  const recRow = (r) => {
    const st = getStatus(r.id, ym);
    const cat = categoryById(r.categoryId);
    const isInc = r.kind === 'income';
    const badge = st.skip ? '<span class="badge muted">Pulado</span>'
      : st.paid ? `<span class="badge ok">${icon('check', 11)} ${isInc ? 'Recebido' : 'Pago'}</span>`
      : `<span class="badge warn">${isInc ? 'A receber' : 'Pendente'}</span>`;
    return `<div class="row ${st.skip ? 'dim' : ''}" role="button" tabindex="0" data-action="open-rec" data-rec="${r.id}">
      ${catDot(cat)}
      <span class="row-main"><span class="row-title">${esc(r.description)}</span><span class="row-sub">Dia ${r.day}${badge}</span></span>
      <span class="row-amount ${isInc ? 'pos' : ''}">${money(amountOf(r))}</span>
      ${st.skip ? '' : `<button class="check-btn ${st.paid ? 'on' : ''}" data-action="toggle-paid" data-rec="${r.id}" data-ym="${ym}" aria-pressed="${!!st.paid}" aria-label="Alternar ${isInc ? 'recebido' : 'pago'}">${icon('check', 16)}</button>`}
    </div>`;
  };
  const simpleRow = (r, note) => {
    const cat = categoryById(r.categoryId);
    return `<button class="row dim" data-action="edit-rec" data-rec="${r.id}">${catDot(cat)}
      <span class="row-main"><span class="row-title">${esc(r.description)}</span><span class="row-sub">${note}</span></span>
      <span class="row-amount">${money(r.amount)}</span></button>`;
  };

  const html = `
    <section class="card commit">
      <div class="commit-top"><div><span class="muted">Comprometimento da renda fixa</span><strong>${num(commit, 0)}%</strong></div>
        <div class="commit-sums"><span class="pos">+ ${money(incSum)}</span><span>− ${money(expSum)}</span></div></div>
      <div class="meter"><i style="width:${Math.min(100, commit)}%"></i></div>
      <p class="muted small">Sobra das receitas fixas após contas fixas: <strong>${money(incSum - expSum)}</strong></p>
    </section>

    <div class="btn-row">
      <button class="btn soft" data-action="add-fixed" data-kind="expense">${icon('plus', 16)} Conta fixa</button>
      <button class="btn soft" data-action="add-fixed" data-kind="income">${icon('plus', 16)} Salário / receita</button>
    </div>

    <section class="group"><div class="group-head"><span>Receitas fixas</span><span>${money(incSum)}</span></div>
      <div class="card rows flush">${inc.length ? inc.map(recRow).join('') : '<p class="muted pad">Cadastre seu salário aqui.</p>'}</div></section>

    <section class="group"><div class="group-head"><span>Contas fixas</span><span>${money(expSum)}</span></div>
      <div class="card rows flush">${exp.length ? exp.map(recRow).join('') : '<p class="muted pad">Aluguel, internet, assinaturas, academia…</p>'}</div></section>

    ${future.length ? `<section class="group"><div class="group-head"><span>Começam depois</span></div>
      <div class="card rows flush">${future.map((r) => simpleRow(r, `A partir de ${monthShortYear(r.start)}`)).join('')}</div></section>` : ''}
    ${ended.length ? `<section class="group"><div class="group-head"><span>Encerradas</span></div>
      <div class="card rows flush">${ended.map((r) => simpleRow(r, `${monthShortYear(r.start)} – ${monthShortYear(r.end)}`)).join('')}</div></section>` : ''}
  `;
  return { html };
}

const INV_PARAMS = ['depositMode', 'monthlyDeposit', 'depositPercent', 'depositDay', 'cdiAnnual', 'cdiPercent', 'irRate', 'includeSurplus'];
const invParams = (inv) => Object.fromEntries(INV_PARAMS.map((k) => [k, inv[k]]));
const isInvDirty = () => !!ui.invDraft && INV_PARAMS.some((k) => ui.invDraft[k] !== store.data.investments[k]);

function saveInvParams() {
  const d = { ...ui.invDraft };
  const bad = (v) => typeof v !== 'number' || !Number.isFinite(v);
  if (bad(d.cdiAnnual) || d.cdiAnnual < 0) return toast('CDI anual inválido');
  if (bad(d.cdiPercent) || d.cdiPercent <= 0) return toast('% do CDI inválido');
  if (d.depositMode === 'percent' && (bad(d.depositPercent) || d.depositPercent < 0 || d.depositPercent > 100)) return toast('Percentual deve ser de 0 a 100');
  if (bad(d.depositDay)) return toast('Dia do aporte inválido');
  d.depositDay = Math.min(31, Math.max(1, Math.round(d.depositDay)));
  d.monthlyDeposit = round2(d.monthlyDeposit || 0);
  Object.assign(store.data.investments, d);
  ui.invDraft = null;
  save();
  toast('Parâmetros salvos');
}

function viewInvest() {
  const inv = store.data.investments;
  const today = todayISO();
  const ym = currentYM();
  const t = monthTotals(ym);
  const surplusFor = (m) => (m === ym ? t.balance : monthTotals(m).balance);
  const fc = monthForecast(inv, today, surplusFor);
  const proj = projectMonths(inv, fc.endBalance, ym, ui.horizon, surplusFor);
  const last = proj[proj.length - 1];
  const draft = ui.invDraft || (ui.invDraft = invParams(inv));
  const isPct = draft.depositMode === 'percent';
  const avgDeposit = proj.reduce((s, r) => s + r.deposit, 0) / proj.length;
  const depositText = inv.depositMode === 'percent'
    ? `aporte de ${num(inv.depositPercent, 1)}% da sobra prevista (média de ${money(avgDeposit)}/mês)`
    : `aporte de ${money(inv.monthlyDeposit)}/mês`;
  const leftover = round2(t.balance - fc.plannedThisMonth - fc.surplusAdded);
  const hist = [...inv.history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const irOptions = [[22.5, 'até 180 dias'], [20, '181 a 360 dias'], [17.5, '361 a 720 dias'], [15, 'acima de 720 dias']];

  const html = `
    <section class="hero invest">
      <div class="hero-label">Cofrinho previsto em ${dateBR(fc.end)}</div>
      <div class="hero-value">${money(fc.endBalance)}</div>
      <div class="hero-pills">
        <span>+ ${money(fc.gained)} de rendimento bruto</span>
        <span>≈ ${money(fc.gainedNet)} líquido (IR ${num(inv.irRate, 1)}%)</span>
      </div>
      <div class="hero-split">
        <div><span>Saldo atual</span><strong>${money(inv.balance)}</strong></div>
        <div><span>Atualizado em</span><strong>${dateBR(inv.balanceDate)}</strong></div>
      </div>
      <button class="btn glass block" data-action="update-balance">${icon('edit', 16)} Atualizar saldo do cofrinho</button>
    </section>

    <div class="stat-grid">
      <div class="stat"><span>Rende por dia útil</span><strong>${money(fc.perDayNow)}</strong></div>
      <div class="stat"><span>Dias úteis restantes</span><strong>${fc.remainingBdays} <small>de ${fc.monthBdays}</small></strong></div>
      <div class="stat"><span>Taxa no mês</span><strong>${percent(fc.monthRate)}</strong></div>
      <div class="stat"><span>Taxa anual efetiva</span><strong>${percent(fc.annualRate)}</strong></div>
    </div>

    <section class="card">
      <div class="card-head"><h2>Fechamento de ${monthShort(ym).toLowerCase()}</h2></div>
      <dl class="kv">
        <div><dt>Sobra do mês (receitas − despesas)</dt><dd class="${t.balance < 0 ? 'neg' : ''}">${money(t.balance)}</dd></div>
        <div><dt>Aporte planejado${inv.depositMode === 'percent' ? ` (${num(inv.depositPercent, 1)}% da sobra)` : ''}</dt><dd>${money(fc.plannedThisMonth)}</dd></div>
        <div><dt>Sobra enviada ao cofrinho</dt><dd>${money(fc.surplusAdded)}</dd></div>
        <div><dt>Cofrinho no fim do mês</dt><dd>${money(fc.endBalance)}</dd></div>
        <div><dt>Fica em conta</dt><dd class="${leftover < 0 ? 'neg' : ''}">${money(leftover)}</dd></div>
        <div class="total"><dt>Patrimônio previsto</dt><dd>${money(fc.endBalance + leftover)}</dd></div>
      </dl>
      ${t.pending > 0 ? `<p class="muted small">Inclui ${money(t.pending)} em contas fixas ainda não pagas.</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Parâmetros</h2></div>
      <div class="field"><span>Aporte mensal</span>
        <div class="seg">${[['fixed', 'Valor fixo'], ['percent', '% da sobra']].map(([v, l]) => `<button class="${draft.depositMode === v ? 'on' : ''}" data-action="inv-mode" data-mode="${v}">${l}</button>`).join('')}</div>
      </div>
      <div class="form-grid params">
        ${isPct
          ? `<label class="field"><span>% da sobra</span><input class="input" data-draft="depositPercent" data-type="number" inputmode="decimal" value="${num(draft.depositPercent, 2)}"></label>`
          : `<label class="field"><span>Valor do aporte</span><input class="input" data-draft="monthlyDeposit" data-type="money" inputmode="numeric" value="${draft.monthlyDeposit ? money(draft.monthlyDeposit) : ''}" placeholder="R$ 0,00"></label>`}
        <label class="field"><span>Dia do aporte</span><input class="input" data-draft="depositDay" data-type="number" inputmode="numeric" value="${draft.depositDay}"></label>
        ${isPct ? `<p class="muted small full">Sobra prevista em ${monthShort(ym).toLowerCase()}: ${money(t.balance)}. Meses com sobra negativa não têm aporte.</p>` : ''}
        <label class="field"><span>CDI anual (%)</span><input class="input" data-draft="cdiAnnual" data-type="number" inputmode="decimal" value="${num(draft.cdiAnnual, 2)}"></label>
        <label class="field"><span>% do CDI</span><input class="input" data-draft="cdiPercent" data-type="number" inputmode="decimal" value="${num(draft.cdiPercent, 2)}"></label>
        <label class="field full"><span>Alíquota de IR (tempo aplicado)</span>
          <select class="input" data-draft="irRate" data-type="number">${irOptions.map(([v, l]) => `<option value="${v}" ${draft.irRate === v ? 'selected' : ''}>${num(v, 1)}% · ${l}</option>`).join('')}</select></label>
        <label class="switch full"><input type="checkbox" data-draft="includeSurplus" ${draft.includeSurplus ? 'checked' : ''}><span class="switch-ui"></span><span>Guardar no cofrinho o restante da sobra (após o aporte)</span></label>
      </div>
      <p class="unsaved" id="inv-dirty" ${isInvDirty() ? '' : 'hidden'}>Alterações não salvas</p>
      <button class="btn primary block" data-action="inv-save">Salvar parâmetros</button>
      <p class="muted small">Cofrinho PicPay: ${num(inv.cdiPercent, 0)}% do CDI, rendimento diário em dias úteis (feriados nacionais considerados). Confira o CDI atual e ajuste aqui.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Projeção</h2>
        <div class="seg sm">${[6, 12, 24, 36].map((h) => `<button class="${ui.horizon === h ? 'on' : ''}" data-action="horizon" data-h="${h}">${h}m</button>`).join('')}</div></div>
      <p class="card-sub">Com ${depositText}, em ${monthLabel(last.ym).toLowerCase()} você teria <strong>${money(last.balance)}</strong>, sendo <strong>${money(last.gained)}</strong> de rendimentos (bruto).</p>
      <div class="chart-box tall"><canvas id="ch-proj" role="img" aria-label="Projeção do cofrinho"></canvas></div>
      <details class="table-toggle"><summary>Ver tabela</summary>
        <table class="mini-table"><thead><tr><th>Mês</th><th>Saldo</th><th>Rend. mês</th></tr></thead>
        <tbody>${proj.map((r) => `<tr><td>${monthShortYear(r.ym)}</td><td>${money(r.balance)}</td><td>${money(r.monthGain)}</td></tr>`).join('')}</tbody></table>
      </details>
    </section>

    ${hist.length >= 2 ? `
    <section class="card">
      <div class="card-head"><h2>Evolução do cofrinho</h2><span class="muted">${hist.length} registros</span></div>
      <div class="chart-box"><canvas id="ch-hist" role="img" aria-label="Histórico do saldo do cofrinho"></canvas></div>
    </section>` : ''}

    <p class="disclaimer">Estimativas. O CDI muda com a Selic; IR regressivo e IOF (resgates em menos de 30 dias) incidem só no resgate.</p>
  `;

  const mount = () => {
    const view = $('#view');
    // Edições ficam no rascunho (ui.invDraft) até tocar em "Salvar parâmetros".
    view.querySelectorAll('[data-draft]').forEach((el) => {
      const update = (ev) => {
        const key = el.dataset.draft;
        if (el.type === 'checkbox') draft[key] = el.checked;
        else if (el.dataset.type === 'money') { if (ev.type === 'input') draft[key] = maskMoney(el); }
        else draft[key] = parseNumber(el.value);
        $('#inv-dirty').hidden = !isInvDirty();
      };
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    if (!Charts.available()) return;
    Charts.projectionBars('ch-proj', proj.map((r) => monthShortYear(r.ym)), proj.map((r) => r.principal), proj.map((r) => r.gained));
    if (hist.length >= 2) Charts.balanceLine('ch-hist', hist.map((h) => dateBR(h.date).slice(0, 5)), hist.map((h) => h.balance));
  };
  return { html, mount };
}

function syncStatusHtml() {
  const s = Sync.status;
  const when = s.lastSync ? ` · ${new Date(s.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<span class="sync-dot" data-state="${s.state}"></span> ${esc(s.message)}${s.state === 'ok' ? when : ''}`;
}

function viewSettings() {
  const cfg = Sync.getConfig();
  const catList = (kind) => categoriesOf(kind).map((c) => `<button class="row" data-action="edit-cat" data-id="${c.id}">${catDot(c)}<span class="row-main"><span class="row-title">${esc(c.name)}</span></span>${icon('right', 16)}</button>`).join('');
  const d = store.data;

  const lastBackup = getLastBackup();

  const html = `
    <section class="card">
      <div class="card-head"><h2>${icon('download', 18)} Backup em arquivo</h2></div>
      <p class="card-sub">Seus dados ficam só neste aparelho. Exporte um arquivo e guarde no app <strong>Arquivos</strong> (iCloud Drive) para restaurar quando precisar.</p>
      <dl class="kv compact">
        <div><dt>Último backup</dt><dd class="${backupOverdue() ? 'neg' : ''}">${lastBackup ? dateBR(lastBackup) : 'nunca'}</dd></div>
        <div><dt>Conteúdo</dt><dd>${d.transactions.length} pontuais · ${d.recurring.length} fixos · ${d.categories.length} categorias</dd></div>
      </dl>
      <div class="btn-row">
        <button class="btn primary" data-action="export">${icon('download', 16)} Exportar</button>
        <label class="btn soft">${icon('upload', 16)} Importar<input type="file" id="import-file" accept="application/json,.json"></label>
      </div>
      <p class="muted small">Exportar abre o menu de compartilhar: escolha <strong>Salvar em Arquivos</strong>. Importar substitui os dados atuais pelos do arquivo.</p>
    </section>

    <details class="card collapsible" ${Sync.isConfigured(cfg) ? 'open' : ''}>
      <summary class="card-head"><h2>${icon('cloud', 18)} Sincronização com GitHub <span class="badge muted">opcional</span></h2>${icon('right', 16)}</summary>
      <p class="card-sub">Salva automaticamente num repositório <strong>privado</strong>. Útil para usar em mais de um aparelho.</p>
      <div class="form-grid">
        <label class="field"><span>Usuário / dono</span><input class="input" id="s-owner" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(cfg.owner || '')}" placeholder="seu-usuario"></label>
        <label class="field"><span>Repositório</span><input class="input" id="s-repo" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(cfg.repo || '')}" placeholder="stratify-data"></label>
        <label class="field"><span>Branch</span><input class="input" id="s-branch" autocapitalize="off" value="${esc(cfg.branch)}"></label>
        <label class="field"><span>Arquivo</span><input class="input" id="s-path" autocapitalize="off" value="${esc(cfg.path)}"></label>
        <label class="field full"><span>Token (fine-grained, Contents: read & write)</span><input class="input" id="s-token" type="password" autocomplete="off" autocapitalize="off" value="${esc(cfg.token || '')}" placeholder="github_pat_…"></label>
      </div>
      <div class="sync-status" id="sync-status">${syncStatusHtml()}</div>
      <div class="btn-row">
        <button class="btn primary" data-action="sync-save">Salvar e sincronizar</button>
        ${Sync.isConfigured(cfg) ? '<button class="btn ghost" data-action="sync-off">Desconectar</button>' : ''}
      </div>
    </details>

    <section class="group"><div class="group-head"><span>Categorias de despesa</span><button class="link" data-action="add-cat" data-kind="expense">+ Nova</button></div>
      <div class="card rows flush">${catList('expense')}</div></section>
    <section class="group"><div class="group-head"><span>Categorias de receita</span><button class="link" data-action="add-cat" data-kind="income">+ Nova</button></div>
      <div class="card rows flush">${catList('income')}</div></section>

    <section class="card danger">
      <div class="card-head"><h2>Zona de perigo</h2></div>
      <button class="btn danger block" data-action="reset">Apagar todos os dados deste aparelho</button>
    </section>
    <p class="disclaimer">Stratify · dados guardados localmente neste aparelho${Sync.isConfigured(cfg) ? ' e no seu GitHub' : ''}.</p>
  `;
  const mount = () => {
    $('#import-file').addEventListener('change', async (ev) => {
      const input = ev.target;
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.categories)) throw new Error();
        const when = data.updatedAt ? ` (salvo em ${new Date(data.updatedAt).toLocaleString('pt-BR')})` : '';
        const summary = `${(data.transactions || []).length} pontuais e ${(data.recurring || []).length} fixos`;
        if (confirm(`Importar backup com ${summary}${when}?\n\nOs dados atuais deste aparelho serão substituídos.`)) {
          replaceData(data, 'import');
          save();
          toast('Backup importado');
        }
      } catch {
        toast('Arquivo inválido');
      } finally {
        input.value = '';
      }
    });
  };
  return { html, mount };
}

const VIEWS = { home: viewHome, list: viewList, fixed: viewFixed, invest: viewInvest, pending: viewPending, settings: viewSettings };

// Valores "parados" (a receber de alguém, a resgatar, a pagar). Não entram nos totais do mês até virarem lançamento.
const PENDING_LOOK = {
  income: { color: PALETTE[2], icon: 'hand-coins', label: 'A receber', done: 'Recebido', settle: 'Marcar como recebido' },
  expense: { color: PALETTE[1], icon: 'hand-coins', label: 'A pagar', done: 'Pago', settle: 'Marcar como pago' },
};

function viewPending() {
  const all = store.data.pending;
  const open = all.filter((p) => !p.settledAt).sort((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : 1));
  const settled = all.filter((p) => p.settledAt).sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1)).slice(0, 15);
  const sum = (k) => round2(open.filter((p) => p.kind === k).reduce((s, p) => s + p.amount, 0));
  const inc = sum('income'), exp = sum('expense');
  const today = todayISO();

  const row = (p) => {
    const look = PENDING_LOOK[p.kind];
    const late = !p.settledAt && p.due && p.due < today;
    const sub = p.settledAt
      ? `<span class="badge ok">${icon('check', 11)} ${look.done} em ${dateBR(p.settledAt)}</span>`
      : `Desde ${dateBR(p.date)}${p.due ? `<span class="badge ${late ? 'warn' : 'soft'}">${late ? 'Atrasado · ' : 'Previsto '}${dateBR(p.due)}</span>` : ''}`;
    return `<div class="row ${p.settledAt ? 'dim' : ''}" role="button" tabindex="0" data-action="open-pending" data-id="${p.id}">
      ${catDot({ color: look.color, icon: look.icon })}
      <span class="row-main"><span class="row-title">${esc(p.description)}</span><span class="row-sub">${sub}</span></span>
      <span class="row-amount ${p.kind === 'income' ? 'pos' : ''}">${money(p.amount)}</span>
      ${p.settledAt ? '' : `<button class="check-btn" data-action="settle-pending" data-id="${p.id}" aria-label="${look.settle}">${icon('check', 16)}</button>`}
    </div>`;
  };
  const list = (k) => open.filter((p) => p.kind === k);

  const html = `
    <section class="card commit">
      <div class="commit-top"><div><span class="muted">Saldo que ainda volta para você</span><strong class="${inc - exp >= 0 ? 'pos' : ''}">${money(inc - exp)}</strong></div>
        <div class="commit-sums"><span class="pos">+ ${money(inc)}</span><span>− ${money(exp)}</span></div></div>
      <p class="muted small">Empréstimos, resgates e valores pendentes. Não entram nos totais do mês até você lançá-los.</p>
    </section>

    <div class="btn-row">
      <button class="btn soft" data-action="add-pending" data-kind="income">${icon('plus', 16)} A receber</button>
      <button class="btn soft" data-action="add-pending" data-kind="expense">${icon('plus', 16)} A pagar</button>
    </div>

    <section class="group"><div class="group-head"><span>A receber</span><span>${money(inc)}</span></div>
      <div class="card rows flush">${list('income').length ? list('income').map(row).join('') : '<p class="muted pad">Dinheiro emprestado, resgate pendente no banco, reembolso…</p>'}</div></section>

    <section class="group"><div class="group-head"><span>A pagar</span><span>${money(exp)}</span></div>
      <div class="card rows flush">${list('expense').length ? list('expense').map(row).join('') : '<p class="muted pad">Valores que você deve e ainda vai pagar.</p>'}</div></section>

    ${settled.length ? `<section class="group"><div class="group-head"><span>Resolvidos</span></div>
      <div class="card rows flush">${settled.map(row).join('')}</div></section>` : ''}
  `;
  return { html };
}

// ---------------------------------------------------------------- sheet / toast

function openSheet(build, setup) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grabber"></div><div class="sheet-body"></div></div>`;
  const body = $('.sheet-body', root);
  const redraw = () => (body.innerHTML = build());
  redraw();
  setup?.(body, redraw);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => root.classList.add('open'));
}

function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  document.body.classList.remove('sheet-open');
  setTimeout(() => !root.classList.contains('open') && (root.innerHTML = ''), 280);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const moneyValue = (el) => parseInt(el.value.replace(/\D/g, '') || '0', 10) / 100;
function maskMoney(el) {
  const cents = parseInt(el.value.replace(/\D/g, '').slice(0, 11) || '0', 10);
  el.value = cents ? money(cents / 100) : '';
  return cents / 100;
}

// Liga inputs com data-bind ao objeto do formulário.
function bindForm(body, f, redraw) {
  const handle = (ev) => {
    const el = ev.target;
    const key = el.dataset.bind;
    if (!key) return;
    if (el.dataset.type === 'money') { if (ev.type === 'input') f[key] = maskMoney(el); }
    else if (el.type === 'checkbox') f[key] = el.checked;
    else if (el.dataset.type === 'number') f[key] = parseNumber(el.value);
    else f[key] = el.value;
    if (ev.type === 'change' && el.dataset.redraw != null) redraw();
  };
  body.addEventListener('input', handle);
  body.addEventListener('change', handle);
}

const seg = (key, value, options) => `<div class="seg" role="tablist">${options.map(([v, l]) =>
  `<button type="button" class="${value === v ? 'on' : ''}" data-s="set" data-key="${key}" data-value="${v}" role="tab" aria-selected="${value === v}">${l}</button>`).join('')}</div>`;

const sheetHead = (title) => `<div class="sheet-head"><h2>${title}</h2><button class="icon-btn sm" data-s="close" aria-label="Fechar">${icon('close', 18)}</button></div>`;

// ---------------------------------------------------------------- forms

const defaultDate = () => (ui.month === currentYM() ? todayISO() : `${ui.month}-01`);

function openEntryForm(opts = {}) {
  const { tx, rec } = opts;
  const isEdit = !!(tx || rec);
  const effective = opts.effective || ui.month;
  const f = tx ? { ...tx, recurring: false }
    : rec ? { ...rec, recurring: true, end: rec.end || '' }
    : { kind: opts.kind || 'expense', recurring: !!opts.recurring, amount: 0, description: '', categoryId: null,
        date: defaultDate(), day: Number(defaultDate().slice(8)), start: ui.month, end: '', ...opts.prefill };
  const fixCategory = () => {
    if (!f.categoryId || categoryById(f.categoryId).kind !== f.kind) f.categoryId = categoriesOf(f.kind)[0]?.id || null;
  };
  fixCategory();

  const title = () => (isEdit ? (f.recurring ? 'Editar fixo' : 'Editar lançamento') : 'Novo lançamento');
  const build = () => `
    ${sheetHead(title())}
    ${!isEdit ? seg('kind', f.kind, [['expense', 'Despesa'], ['income', 'Receita']]) : ''}
    <label class="amount-field ${f.kind}">
      <span>Valor</span>
      <input data-bind="amount" data-type="money" inputmode="numeric" placeholder="R$ 0,00" value="${f.amount ? money(f.amount) : ''}" autocomplete="off">
    </label>
    <label class="field"><span>Descrição</span><input class="input" data-bind="description" value="${esc(f.description)}" placeholder="${f.kind === 'income' ? (f.recurring ? 'Ex.: Salário' : 'Ex.: Freela, reembolso') : (f.recurring ? 'Ex.: Aluguel, internet' : 'Ex.: Mercado, Uber')}" enterkeyhint="done"></label>
    <div class="field"><span>Categoria</span>
      <div class="cat-grid">${categoriesOf(f.kind).map((c) => `<button type="button" class="cat-pick ${f.categoryId === c.id ? 'on' : ''}" data-s="cat" data-id="${c.id}" style="--c:${c.color}"><span>${catGlyph(c.icon, 20)}</span>${esc(c.name)}</button>`).join('')}</div>
    </div>
    ${!isEdit ? `<label class="switch"><input type="checkbox" data-bind="recurring" data-redraw ${f.recurring ? 'checked' : ''}><span class="switch-ui"></span><span>${f.kind === 'income' ? 'Receita fixa (todo mês)' : 'Conta fixa (todo mês)'}</span></label>` : ''}
    ${f.recurring ? `
      <div class="form-grid">
        <label class="field"><span>${f.kind === 'income' ? 'Dia que cai' : 'Dia do vencimento'}</span><input class="input" data-bind="day" data-type="number" inputmode="numeric" value="${f.day}"></label>
        <label class="field"><span>Começa em</span><input class="input" type="month" data-bind="start" value="${f.start}"></label>
        <label class="field full"><span>Termina em (opcional)</span><input class="input" type="month" data-bind="end" value="${f.end || ''}"></label>
      </div>`
    : `<label class="field"><span>Data</span><input class="input" type="date" data-bind="date" value="${f.date}"></label>`}
    <button class="btn primary block lg" data-s="save">Salvar</button>
    ${tx ? `<button class="btn danger-ghost block" data-s="delete-tx">Excluir lançamento</button>` : ''}
    ${rec ? `<div class="btn-row">
        <button class="btn ghost" data-s="end-rec">Encerrar a partir de ${monthShortYear(effective)}</button>
        <button class="btn danger-ghost" data-s="delete-rec">Excluir de todos os meses</button></div>` : ''}
  `;

  openSheet(build, (body, redraw) => {
    bindForm(body, f, redraw);
    body.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-s]');
      if (!el) return;
      const a = el.dataset.s;
      if (a === 'close') return closeSheet();
      if (a === 'set') { f[el.dataset.key] = el.dataset.value; fixCategory(); return redraw(); }
      if (a === 'cat') { f.categoryId = el.dataset.id; body.querySelectorAll('.cat-pick').forEach((b) => b.classList.toggle('on', b === el)); return; }
      if (a === 'save') return saveEntry(f, { tx, rec, effective });
      if (a === 'delete-tx' && confirm('Excluir este lançamento?')) {
        store.data.transactions = store.data.transactions.filter((t) => t.id !== tx.id);
        return done('Lançamento excluído');
      }
      if (a === 'end-rec') {
        rec.end = addMonths(effective, -1);
        if (rec.end < rec.start) return deleteRecurring(rec.id, 'Fixo removido');
        return done(`Encerrado em ${monthShortYear(rec.end)}`);
      }
      if (a === 'delete-rec' && confirm('Excluir este fixo de todos os meses (inclusive histórico)?')) return deleteRecurring(rec.id, 'Fixo excluído');
    });
    if (!isEdit) setTimeout(() => body.querySelector('[data-bind="amount"]')?.focus(), 350);
  });
}

function done(msg) {
  save();
  closeSheet();
  toast(msg);
}

function deleteRecurring(id, msg) {
  store.data.recurring = store.data.recurring.filter((r) => r.id !== id);
  for (const k of Object.keys(store.data.recurringStatus)) if (k.startsWith(id + '|')) delete store.data.recurringStatus[k];
  done(msg);
}

function saveEntry(f, { tx, rec, effective }) {
  if (!(f.amount > 0)) return toast('Informe um valor');
  const description = (f.description || '').trim() || categoryById(f.categoryId).name;
  const base = { kind: f.kind, description, amount: round2(f.amount), categoryId: f.categoryId };

  if (f.recurring) {
    const day = Math.round(f.day);
    if (!(day >= 1 && day <= 31)) return toast('Dia deve ser entre 1 e 31');
    if (!f.start) return toast('Informe o mês de início');
    if (f.end && f.end < f.start) return toast('O término é antes do início');
    const fields = { ...base, day, start: f.start, end: f.end || null };
    if (!rec) store.data.recurring.push({ id: uid(), ...fields });
    else applyRecurringEdit(rec, fields, effective);
  } else {
    if (!f.date) return toast('Informe a data');
    if (tx) Object.assign(store.data.transactions.find((t) => t.id === tx.id), { ...base, date: f.date });
    else store.data.transactions.push({ id: uid(), ...base, date: f.date });
  }
  done('Salvo');
}

// Mudanças de valor num fixo antigo podem valer só daqui pra frente (preserva o histórico).
function applyRecurringEdit(rec, fields, effective) {
  const valueChanged = fields.amount !== rec.amount || fields.day !== rec.day || fields.categoryId !== rec.categoryId;
  const canSplit = valueChanged && fields.start === rec.start && rec.start < effective && (!fields.end || fields.end >= effective);
  if (canSplit && confirm(`Aplicar a partir de ${monthLabel(effective)}?\n\nOK: meses anteriores mantêm o valor antigo.\nCancelar: altera todos os meses.`)) {
    const next = { ...fields, id: uid(), start: effective };
    rec.end = addMonths(effective, -1);
    rec.description = fields.description;
    for (const [k, v] of Object.entries(store.data.recurringStatus)) {
      const [id, ym] = k.split('|');
      if (id === rec.id && ym >= effective) {
        store.data.recurringStatus[`${next.id}|${ym}`] = v;
        delete store.data.recurringStatus[k];
      }
    }
    store.data.recurring.push(next);
  } else {
    Object.assign(rec, fields);
  }
}

function openOccurrence(recId, ym) {
  const rec = store.data.recurring.find((r) => r.id === recId);
  if (!rec) return;
  const isInc = rec.kind === 'income';
  const f = { amount: getStatus(rec.id, ym).amount ?? rec.amount };

  const build = () => {
    const st = getStatus(rec.id, ym);
    const cat = categoryById(rec.categoryId);
    const amount = st.amount ?? rec.amount;
    return `
      ${sheetHead(esc(rec.description))}
      <div class="occ">
        ${catDot(cat, 'lg')}
        <div><div class="occ-amount ${isInc ? 'pos' : ''}">${money(amount)}</div>
        <div class="muted">${esc(cat.name)} · dia ${rec.day} · ${monthLabel(ym)}</div></div>
      </div>
      ${st.skip ? '<p class="note">Este mês está marcado como pulado: não entra nos totais.</p>' : `
      <button class="btn ${st.paid ? 'soft' : 'primary'} block lg" data-s="paid">${st.paid ? `${icon('check', 18)} ${isInc ? 'Recebido' : 'Pago'} · desfazer` : `Marcar como ${isInc ? 'recebido' : 'pago'}`}</button>
      <div class="field"><span>Valor só em ${monthShortYear(ym)}</span>
        <div class="inline"><input class="input" data-bind="amount" data-type="money" inputmode="numeric" value="${money(f.amount)}"><button class="btn soft" data-s="amount">Aplicar</button></div>
        ${st.amount != null ? `<button class="link" data-s="reset-amount">Voltar ao valor padrão (${money(rec.amount)})</button>` : ''}
      </div>`}
      <div class="btn-row">
        <button class="btn ghost" data-s="skip">${st.skip ? 'Incluir neste mês' : 'Pular este mês'}</button>
        <button class="btn ghost" data-s="edit">${icon('edit', 16)} Editar fixo</button>
      </div>`;
  };

  openSheet(build, (body, redraw) => {
    bindForm(body, f, redraw);
    body.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-s]');
      if (!el) return;
      const a = el.dataset.s;
      const st = getStatus(rec.id, ym);
      if (a === 'close') return closeSheet();
      if (a === 'paid') { setStatus(rec.id, ym, { paid: !st.paid }); save(); return redraw(); }
      if (a === 'amount') {
        if (!(f.amount > 0)) return toast('Informe um valor');
        setStatus(rec.id, ym, { amount: f.amount === rec.amount ? undefined : round2(f.amount) });
        save(); toast('Valor do mês ajustado'); return redraw();
      }
      if (a === 'reset-amount') { setStatus(rec.id, ym, { amount: undefined }); f.amount = rec.amount; save(); return redraw(); }
      if (a === 'skip') { setStatus(rec.id, ym, { skip: !st.skip, paid: undefined }); save(); return redraw(); }
      if (a === 'edit') { closeSheet(); setTimeout(() => openEntryForm({ rec, effective: ym }), 260); }
    });
  });
}

function openPendingForm(item, kind) {
  const f = item ? { ...item, due: item.due || '' } : { kind, description: '', amount: 0, date: todayISO(), due: '' };
  const look = () => PENDING_LOOK[f.kind];
  const build = () => `
    ${sheetHead(item ? 'Dinheiro parado' : 'Novo valor parado')}
    ${seg('kind', f.kind, [['income', 'A receber'], ['expense', 'A pagar']])}
    <label class="amount-field ${f.kind}"><span>Valor</span><input data-bind="amount" data-type="money" inputmode="numeric" placeholder="R$ 0,00" value="${f.amount ? money(f.amount) : ''}" autocomplete="off"></label>
    <label class="field"><span>Descrição</span><input class="input" data-bind="description" value="${esc(f.description)}" placeholder="${f.kind === 'income' ? 'Ex.: Emprestado ao João, resgate CDB' : 'Ex.: Devo à Maria'}" enterkeyhint="done"></label>
    <div class="form-grid">
      <label class="field"><span>Desde</span><input class="input" type="date" data-bind="date" value="${f.date}"></label>
      <label class="field"><span>Previsão (opcional)</span><input class="input" type="date" data-bind="due" value="${f.due}"></label>
    </div>
    <button class="btn primary block lg" data-s="save">Salvar</button>
    ${item && !item.settledAt ? `<div class="btn-row">
        <button class="btn soft" data-s="settle">${icon('check', 16)} ${look().done}</button>
        <button class="btn ghost" data-s="settle-post">${look().done} e lançar</button></div>
      <p class="muted small">"${look().done} e lançar" abre um lançamento já preenchido para registrar a ${f.kind === 'income' ? 'receita' : 'despesa'} no mês.</p>` : ''}
    ${item?.settledAt ? '<button class="btn ghost block" data-s="reopen">Reabrir (ainda pendente)</button>' : ''}
    ${item ? '<button class="btn danger-ghost block" data-s="delete">Excluir</button>' : ''}`;

  openSheet(build, (body, redraw) => {
    bindForm(body, f, redraw);
    const valid = () => {
      if (!(f.amount > 0)) return toast('Informe um valor'), false;
      if (!f.description.trim()) return toast('Dê uma descrição'), false;
      if (!f.date) return toast('Informe a data'), false;
      return true;
    };
    const fields = () => ({ kind: f.kind, description: f.description.trim(), amount: round2(f.amount), date: f.date, due: f.due || null });
    const target = () => store.data.pending.find((p) => p.id === item.id);
    body.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-s]');
      if (!el) return;
      const a = el.dataset.s;
      if (a === 'close') return closeSheet();
      if (a === 'set') { f[el.dataset.key] = el.dataset.value; return redraw(); }
      if (a === 'save') {
        if (!valid()) return;
        if (item) Object.assign(target(), fields());
        else store.data.pending.push({ id: uid(), ...fields(), settledAt: null });
        return done('Salvo');
      }
      if (a === 'settle' || a === 'settle-post') {
        if (!valid()) return;
        Object.assign(target(), fields(), { settledAt: todayISO() });
        done(`${look().done} ✓`);
        // Abre o lançamento já preenchido para escolher a categoria e confirmar.
        if (a === 'settle-post') setTimeout(() => openEntryForm({ kind: f.kind, prefill: { amount: round2(f.amount), description: f.description.trim() } }), 260);
        return;
      }
      if (a === 'reopen') { target().settledAt = null; return done('Reaberto'); }
      if (a === 'delete' && confirm('Excluir este valor?')) {
        store.data.pending = store.data.pending.filter((p) => p.id !== item.id);
        done('Excluído');
      }
    });
    if (!item) setTimeout(() => body.querySelector('[data-bind="amount"]')?.focus(), 350);
  });
}

function openBalanceForm() {
  const inv = store.data.investments;
  const f = { amount: inv.balance, date: todayISO() };
  openSheet(() => `
    ${sheetHead('Saldo do cofrinho')}
    <p class="card-sub">Informe o saldo que aparece hoje no PicPay. Cada atualização entra no histórico.</p>
    <label class="amount-field"><span>Saldo</span><input data-bind="amount" data-type="money" inputmode="numeric" value="${f.amount ? money(f.amount) : ''}" placeholder="R$ 0,00"></label>
    <label class="field"><span>Data do saldo</span><input class="input" type="date" data-bind="date" value="${f.date}" max="${todayISO()}"></label>
    <button class="btn primary block lg" data-s="save">Salvar saldo</button>`,
  (body, redraw) => {
    bindForm(body, f, redraw);
    body.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-s]')?.dataset.s;
      if (a === 'close') return closeSheet();
      if (a !== 'save') return;
      if (!f.date) return toast('Informe a data');
      if (f.date >= (inv.balanceDate || '')) Object.assign(inv, { balance: round2(f.amount), balanceDate: f.date });
      inv.history = inv.history.filter((h) => h.date !== f.date).concat({ date: f.date, balance: round2(f.amount) });
      done('Saldo atualizado');
    });
  });
}

function openCategoryGoalsForm() {
  const goals = store.data.goals;
  // A categoria "Outros" já é o próprio balde de "Outros", então não ganha campo separado.
  const cats = categoriesOf('expense').filter((c) => c.name.trim().toLowerCase() !== 'outros');
  const f = { others: goals.others || 0 };
  for (const c of cats) f[c.id] = goals.byCategory[c.id] || 0;
  const field = (key, label, glyph, color) => `<label class="budget-field">
      <span class="cat-dot" style="--c:${color}" aria-hidden="true">${catGlyph(glyph, 18)}</span>
      <span class="budget-label">${label}</span>
      <input class="input" data-bind="${key}" data-type="money" inputmode="numeric" placeholder="Sem meta" value="${f[key] ? money(f[key]) : ''}" autocomplete="off">
    </label>`;
  openSheet(() => `
    ${sheetHead('Metas por categoria')}
    <p class="card-sub">Limite de gasto por mês. Deixe em branco para a categoria entrar em "Outros".</p>
    <div class="budget-form">
      ${cats.map((c) => field(c.id, esc(c.name), c.icon, c.color)).join('')}
      ${field('others', 'Outros <span class="muted small">+ sem meta</span>', 'circle-ellipsis', NEUTRAL)}
    </div>
    <button class="btn primary block lg" data-s="save">Salvar metas</button>`,
  (body, redraw) => {
    bindForm(body, f, redraw);
    body.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-s]')?.dataset.s;
      if (a === 'close') return closeSheet();
      if (a !== 'save') return;
      goals.byCategory = Object.fromEntries(cats.filter((c) => f[c.id] > 0).map((c) => [c.id, round2(f[c.id])]));
      goals.others = round2(f.others || 0);
      done('Metas salvas');
    });
  });
}

function openGoalForm() {
  const goals = store.data.goals;
  const f = { amount: goals.monthlySurplus || 0 };
  const recent = Array.from({ length: 3 }, (_, i) => monthTotals(addMonths(currentYM(), -1 - i)).balance);
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  openSheet(() => `
    ${sheetHead('Meta de sobra mensal')}
    <p class="card-sub">Quanto você quer que sobre por mês depois de todas as despesas. Média dos últimos 3 meses: <strong>${money(avg)}</strong>.</p>
    <label class="amount-field"><span>Meta</span><input data-bind="amount" data-type="money" inputmode="numeric" value="${f.amount ? money(f.amount) : ''}" placeholder="R$ 0,00"></label>
    <button class="btn primary block lg" data-s="save">Salvar meta</button>
    ${goals.monthlySurplus ? '<button class="btn danger-ghost block" data-s="remove">Remover meta</button>' : ''}`,
  (body, redraw) => {
    bindForm(body, f, redraw);
    body.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-s]')?.dataset.s;
      if (a === 'close') return closeSheet();
      if (a === 'save') {
        if (!(f.amount > 0)) return toast('Informe um valor');
        goals.monthlySurplus = round2(f.amount);
        return done('Meta salva');
      }
      if (a === 'remove') { goals.monthlySurplus = 0; done('Meta removida'); }
    });
    setTimeout(() => body.querySelector('[data-bind="amount"]')?.focus(), 350);
  });
}

// Cores extras oferecidas no formulário de categoria, além da paleta padrão e do seletor livre.
const EXTRA_COLORS = ['#0ea5e9', '#14b8a6', '#84cc16', '#a855f7', '#be185d', '#92400e', '#334155'];

function openCategoryForm(cat, kind) {
  const f = cat ? { ...cat } : { name: '', icon: 'tag', color: PALETTE[0], kind };
  const colors = [...PALETTE, ...EXTRA_COLORS, NEUTRAL];
  const isCustom = () => !colors.includes(f.color);
  // Seleção de cor/ícone só atualiza a prévia, para não perder o foco do campo de nome.
  const refreshPreview = (body) => {
    body.querySelector('.cat-preview').outerHTML = catDot(f, 'lg cat-preview');
    body.querySelectorAll('.swatch-btn').forEach((b) => b.classList.toggle('on', b.dataset.c === f.color));
    const custom = body.querySelector('.swatch-custom');
    custom.classList.toggle('on', isCustom());
    custom.style.setProperty('--c', f.color);
    body.querySelectorAll('.icon-pick').forEach((b) => b.classList.toggle('on', b.dataset.icon === f.icon));
    body.querySelector('.icon-gallery').style.setProperty('--c', f.color);
  };
  openSheet(() => `
    ${sheetHead(cat ? 'Editar categoria' : 'Nova categoria')}
    <div class="cat-head">
      ${catDot(f, 'lg cat-preview')}
      <label class="field"><span>Nome</span><input class="input" data-bind="name" value="${esc(f.name)}" placeholder="Ex.: Pets"></label>
    </div>
    <div class="field"><span>Cor</span><div class="swatches">${colors.map((c) => `<button type="button" class="swatch-btn ${f.color === c ? 'on' : ''}" style="background:${c}" data-s="color" data-c="${c}" aria-label="Cor ${c}"></button>`).join('')}
      <label class="swatch-btn swatch-custom ${isCustom() ? 'on' : ''}" style="--c:${f.color}" title="Escolher outra cor">
        <input type="color" class="color-input" value="${f.color}" aria-label="Escolher outra cor">
      </label></div></div>
    <div class="field"><span>Ícone</span>
      <div class="icon-gallery" style="--c:${f.color}">
        ${ICON_GROUPS.map((g) => `<div class="icon-group-label">${g.label}</div>
          <div class="icon-grid">${g.icons.map((n) => `<button type="button" class="icon-pick ${f.icon === n ? 'on' : ''}" data-s="icon" data-icon="${n}" aria-label="${n}">${catGlyph(n, 22)}</button>`).join('')}</div>`).join('')}
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn primary block lg" data-s="save">Salvar</button>
      ${cat ? '<button class="btn danger-ghost block" data-s="delete">Excluir categoria</button>' : ''}
    </div>`,
  (body, redraw) => {
    bindForm(body, f, redraw);
    body.querySelector('.color-input').addEventListener('input', (ev) => { f.color = ev.target.value; refreshPreview(body); });
    body.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-s]');
      if (!el) return;
      const a = el.dataset.s;
      if (a === 'close') return closeSheet();
      if (a === 'color') { f.color = el.dataset.c; return refreshPreview(body); }
      if (a === 'icon') { f.icon = el.dataset.icon; return refreshPreview(body); }
      if (a === 'save') {
        if (!f.name.trim()) return toast('Dê um nome à categoria');
        f.name = f.name.trim();
        if (cat) Object.assign(store.data.categories.find((c) => c.id === cat.id), f);
        else store.data.categories.push({ ...f, id: uid() });
        return done('Categoria salva');
      }
      if (a === 'delete') {
        const used = store.data.transactions.some((t) => t.categoryId === cat.id) || store.data.recurring.some((r) => r.categoryId === cat.id);
        if (!confirm(used ? 'Há lançamentos nesta categoria; eles ficarão "Sem categoria". Excluir?' : 'Excluir categoria?')) return;
        store.data.categories = store.data.categories.filter((c) => c.id !== cat.id);
        done('Categoria excluída');
      }
    });
  });
}

// ---------------------------------------------------------------- actions

const BACKUP_KEY = 'stratify:last-backup';
const getLastBackup = () => localStorage.getItem(BACKUP_KEY);
const backupOverdue = () => {
  const last = getLastBackup();
  const hasData = store.data.transactions.length + store.data.recurring.length > 0;
  return hasData && (!last || (Date.now() - new Date(last + 'T12:00:00')) / 864e5 > 30);
};
function markBackup() {
  localStorage.setItem(BACKUP_KEY, todayISO());
  render();
  toast('Backup exportado');
}

// No iPhone abre a folha de compartilhamento (Salvar em Arquivos); fora dele, baixa o arquivo.
async function exportData() {
  const name = `stratify-backup-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return markBackup();
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  markBackup();
}

const actions = {
  nav: (el) => {
    if (el.dataset.view === ui.view) return window.scrollTo({ top: 0, behavior: 'smooth' });
    if (isInvDirty() && !confirm('Há parâmetros de rendimento não salvos. Descartar?')) return;
    ui.invDraft = null;
    if (el.dataset.view === 'settings') ui.prevView = ui.view;
    ui.view = el.dataset.view;
    render({ keepScroll: false });
  },
  back: () => { ui.view = ui.prevView || 'home'; render({ keepScroll: false }); },
  month: (el) => {
    const step = Number(el.dataset.step);
    ui.month = step ? addMonths(ui.month, step) : currentYM();
    render({ keepScroll: false });
  },
  add: () => openEntryForm({}),
  'add-fixed': (el) => openEntryForm({ recurring: true, kind: el.dataset.kind }),
  'open-entry': (el) => {
    const [type, id, ym] = el.dataset.id.split(':');
    if (type === 't') openEntryForm({ tx: store.data.transactions.find((t) => t.id === id) });
    else openOccurrence(id, ym);
  },
  'add-pending': (el) => openPendingForm(null, el.dataset.kind),
  'open-pending': (el) => openPendingForm(store.data.pending.find((p) => p.id === el.dataset.id)),
  'settle-pending': (el) => {
    const p = store.data.pending.find((x) => x.id === el.dataset.id);
    p.settledAt = todayISO();
    save();
    toast(`${PENDING_LOOK[p.kind].done} ✓`);
  },
  'open-rec': (el) => openOccurrence(el.dataset.rec, ui.month),
  'edit-rec': (el) => {
    const rec = store.data.recurring.find((r) => r.id === el.dataset.rec);
    openEntryForm({ rec, effective: rec.start > ui.month ? rec.start : ui.month });
  },
  'toggle-paid': (el) => {
    const st = getStatus(el.dataset.rec, el.dataset.ym);
    setStatus(el.dataset.rec, el.dataset.ym, { paid: !st.paid });
    save();
    toast(st.paid ? 'Marcado como pendente' : 'Pago ✓');
  },
  filter: (el) => { ui.filter = el.dataset.filter; render(); },
  'cat-filter': (el) => { ui.catFilter = el.dataset.id; render(); },
  'bar-preset': (el) => { ui.barPreset = el.dataset.preset; ui.barShift = 0; render(); },
  'bar-shift': (el) => { ui.barShift += Number(el.dataset.step); render(); },
  horizon: (el) => { ui.horizon = Number(el.dataset.h); render(); },
  'update-balance': () => openBalanceForm(),
  'inv-mode': (el) => { ui.invDraft.depositMode = el.dataset.mode; render(); },
  'inv-save': () => saveInvParams(),
  'edit-goal': () => openGoalForm(),
  'edit-cat-goals': () => openCategoryGoalsForm(),
  'edit-cat': (el) => openCategoryForm(store.data.categories.find((c) => c.id === el.dataset.id)),
  'add-cat': (el) => openCategoryForm(null, el.dataset.kind),
  'close-sheet': () => closeSheet(),
  'dismiss-hint': () => { localStorage.setItem('stratify:hint-dismissed', '1'); render(); },
  'sync-save': () => {
    const v = (id) => $(id).value.trim();
    const cfg = { owner: v('#s-owner'), repo: v('#s-repo'), branch: v('#s-branch') || 'main', path: v('#s-path') || 'stratify-data.json', token: v('#s-token') };
    if (!Sync.isConfigured(cfg)) return toast('Preencha usuário, repositório e token');
    Sync.setConfig(cfg);
    Sync.syncNow().then(() => toast(Sync.status.state === 'ok' ? 'Sincronizado com o GitHub' : Sync.status.message));
  },
  'sync-off': () => {
    if (!confirm('Desconectar do GitHub? Os dados continuam neste aparelho.')) return;
    Sync.setConfig({ branch: 'main', path: 'stratify-data.json' });
    Sync.syncNow();
    render();
  },
  export: () => exportData(),
  reset: () => {
    if (!confirm('Apagar TODOS os dados deste aparelho?')) return;
    if (!confirm('Tem certeza? Faça um backup antes. Se a sincronização estiver ativa, o GitHub também será sobrescrito.')) return;
    resetData();
    toast('Dados apagados');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  ev.preventDefault();
  ev.stopPropagation();
  actions[el.dataset.action](el);
});
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"][data-action]')) {
    ev.preventDefault();
    ev.target.click();
  }
});

// ---------------------------------------------------------------- init

const initialView = location.hash.slice(1);
if (VIEWS[initialView]) ui.view = initialView;
subscribe(() => render());
Sync.onStatus(updateSyncDot);
render({ keepScroll: false });
Sync.initSync();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
