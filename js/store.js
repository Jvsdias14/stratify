// Estado do app, persistência local (localStorage) e cálculos por mês.
import { uid, todayISO, daysInMonth, pad, round2 } from './utils.js';

const KEY = 'stratify:data';

// Paleta categórica (ordem fixa, validada para daltonismo) + neutro para "Outros".
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const NEUTRAL = '#8a90a2';

function defaults() {
  const exp = [
    ['Moradia', 'house'], ['Alimentação', 'utensils'], ['Transporte', 'car'], ['Saúde', 'pill'],
    ['Lazer', 'party-popper'], ['Assinaturas', 'tv'], ['Compras', 'shopping-bag'], ['Educação', 'book-open'],
  ].map(([name, icon], i) => ({ id: uid(), name, icon, color: PALETTE[i], kind: 'expense' }));
  exp.push({ id: uid(), name: 'Outros', icon: 'package', color: NEUTRAL, kind: 'expense' });
  const inc = [
    ['Salário', 'briefcase', PALETTE[0]], ['Freelance', 'laptop', PALETTE[2]],
    ['Rendimentos', 'trending-up', PALETTE[6]], ['Outros', 'wallet', NEUTRAL],
  ].map(([name, icon, color]) => ({ id: uid(), name, icon, color, kind: 'income' }));

  return {
    version: 1,
    updatedAt: null,
    categories: [...exp, ...inc],
    transactions: [],   // lançamentos pontuais
    recurring: [],      // contas fixas e salário
    recurringStatus: {}, // "recId|YYYY-MM" -> { paid, amount, skip }
    investments: {
      balance: 0,
      balanceDate: todayISO(),
      cdiAnnual: 14.15,
      cdiPercent: 102,
      monthlyDeposit: 0,
      depositDay: 5,
      irRate: 22.5,
      includeSurplus: true,
      history: [],      // [{ date, balance }]
    },
  };
}

// Emojis da primeira versão -> ícones da galeria.
const EMOJI_TO_ICON = {
  '🏠': 'house', '🍽️': 'utensils', '🚗': 'car', '💊': 'pill', '🎉': 'party-popper', '📺': 'tv', '🛍️': 'shopping-bag',
  '📚': 'book-open', '📦': 'package', '💼': 'briefcase', '💻': 'laptop', '📈': 'trending-up', '💰': 'wallet', '🏷️': 'tag',
};

function normalize(data) {
  const base = defaults();
  if (!data || typeof data !== 'object') return base;
  const categories = Array.isArray(data.categories) && data.categories.length ? data.categories : base.categories;
  return {
    ...base,
    ...data,
    categories: categories.map((c) => (EMOJI_TO_ICON[c.icon] ? { ...c, icon: EMOJI_TO_ICON[c.icon] } : c)),
    transactions: data.transactions || [],
    recurring: data.recurring || [],
    recurringStatus: data.recurringStatus || {},
    investments: { ...base.investments, ...(data.investments || {}) },
  };
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return defaults();
  }
}

export const store = { data: load() };
const listeners = new Set();

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function persist(source) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store.data));
  } catch (e) {
    console.error('Falha ao salvar', e);
  }
  listeners.forEach((fn) => fn(source));
}

// Toda alteração local passa por aqui (marca updatedAt para a sincronização).
export function save() {
  store.data.updatedAt = new Date().toISOString();
  persist('local');
}

export function replaceData(next, source = 'remote') {
  store.data = normalize(next);
  persist(source);
}

export function resetData() {
  store.data = defaults();
  save();
}

// ---- Categorias ----

const FALLBACK_CAT = { id: '', name: 'Sem categoria', icon: 'circle-ellipsis', color: NEUTRAL };
export const categoryById = (id) => store.data.categories.find((c) => c.id === id) || FALLBACK_CAT;
export const categoriesOf = (kind) => store.data.categories.filter((c) => c.kind === kind);

// ---- Recorrentes ----

export const recKey = (recId, ym) => `${recId}|${ym}`;
export const getStatus = (recId, ym) => store.data.recurringStatus[recKey(recId, ym)] || {};

export function setStatus(recId, ym, patch) {
  const key = recKey(recId, ym);
  const next = { ...(store.data.recurringStatus[key] || {}), ...patch };
  Object.keys(next).forEach((k) => (next[k] === undefined || next[k] === false) && delete next[k]);
  if (Object.keys(next).length) store.data.recurringStatus[key] = next;
  else delete store.data.recurringStatus[key];
}

export const isActiveIn = (rec, ym) => rec.start <= ym && (!rec.end || rec.end >= ym);

// ---- Visão mensal ----

export function monthEntries(ym, { includeSkipped = false } = {}) {
  const out = [];
  const dim = daysInMonth(ym);
  for (const rec of store.data.recurring) {
    if (!isActiveIn(rec, ym)) continue;
    const st = getStatus(rec.id, ym);
    if (st.skip && !includeSkipped) continue;
    out.push({
      id: `r:${rec.id}:${ym}`,
      source: 'recurring',
      recurringId: rec.id,
      kind: rec.kind,
      description: rec.description,
      amount: st.amount ?? rec.amount,
      categoryId: rec.categoryId,
      date: `${ym}-${pad(Math.min(rec.day, dim))}`,
      paid: !!st.paid,
      skipped: !!st.skip,
      customAmount: st.amount != null,
    });
  }
  for (const tx of store.data.transactions) {
    if (tx.date.slice(0, 7) !== ym) continue;
    out.push({ ...tx, id: `t:${tx.id}`, txId: tx.id, source: 'once', paid: true });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));
}

export function monthTotals(ym) {
  const entries = monthEntries(ym);
  const t = { income: 0, expense: 0, pending: 0, pendingIncome: 0, fixed: 0, variable: 0, byCat: {}, entries };
  for (const e of entries) {
    if (e.kind === 'income') {
      t.income += e.amount;
      if (!e.paid && e.source === 'recurring') t.pendingIncome += e.amount;
    } else {
      t.expense += e.amount;
      if (!e.paid) t.pending += e.amount;
      if (e.source === 'recurring') t.fixed += e.amount;
      else t.variable += e.amount;
      t.byCat[e.categoryId] = (t.byCat[e.categoryId] || 0) + e.amount;
    }
  }
  for (const k of ['income', 'expense', 'pending', 'pendingIncome', 'fixed', 'variable']) t[k] = round2(t[k]);
  t.balance = round2(t.income - t.expense);
  return t;
}

// Gasto acumulado por dia (índice 0 = dia 1).
export function cumulativeExpense(ym, uptoDay = null) {
  const dim = daysInMonth(ym);
  const perDay = new Array(dim).fill(0);
  for (const e of monthEntries(ym)) if (e.kind === 'expense') perDay[Number(e.date.slice(8)) - 1] += e.amount;
  let acc = 0;
  return perDay.map((v, i) => {
    acc += v;
    return uptoDay != null && i + 1 > uptoDay ? null : round2(acc);
  });
}
