// Dias úteis (feriados nacionais), taxa CDI diária e projeções do cofrinho.
import { addDays, addMonths, endOfMonth, daysInMonth, pad, weekday, round2 } from './utils.js';

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}

const holidayCache = new Map();
export function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((md) => `${y}-${md}`);
  const e = easter(y);
  // Carnaval (seg/ter), Sexta-feira Santa e Corpus Christi: sem pregão, sem CDI.
  const movable = [-48, -47, -2, 60].map((n) => addDays(e, n));
  const set = new Set([...fixed, ...movable]);
  holidayCache.set(y, set);
  return set;
}

export function isBusinessDay(iso) {
  const wd = weekday(iso);
  return wd !== 0 && wd !== 6 && !holidays(Number(iso.slice(0, 4))).has(iso);
}

// Dias úteis no intervalo (fromExclusive, toInclusive].
export function businessDaysBetween(fromExclusive, toInclusive) {
  let n = 0;
  for (let d = addDays(fromExclusive, 1); d <= toInclusive; d = addDays(d, 1)) if (isBusinessDay(d)) n++;
  return n;
}

// Taxa diária: fator diário do CDI (base 252) multiplicado pelo % contratado.
export const dailyRate = (cdiAnnual, cdiPercent) => (Math.pow(1 + cdiAnnual / 100, 1 / 252) - 1) * (cdiPercent / 100);
export const effectiveAnnual = (r) => (Math.pow(1 + r, 252) - 1) * 100;

// Simula dia a dia; aportes entram após o rendimento do dia (rendem a partir do próximo dia útil).
export function simulate(balance, fromExclusive, toInclusive, r, deposits = []) {
  let bal = balance, gained = 0, bdays = 0, deposited = 0;
  for (let d = addDays(fromExclusive, 1); d <= toInclusive; d = addDays(d, 1)) {
    if (isBusinessDay(d)) {
      const y = bal * r;
      bal += y;
      gained += y;
      bdays++;
    }
    for (const dep of deposits) if (dep.date === d) { bal += dep.amount; deposited += dep.amount; }
  }
  return { balance: bal, gained, bdays, deposited };
}

const depositDate = (ym, day) => `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;

// Aporte do mês: valor fixo ou percentual da sobra (receitas − despesas) daquele mês.
export function depositFor(inv, surplus) {
  if (inv.depositMode === 'percent') return round2(Math.max(0, surplus) * (inv.depositPercent || 0) / 100);
  return inv.monthlyDeposit > 0 ? inv.monthlyDeposit : 0;
}

// surplusFor(ym) devolve a sobra prevista do mês (usada no modo percentual).
function plannedDeposits(inv, fromExclusive, toInclusive, surplusFor) {
  const out = [];
  for (let ym = fromExclusive.slice(0, 7); ym <= toInclusive.slice(0, 7); ym = addMonths(ym, 1)) {
    const d = depositDate(ym, inv.depositDay);
    const amount = depositFor(inv, surplusFor(ym));
    if (amount > 0 && d > fromExclusive && d <= toInclusive) out.push({ date: d, amount });
  }
  return out;
}

// Previsão até o fim do mês corrente, a partir do último saldo informado.
export function monthForecast(inv, todayISO, surplusFor) {
  const ym = todayISO.slice(0, 7);
  const end = endOfMonth(ym);
  const from = inv.balanceDate && inv.balanceDate <= todayISO ? inv.balanceDate : todayISO;
  const r = dailyRate(inv.cdiAnnual, inv.cdiPercent);
  const deposits = plannedDeposits(inv, from, end, surplusFor);
  const surplus = surplusFor(ym);
  // Aporte planejado do mês sai da sobra; o que restar pode ir ao cofrinho no último dia.
  // (conta mesmo se o aporte já ocorreu antes da última atualização do saldo).
  const plannedThisMonth = depositFor(inv, surplus);
  const extra = inv.includeSurplus ? Math.max(0, surplus - plannedThisMonth) : 0;
  if (extra) deposits.push({ date: end, amount: extra });
  const sim = simulate(inv.balance, from, end, r, deposits);
  const monthBdays = businessDaysBetween(addDays(`${ym}-01`, -1), end);
  return {
    r,
    end,
    from,
    endBalance: round2(sim.balance),
    gained: round2(sim.gained),
    gainedNet: round2(sim.gained * (1 - inv.irRate / 100)),
    deposited: round2(sim.deposited),
    surplusAdded: round2(extra),
    plannedThisMonth: round2(plannedThisMonth),
    remainingBdays: businessDaysBetween(todayISO, end),
    monthBdays,
    perDayNow: round2(inv.balance * r),
    monthRate: (Math.pow(1 + r, monthBdays) - 1) * 100,
    annualRate: effectiveAnnual(r),
  };
}

// Projeção mês a mês após o mês corrente, só com o aporte planejado.
export function projectMonths(inv, startBalance, startYM, months, surplusFor) {
  const r = dailyRate(inv.cdiAnnual, inv.cdiPercent);
  let bal = startBalance, principal = startBalance;
  const rows = [];
  for (let i = 1; i <= months; i++) {
    const ym = addMonths(startYM, i);
    const from = endOfMonth(addMonths(ym, -1));
    const sim = simulate(bal, from, endOfMonth(ym), r, plannedDeposits(inv, from, endOfMonth(ym), surplusFor));
    bal = sim.balance;
    principal += sim.deposited;
    rows.push({ ym, balance: round2(bal), principal: round2(principal), gained: round2(bal - principal), monthGain: round2(sim.gained), deposit: round2(sim.deposited) });
  }
  return rows;
}
