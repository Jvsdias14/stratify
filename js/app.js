import {
  store, save, subscribe, replaceData, resetData, monthEntries, monthTotals, cumulativeExpense,
  categoryById, categoriesOf, getStatus, setStatus, isActiveIn, PALETTE, NEUTRAL,
} from './store.js';
import { monthForecast, projectMonths } from './finance.js';
import * as Sync from './sync.js';
import * as Charts from './charts.js';
import { icon } from './icons.js';
import {
  uid, money, percent, num, parseNumber, round2, escapeHtml as esc, todayISO, currentYM, addMonths,
  daysInMonth, monthLabel, monthShort, monthShortYear, dayLabel, dateBR,
} from './utils.js';

const ui = { view: 'home', prevView: 'home', month: currentYM(), filter: 'all', horizon: 12, barPreset: 'past', barShift: 0 };

// Janelas do gráfico receitas × despesas: início relativo ao mês selecionado e quantidade de meses.
const BAR_PRESETS = { past: { label: 'Passado', start: -5, span: 6 }, future: { label: 'Futuro', start: 0, span: 6 }, year: { label: '12 meses', start: -5, span: 12 } };
const $ = (s, r = document) => r.querySelector(s);

const TITLES = { home: 'Visão geral', list: 'Lançamentos', fixed: 'Fixos', invest: 'Rendimentos', settings: 'Ajustes' };
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

const catDot = (cat, size = '') => `<span class="cat-dot ${size}" style="--c:${cat.color}" aria-hidden="true">${esc(cat.icon)}</span>`;

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
  if (rest > 0) items.push({ label: 'Demais', value: round2(rest), color: NEUTRAL, icon: '…' });

  const preset = BAR_PRESETS[ui.barPreset];
  const firstMonth = addMonths(ym, preset.start + ui.barShift * preset.span);
  const months = Array.from({ length: preset.span }, (_, i) => addMonths(firstMonth, i));
  const series = months.map((m) => monthTotals(m));
  const future = months.map((m) => m > currentYM());

  const ids = new Set([...Object.keys(t.byCat), ...Object.keys(p.byCat)]);
  const comp = [...ids].map((id) => ({ cat: categoryById(id), cur: t.byCat[id] || 0, prev: p.byCat[id] || 0 })).sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  const maxComp = Math.max(1, ...comp.flatMap((c) => [c.cur, c.prev]));

  const upcoming = t.entries.filter((e) => e.source === 'recurring' && e.kind === 'expense' && !e.paid).sort((a, b) => (a.date < b.date ? -1 : 1));

  const installHint = !navigator.standalone && /iphone|ipad/i.test(navigator.userAgent) && !localStorage.getItem('stratify:hint-dismissed')
    ? `<div class="card hint"><div>${icon('info', 18)}</div><p>Para usar como app: toque em <strong>Compartilhar</strong> no Safari e depois em <strong>Adicionar à Tela de Início</strong>.</p><button class="icon-btn sm" data-action="dismiss-hint" aria-label="Fechar">${icon('close', 16)}</button></div>`
    : '';

  const html = `
    ${installHint}
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
        ${items.map((i) => `<li><span class="swatch" style="background:${i.color}"></span><span class="lg-name">${esc(i.icon)} ${esc(i.label)}</span><span class="lg-val">${money(i.value)}</span><span class="lg-pct">${num((i.value / t.expense) * 100, 0)}%</span></li>`).join('')}
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

    ${comp.length ? `
    <section class="card">
      <div class="card-head"><h2>Mês a mês por categoria</h2><span class="muted">vs ${monthShort(prevYm).toLowerCase()}</span></div>
      <div class="comp-legend"><span><i class="swatch" style="background:${Charts.COLORS.current}"></i>${monthShort(ym)}</span><span><i class="swatch" style="background:${Charts.COLORS.previous}"></i>${monthShort(prevYm)}</span></div>
      <ul class="comp-list">
        ${comp.map((c) => `<li>
          <div class="comp-top"><span>${esc(c.cat.icon)} ${esc(c.cat.name)}</span><span class="comp-val">${money(c.cur)} ${deltaChip(c.cur, c.prev)}</span></div>
          <div class="comp-bar"><i style="width:${(c.cur / maxComp) * 100}%;background:${Charts.COLORS.current}"></i></div>
          <div class="comp-bar prev"><i style="width:${(c.prev / maxComp) * 100}%;background:${Charts.COLORS.previous}"></i></div>
          <div class="comp-prev muted">${monthShort(prevYm)}: ${money(c.prev)}</div>
        </li>`).join('')}
      </ul>
    </section>` : ''}
  `;

  const mount = () => {
    if (!Charts.available()) {
      document.querySelectorAll('.chart-box, .donut-wrap').forEach((b) => (b.innerHTML = '<p class="muted center">Gráficos indisponíveis offline na primeira abertura.</p>'));
      return;
    }
    if (items.length) Charts.donut('ch-donut', items);
    Charts.incomeExpenseBars('ch-bars', months.map(preset.span > 6 ? monthShortYear : monthShort), series.map((s) => s.income), series.map((s) => s.expense), future);
    const dim = Math.max(daysInMonth(ym), daysInMonth(prevYm));
    const upto = isCurrent ? Number(todayISO().slice(8)) : null;
    const cur = cumulativeExpense(ym, upto);
    const prev = cumulativeExpense(prevYm);
    Charts.cumulativeLines('ch-cum', Array.from({ length: dim }, (_, i) => i + 1), cur, prev, [monthShort(ym), monthShort(prevYm)]);
  };
  return { html, mount };
}

