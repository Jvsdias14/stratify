// Sincronização opcional com um arquivo JSON num repositório PRIVADO do GitHub (API de conteúdos).
import { store, replaceData, subscribe } from './store.js';

const CFG_KEY = 'stratify:sync';
const API = 'https://api.github.com';

let sha = null;
let pushTimer = null;
let busy = false;
const statusListeners = new Set();

export const status = { state: 'off', message: 'Sincronização desativada', lastSync: null };

function setStatus(state, message) {
  Object.assign(status, { state, message });
  if (state === 'ok') status.lastSync = new Date().toISOString();
  statusListeners.forEach((fn) => fn(status));
}
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));

export function getConfig() {
  try {
    return { branch: 'main', path: 'stratify-data.json', ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') };
  } catch {
    return { branch: 'main', path: 'stratify-data.json' };
  }
}
export function setConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  sha = null;
}
export const isConfigured = (c = getConfig()) => !!(c.owner && c.repo && c.token && c.path);

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function request(cfg, method = 'GET', body, accept = 'application/vnd.github+json') {
  const url = `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path
    .split('/').map(encodeURIComponent).join('/')}` + (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}` : '');
  return fetch(url, {
    method,
    cache: 'no-store',
    headers: {
      Accept: accept,
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function explain(res) {
  if (res.status === 401) return 'Token inválido ou expirado';
  if (res.status === 403) return 'Token sem permissão de escrita (Contents: Read and write)';
  if (res.status === 404) return 'Repositório não encontrado (confira dono/nome e o acesso do token)';
  const j = await res.json().catch(() => ({}));
  return j.message || `Erro ${res.status}`;
}

async function pull(cfg) {
  const res = await request(cfg);
  if (res.status === 404) {
    // Arquivo ainda não existe? Confirma que o repo é acessível.
    const repo = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: { Authorization: `Bearer ${cfg.token}` }, cache: 'no-store' });
    if (!repo.ok) throw new Error(await explain(repo));
    sha = null;
    return null;
  }
  if (!res.ok) throw new Error(await explain(res));
  const meta = await res.json();
  sha = meta.sha;
  let text;
  if (meta.content) text = b64decode(meta.content);
  else {
    const raw = await request(cfg, 'GET', null, 'application/vnd.github.raw+json'); // arquivos > 1 MB
    if (!raw.ok) throw new Error(await explain(raw));
    text = await raw.text();
  }
  return JSON.parse(text);
}

async function push(cfg, retry = true) {
  const body = {
    message: `Stratify: atualização ${new Date().toLocaleString('pt-BR')}`,
    content: b64encode(JSON.stringify(store.data, null, 1)),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  };
  const res = await request(cfg, 'PUT', body);
  if ((res.status === 409 || res.status === 422) && retry) {
    // SHA desatualizado: busca o atual e tenta de novo (a versão local é a mais recente).
    const meta = await request(cfg);
    sha = meta.ok ? (await meta.json()).sha : null;
    return push(cfg, false);
  }
  if (!res.ok) throw new Error(await explain(res));
  sha = (await res.json()).content.sha;
}

// Puxa do GitHub; quem tiver updatedAt mais recente vence.
export async function syncNow() {
  const cfg = getConfig();
  if (!isConfigured(cfg)) return setStatus('off', 'Sincronização desativada');
  if (busy) return;
  busy = true;
  setStatus('busy', 'Sincronizando…');
  try {
    const remote = await pull(cfg);
    const localAt = store.data.updatedAt || '';
    const remoteAt = remote?.updatedAt || '';
    if (remote && remoteAt > localAt) replaceData(remote, 'remote');
    else if (!remote || localAt > remoteAt) await push(cfg);
    setStatus('ok', 'Sincronizado');
  } catch (e) {
    setStatus('error', e.message || 'Falha na sincronização');
  } finally {
    busy = false;
  }
}

function schedulePush() {
  if (!isConfigured()) return;
  clearTimeout(pushTimer);
  setStatus('pending', 'Alterações pendentes…');
  pushTimer = setTimeout(flush, 1500);
}

async function flush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (busy) return schedulePush();
  busy = true;
  setStatus('busy', 'Enviando…');
  try {
    if (sha === null) await pull(getConfig()).catch(() => {});
    await push(getConfig());
    setStatus('ok', 'Sincronizado');
  } catch (e) {
    setStatus('error', e.message || 'Falha ao enviar');
  } finally {
    busy = false;
  }
}

export function initSync() {
  subscribe((source) => source === 'local' && schedulePush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pushTimer) flush(); // app indo para segundo plano
    else if (document.visibilityState === 'visible' && !pushTimer) syncNow();
  });
  window.addEventListener('online', () => syncNow());
  syncNow();
}
