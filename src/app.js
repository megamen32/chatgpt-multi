/*
 * Workspace view layer. State lives in the pure, tested PaneStore
 * (src/lib/pane-store.js); this file only renders it and wires persistence.
 */
const STORAGE_KEY = 'chatgptMultiPane.v1';
const CHAT_PATH_RE = /\/(?:g\/[^/]+\/)?c\/[0-9a-f-]{8,}/i;

const SETTINGS = (window.CGPTMP && window.CGPTMP.settings) || null;
const SETTINGS_KEY = SETTINGS ? SETTINGS.STORAGE_KEY : 'cgptMultiPane.settings.v1';
const { createPaneStore, PICKER_URL } = window.CGPTMP.PaneStore;

const app = document.getElementById('app');

function inferTitle(url, fallback = 'ChatGPT') {
  try {
    const u = new URL(url);
    if (u.searchParams.get('cgpt_picker') === '1') return '+ Выбор чата';
    const m = u.pathname.match(/\/c\/([0-9a-f-]{8})/i);
    if (m) return `Chat ${m[1]}`;
  } catch {}
  return fallback;
}
function normalizeUrl(url) { try { const u = new URL(url, 'https://chatgpt.com/'); u.hash = ''; return u.toString(); } catch { return 'https://chatgpt.com/'; } }
function isChatUrl(url) { try { return CHAT_PATH_RE.test(new URL(url).pathname); } catch { return false; } }

const store = createPaneStore({ inferTitle });
const state = store.state;

function save() { chrome.storage.local.set({ [STORAGE_KEY]: store.snapshot() }); }

function injectPickerCss(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc || doc.getElementById('cgpt-mp-picker-style')) return;
    const s = doc.createElement('style'); s.id = 'cgpt-mp-picker-style';
    s.textContent = `
      html,body{overflow:hidden!important}
      main,[role=main],form,[data-testid=composer-root]{display:none!important}
      nav[aria-label="История чата"],nav[aria-label="Chat history"]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;z-index:2147483647!important;display:flex!important}
    `;
    doc.documentElement.appendChild(s);
  } catch {}
}

function buildPaneHead(pane) {
  const head = document.createElement('div'); head.className = 'pane-head';
  const title = document.createElement('div'); title.className = 'pane-title'; title.textContent = pane.title;
  head.append(title);
  const close = document.createElement('button'); close.className = 'pane-btn'; close.textContent = '×'; close.title = 'Close pane';
  close.addEventListener('click', e => { e.stopPropagation(); store.closePane(pane.id); save(); render(); });
  if (store.isLoaded(pane.id)) {
    const reload = document.createElement('button'); reload.className = 'pane-btn'; reload.textContent = '↻'; reload.title = 'Reload pane';
    const sleep = document.createElement('button'); sleep.className = 'pane-btn'; sleep.textContent = '☾'; sleep.title = 'Выгрузить (освободить память)';
    reload.addEventListener('click', e => { e.stopPropagation(); const f = head.parentElement.querySelector('iframe'); if (f) f.src = pane.url; });
    sleep.addEventListener('click', e => { e.stopPropagation(); store.unloadPane(pane.id); render(); });
    head.append(reload, sleep, close);
  } else {
    head.append(close);
  }
  return head;
}

function buildLoadedBody(pane) {
  const wrap = document.createElement('div'); wrap.className = 'frame-wrap';
  const frame = document.createElement('iframe'); frame.className = 'chat-frame'; frame.src = pane.url;
  frame.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; camera; fullscreen');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  wrap.append(frame);
  if (pane.picker) { const mask = document.createElement('div'); mask.className = 'picker-mask'; wrap.append(mask); }
  frame.addEventListener('load', () => {
    let current; try { current = frame.contentWindow.location.href; } catch { current = frame.src; }
    pane.url = current;
    if (isChatUrl(current)) { pane.picker = false; pane.title = inferTitle(current, pane.title); }
    else { try { if (new URL(current).searchParams.get('cgpt_picker') === '1') { pane.picker = true; pane.title = '+ Выбор чата'; injectPickerCss(frame); } } catch {} }
    save(); renderTabsOnly();
  });
  return wrap;
}

function buildPlaceholderBody(pane) {
  const wrap = document.createElement('div'); wrap.className = 'frame-wrap placeholder';
  const card = document.createElement('div'); card.className = 'ph-card';
  const t = document.createElement('div'); t.className = 'ph-title'; t.textContent = pane.title;
  const hint = document.createElement('div'); hint.className = 'ph-hint'; hint.textContent = pane.picker ? 'Панель выбора чата' : 'Спящая панель';
  const btn = document.createElement('button'); btn.className = 'ph-btn'; btn.textContent = 'Загрузить';
  card.append(t, hint, btn); wrap.append(card);
  const wake = () => { store.focusPane(pane.id); save(); render(); };
  btn.addEventListener('click', e => { e.stopPropagation(); wake(); });
  wrap.addEventListener('click', wake);
  return wrap;
}