function viewList() {
  const t = monthTotals(ui.month);
  const filters = { all: 'Todos', expense: 'Despesas', income: 'Receitas', recurring: 'Fixos', once: 'Pontuais' };
  const entries = t.entries.filter((e) => ui.filter === 'all' || e.kind === ui.filter || e.source === ui.filter);
  const groups = new Map();
  for (const e of entries) groups.set(e.date, [...(groups.get(e.date) || []), e]);

  const html = `
    <div class="chips scroll" role="tablist">
      ${Object.entries(filters).map(([k, v]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-action="filter" data-filter="${k}" role="tab" aria-selected="${ui.filter === k}">${v}</button>`).join('')}
    </div>
    <div class="stat-row two">
      <div class="stat"><span>Receitas</span><strong class="pos">${money(t.income)}</strong></div>
      <div class="stat"><span>Despesas</span><strong>${money(t.expense)}</strong></div>
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

function viewInvest() {
  const inv = store.data.investments;
  const today = todayISO();
  const ym = currentYM();
  const t = monthTotals(ym);
  const fc = monthForecast(inv, today, t.balance);
  const proj = projectMonths(inv, fc.endBalance, ym, ui.horizon);
  const last = proj[proj.length - 1];
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
        <div><dt>Aporte planejado neste mês</dt><dd>${money(fc.plannedThisMonth)}</dd></div>
        <div><dt>Sobra enviada ao cofrinho</dt><dd>${money(fc.surplusAdded)}</dd></div>
        <div><dt>Cofrinho no fim do mês</dt><dd>${money(fc.endBalance)}</dd></div>
        <div><dt>Fica em conta</dt><dd class="${leftover < 0 ? 'neg' : ''}">${money(leftover)}</dd></div>
        <div class="total"><dt>Patrimônio previsto</dt><dd>${money(fc.endBalance + leftover)}</dd></div>
      </dl>
      ${t.pending > 0 ? `<p class="muted small">Inclui ${money(t.pending)} em contas fixas ainda não pagas.</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Parâmetros</h2></div>
      <div class="form-grid">
        <label class="field"><span>CDI anual (%)</span><input class="input" data-inv="cdiAnnual" data-type="number" inputmode="decimal" value="${num(inv.cdiAnnual, 2)}"></label>
        <label class="field"><span>% do CDI</span><input class="input" data-inv="cdiPercent" data-type="number" inputmode="decimal" value="${num(inv.cdiPercent, 2)}"></label>
        <label class="field"><span>Aporte mensal</span><input class="input" data-inv="monthlyDeposit" data-type="money" inputmode="numeric" value="${inv.monthlyDeposit ? money(inv.monthlyDeposit) : ''}" placeholder="R$ 0,00"></label>
        <label class="field"><span>Dia do aporte</span><input class="input" data-inv="depositDay" data-type="number" inputmode="numeric" value="${inv.depositDay}"></label>
        <label class="field full"><span>Alíquota de IR (tempo aplicado)</span>
          <select class="input" data-inv="irRate" data-type="number">${irOptions.map(([v, l]) => `<option value="${v}" ${inv.irRate === v ? 'selected' : ''}>${num(v, 1)}% · ${l}</option>`).join('')}</select></label>
        <label class="switch full"><input type="checkbox" data-inv="includeSurplus" ${inv.includeSurplus ? 'checked' : ''}><span class="switch-ui"></span><span>Guardar no cofrinho a sobra do mês (após o aporte)</span></label>
      </div>
      <p class="muted small">Cofrinho PicPay: ${num(inv.cdiPercent, 0)}% do CDI, rendimento diário em dias úteis (feriados nacionais considerados). Confira o CDI atual e ajuste aqui.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Projeção</h2>
        <div class="seg sm">${[6, 12, 24, 36].map((h) => `<button class="${ui.horizon === h ? 'on' : ''}" data-action="horizon" data-h="${h}">${h}m</button>`).join('')}</div></div>
      <p class="card-sub">Com aporte de ${money(inv.monthlyDeposit)}/mês, em ${monthLabel(last.ym).toLowerCase()} você teria <strong>${money(last.balance)}</strong>, sendo <strong>${money(last.gained)}</strong> de rendimentos (bruto).</p>
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
    view.querySelectorAll('[data-inv]').forEach((el) => {
      if (el.dataset.type === 'money') el.addEventListener('input', () => maskMoney(el));
      el.addEventListener('change', () => {
        const key = el.dataset.inv;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.dataset.type === 'money') v = moneyValue(el);
        else v = parseNumber(el.value);
        if (typeof v === 'number' && !Number.isFinite(v)) return toast('Valor inválido');
        if (key === 'depositDay') v = Math.min(31, Math.max(1, Math.round(v)));
        inv[key] = v;
        save();
      });
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

  const html = `
    <section class="card">
      <div class="card-head"><h2>${icon('cloud', 18)} Sincronização (GitHub)</h2></div>
      <p class="card-sub">Salva seus dados num arquivo JSON de um repositório <strong>privado</strong>. Permite usar em vários aparelhos e mantém histórico de versões.</p>
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
    </section>

    <section class="card">
      <div class="card-head"><h2>Backup</h2></div>
      <p class="card-sub">${d.transactions.length} lançamentos pontuais · ${d.recurring.length} fixos · ${d.categories.length} categorias</p>
      <div class="btn-row">
        <button class="btn soft" data-action="export">${icon('download', 16)} Exportar</button>
        <button class="btn soft" data-action="import">${icon('upload', 16)} Importar</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </section>

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
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.categories)) throw new Error();
        if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
        replaceData(data, 'import');
        save();
        toast('Backup importado');
      } catch {
        toast('Arquivo inválido');
      }
    });
  };
  return { html, mount };
}

