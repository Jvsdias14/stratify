// Formatação, datas e pequenos helpers compartilhados.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = (n) => String(n).padStart(2, '0');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const money = (v) => brl.format(Number(v) || 0);
export const moneyShort = (v) => 'R$ ' + compact.format(Number(v) || 0);
export const percent = (v) => pct.format(Number(v) || 0) + '%';
export const num = (v, d = 2) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });

// Aceita "1.234,56", "1234.56", "14,9" etc.
export function parseNumber(str) {
  if (typeof str === 'number') return str;
  let s = String(str ?? '').trim().replace(/[R$%\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}

export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Datas (strings ISO locais "YYYY-MM-DD" e "YYYY-MM") ----

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const currentYM = () => todayISO().slice(0, 7);

export function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const endOfMonth = (ym) => `${ym}-${pad(daysInMonth(ym))}`;

export function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  const t = toUTC(iso);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const weekday = (iso) => toUTC(iso).getUTCDay();

const fmtMonthLong = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtMonthShort = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const monthLabel = (ym) => cap(fmtMonthLong.format(toUTC(ym + '-01')).replace(' de ', ' '));
export const monthShort = (ym) => cap(fmtMonthShort.format(toUTC(ym + '-01')).replace('.', ''));
export const monthShortYear = (ym) => `${monthShort(ym)}/${ym.slice(2, 4)}`;
export const dayLabel = (iso) => cap(fmtDay.format(toUTC(iso)).replace(/\./g, ''));
export const dateBR = (iso) => (iso ? fmtDate.format(toUTC(iso)) : '');
