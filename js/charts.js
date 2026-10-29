// Wrappers do Chart.js (carregado via CDN como global `Chart`).
import { money, moneyShort } from './utils.js';

export const COLORS = {
  income: '#2a78d6',  // slot 1 (azul)
  expense: '#eb6834', // slot 2 (laranja)
  current: '#2a78d6',
  previous: '#b4bacb',
  principal: '#2a78d6',
  gained: '#1baf7a',
  grid: '#e9ecf4',
  axis: '#d5d9e6',
  muted: '#8a90a2',
  surface: '#ffffff',
};

const instances = new Map();
export const available = () => typeof window.Chart !== 'undefined';

let configured = false;
function setup() {
  if (configured || !available()) return;
  const C = window.Chart;
  C.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  C.defaults.font.size = 11;
  C.defaults.color = COLORS.muted;
  C.defaults.animation.duration = 450;
  C.defaults.plugins.legend.labels.usePointStyle = true;
  C.defaults.plugins.legend.labels.pointStyle = 'rectRounded';
  C.defaults.plugins.legend.labels.boxWidth = 8;
  C.defaults.plugins.legend.labels.boxHeight = 8;
  C.defaults.plugins.legend.labels.color = '#5b6380';
  Object.assign(C.defaults.plugins.tooltip, {
    backgroundColor: '#141a33', padding: 10, cornerRadius: 10, boxPadding: 4,
    titleFont: { weight: '600' }, usePointStyle: true,
  });
  configured = true;
}

function make(id, config) {
  destroy(id);
  const el = document.getElementById(id);
  if (!el || !available()) return;
  setup();
  instances.set(id, new window.Chart(el, config));
}
export function destroy(id) {
  instances.get(id)?.destroy();
  instances.delete(id);
}
export const destroyAll = () => [...instances.keys()].forEach(destroy);

const moneyTooltip = { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` } };

const valueScales = (stacked = false) => ({
  x: { stacked, grid: { display: false }, border: { color: COLORS.axis } },
  y: {
    stacked, beginAtZero: true,
    grid: { color: COLORS.grid }, border: { display: false },
    ticks: { callback: (v) => moneyShort(v), maxTicksLimit: 5 },
  },
});

export function donut(id, items) {
  make(id, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color), borderColor: COLORS.surface, borderWidth: 2, hoverOffset: 4 }],
    },
    options: {
      cutout: '72%', maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)}` } } },
    },
  });
}

// Meses futuros (previsão) ficam com a mesma cor, mais clara.
const faded = (hex) => hex + '66';

export function incomeExpenseBars(id, labels, income, expense, future = []) {
  const fill = (color) => labels.map((_, i) => (future[i] ? faded(color) : color));
  make(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Receitas', data: income, backgroundColor: fill(COLORS.income), borderRadius: 4, categoryPercentage: 0.7, barPercentage: 0.85 },
        { label: 'Despesas', data: expense, backgroundColor: fill(COLORS.expense), borderRadius: 4, categoryPercentage: 0.7, barPercentage: 0.85 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { ...valueScales(), x: { ...valueScales().x, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } } },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { generateLabels: (chart) => window.Chart.defaults.plugins.legend.labels.generateLabels(chart).map((l) => ({ ...l, fillStyle: chart.data.datasets[l.datasetIndex].backgroundColor.find((_, i) => !future[i]) || l.fillStyle })) } },
        tooltip: { ...moneyTooltip, callbacks: { ...moneyTooltip.callbacks, title: (items) => items[0].label + (future[items[0].dataIndex] ? ' (previsão)' : '') } },
      },
    },
  });
}

export function cumulativeLines(id, days, current, previous, labels) {
  make(id, {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        { label: labels[0], data: current, borderColor: COLORS.current, backgroundColor: 'rgba(42,120,214,0.08)', fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: false },
        { label: labels[1], data: previous, borderColor: COLORS.previous, borderDash: [4, 4], borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { ...valueScales(), x: { grid: { display: false }, border: { color: COLORS.axis }, ticks: { maxTicksLimit: 7, maxRotation: 0 } } },
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { ...moneyTooltip, callbacks: { ...moneyTooltip.callbacks, title: (i) => `Dia ${i[0].label}` } },
      },
    },
  });
}

export function projectionBars(id, labels, principal, gained) {
  make(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Aportado', data: principal, backgroundColor: COLORS.principal, borderColor: COLORS.surface, borderWidth: { top: 2 }, borderSkipped: false, borderRadius: 0 },
        { label: 'Rendimentos', data: gained, backgroundColor: COLORS.gained, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: valueScales(true),
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { ...moneyTooltip, callbacks: { ...moneyTooltip.callbacks, footer: (items) => `Total: ${money(items.reduce((s, i) => s + i.parsed.y, 0))}` } },
      },
    },
  });
}

export function balanceLine(id, labels, values) {
  make(id, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Saldo', data: values, borderColor: COLORS.current, backgroundColor: 'rgba(42,120,214,0.08)', fill: true, borderWidth: 2, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: COLORS.current }] },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { ...valueScales(), y: { ...valueScales().y, beginAtZero: false } },
      plugins: { legend: { display: false }, tooltip: moneyTooltip },
    },
  });
}