const VIEWS = { home: viewHome, list: viewList, fixed: viewFixed, invest: viewInvest, settings: viewSettings };

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
        date: defaultDate(), day: Number(defaultDate().slice(8)), start: ui.month, end: '' };
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
      <div class="cat-grid">${categoriesOf(f.kind).map((c) => `<button type="button" class="cat-pick ${f.categoryId === c.id ? 'on' : ''}" data-s="cat" data-id="${c.id}" style="--c:${c.color}"><span>${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}</div>
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

function openCategoryForm(cat, kind) {
  const f = cat ? { ...cat } : { name: '', icon: '🏷️', color: PALETTE[0], kind };
  const colors = [...PALETTE, NEUTRAL];
  openSheet(() => `
    ${sheetHead(cat ? 'Editar categoria' : 'Nova categoria')}
    <div class="form-grid">
      <label class="field"><span>Emoji</span><input class="input emoji" data-bind="icon" value="${esc(f.icon)}" maxlength="4"></label>
      <label class="field"><span>Nome</span><input class="input" data-bind="name" value="${esc(f.name)}" placeholder="Ex.: Pets"></label>
    </div>
    <div class="field"><span>Cor</span><div class="swatches">${colors.map((c) => `<button type="button" class="swatch-btn ${f.color === c ? 'on' : ''}" style="background:${c}" data-s="color" data-c="${c}" aria-label="Cor ${c}"></button>`).join('')}</div></div>
    <button class="btn primary block lg" data-s="save">Salvar</button>
    ${cat ? '<button class="btn danger-ghost block" data-s="delete">Excluir categoria</button>' : ''}`,
  (body, redraw) => {
    bindForm(body, f, redraw);
    body.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-s]');
      if (!el) return;
      const a = el.dataset.s;
      if (a === 'close') return closeSheet();
      if (a === 'color') { f.color = el.dataset.c; body.querySelectorAll('.swatch-btn').forEach((b) => b.classList.toggle('on', b === el)); return; }
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

async function exportData() {
  const name = `stratify-backup-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup Stratify' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const actions = {
  nav: (el) => {
    if (el.dataset.view === ui.view) return window.scrollTo({ top: 0, behavior: 'smooth' });
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
  'bar-preset': (el) => { ui.barPreset = el.dataset.preset; ui.barShift = 0; render(); },
  'bar-shift': (el) => { ui.barShift += Number(el.dataset.step); render(); },
  horizon: (el) => { ui.horizon = Number(el.dataset.h); render(); },
  'update-balance': () => openBalanceForm(),
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
  import: () => $('#import-file').click(),
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