function focusPane(id) {
  const { structural } = store.focusPane(id);
  save();
  if (structural) render(); else renderTabsOnly();
}

function render() {
  app.replaceChildren();
  const workspace = document.createElement('div'); workspace.className = 'workspace';
  const tabs = document.createElement('div'); tabs.className = 'tabs';
  app.append(workspace, tabs);

  for (const pane of state.panes) {
    const el = document.createElement('section'); el.className = 'pane'; el.dataset.id = pane.id;
    const body = store.isLoaded(pane.id) ? buildLoadedBody(pane) : buildPlaceholderBody(pane);
    el.append(buildPaneHead(pane), body);
    workspace.append(el);
    el.addEventListener('mousedown', () => { if (state.focusedId !== pane.id) focusPane(pane.id); });
  }
  renderTabsInto(tabs);
  applyFocusOutline();
}
function renderTabsOnly() {
  const tabs = app.querySelector('.tabs'); if (tabs) renderTabsInto(tabs);
  applyFocusOutline();
}
function applyFocusOutline() {
  for (const p of app.querySelectorAll('.pane')) p.style.outline = p.dataset.id === state.focusedId ? '2px solid rgba(16,163,127,.6)' : 'none';
}
function renderTabsInto(tabs) {
  tabs.replaceChildren();
  for (const pane of state.panes) {
    const t = document.createElement('button'); t.className = `tab ${pane.id === state.focusedId ? 'active' : ''}${store.isLoaded(pane.id) ? '' : ' sleeping'}`;
    t.innerHTML = '<span class="tab-title"></span><span class="tab-close">×</span>';
    t.querySelector('.tab-title').textContent = pane.title;
    t.title = pane.url;
    t.addEventListener('click', () => focusPane(pane.id));
    t.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); store.closePane(pane.id); save(); render(); });
    tabs.append(t);
  }
  const plus = document.createElement('button'); plus.className = 'plus'; plus.textContent = '+'; plus.title = 'Add picker pane';
  plus.addEventListener('click', () => { store.addPane(PICKER_URL, true); save(); render(); }); tabs.append(plus);
  const two = document.createElement('button'); two.className = 'global-btn'; two.dataset.action = 'two'; two.textContent = '2 panes';
  two.addEventListener('click', () => { store.twoColumns(); save(); render(); }); tabs.append(two);
  const dup = document.createElement('button'); dup.className = 'global-btn'; dup.textContent = 'duplicate';
  dup.addEventListener('click', () => { const p = store.duplicateFocused(); if (p) { p.url = normalizeUrl(p.url); save(); render(); } }); tabs.append(dup);
  const opts = document.createElement('button'); opts.className = 'global-btn'; opts.textContent = '⚙'; opts.title = 'Настройки';
  opts.addEventListener('click', () => chrome.runtime.openOptionsPage()); tabs.append(opts);
}

// Keep panes in sync with SPA navigation inside their iframes. The pane's
// content script posts {type:'cgptmp:nav', url, title}; we match the source
// window to a pane and update its stored url/title/picker without a reload.
const CHATGPT_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
function paneByContentWindow(win) {
  for (const frame of app.querySelectorAll('iframe.chat-frame')) {
    if (frame.contentWindow === win) {
      const section = frame.closest('.pane');
      const id = section && section.dataset.id;
      return { pane: state.panes.find(p => p.id === id), section };
    }
  }
  return {};
}
window.addEventListener('message', (e) => {
  if (!CHATGPT_ORIGINS.has(e.origin)) return;
  const d = e.data;
  if (!d || d.type !== 'cgptmp:nav') return;
  const { pane, section } = paneByContentWindow(e.source);
  if (!pane) return;
  pane.url = normalizeUrl(d.url);
  let isPicker = false;
  try { isPicker = new URL(d.url).searchParams.get('cgpt_picker') === '1'; } catch {}
  pane.picker = isPicker;
  if (isPicker) pane.title = '+ Выбор чата';
  else if (state.settings && state.settings.syncPaneTitles && d.title) pane.title = d.title;
  else if (isChatUrl(d.url)) pane.title = inferTitle(d.url, pane.title);
  if (section) { const t = section.querySelector('.pane-title'); if (t) t.textContent = pane.title; }
  save();
  renderTabsOnly();
});

// React to settings changes (e.g. toggling lazy mode) without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  const next = SETTINGS ? SETTINGS.withDefaults(changes[SETTINGS_KEY].newValue) : (changes[SETTINGS_KEY].newValue || {});
  const wasLazy = store.isLazy();
  store.setLazy(!!next.lazyPanes);
  state.settings = next;
  if (wasLazy && !store.isLazy()) render();
});

(async function init() {
  const res = await new Promise(r => chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], r));
  const settings = SETTINGS ? SETTINGS.withDefaults(res[SETTINGS_KEY]) : { lazyPanes: true };
  store.init(res[STORAGE_KEY] || null, settings);
  render();
})();
