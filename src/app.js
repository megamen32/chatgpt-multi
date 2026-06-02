const STORAGE_KEY = 'chatgptMultiPane.v1';
const CHATGPT_HOME = 'https://chatgpt.com/';
const PICKER_URL = 'https://chatgpt.com/?cgpt_picker=1';
const CHAT_PATH_RE = /\/(?:g\/[^/]+\/)?c\/[0-9a-f-]{8,}/i;

const SETTINGS = (window.CGPTMP && window.CGPTMP.settings) || null;
const SETTINGS_KEY = SETTINGS ? SETTINGS.STORAGE_KEY : 'cgptMultiPane.settings.v1';

const state = {
  panes: [],
  focusedId: null,
  loaded: new Set(), // ids whose iframe is actually mounted (lazy loading)
  settings: SETTINGS ? { ...SETTINGS.DEFAULTS } : { lazyPanes: true, syncPaneTitles: true },
};
const app = document.getElementById('app');

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function normalizeUrl(url) { try { const u = new URL(url, CHATGPT_HOME); u.hash = ''; return u.toString(); } catch { return CHATGPT_HOME; } }
function isChatUrl(url) { try { return CHAT_PATH_RE.test(new URL(url).pathname); } catch { return false; } }
function inferTitle(url, fallback = 'ChatGPT') {
  try {
    const u = new URL(url);
    if (u.searchParams.get('cgpt_picker') === '1') return '+ Выбор чата';
    const m = u.pathname.match(/\/c\/([0-9a-f-]{8})/i);
    if (m) return `Chat ${m[1]}`;
  } catch {}
  return fallback;
}

function save() { chrome.storage.local.set({ [STORAGE_KEY]: { panes: state.panes, focusedId: state.focusedId } }); }
function load() {
  return new Promise(resolve => chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], res => resolve(res || {})));
}

function defaultPane() { return { id: uid(), title: 'ChatGPT', url: CHATGPT_HOME, picker: false }; }
function isLazy() { return !!state.settings.lazyPanes; }
function ensureLoaded(id) { state.loaded.add(id); }

function addPane(url = PICKER_URL, picker = true, title = null) {
  const pane = { id: uid(), title: title || inferTitle(url), url: normalizeUrl(url), picker };
  state.panes.push(pane);
  state.focusedId = pane.id;
  ensureLoaded(pane.id); // a freshly added pane is the one you want to use now
  save(); render();
}
function closePane(id) {
  const idx = state.panes.findIndex(p => p.id === id);
  if (idx < 0) return;
  state.panes.splice(idx, 1);
  state.loaded.delete(id);
  if (!state.panes.length) { const p = defaultPane(); state.panes.push(p); ensureLoaded(p.id); }
  state.focusedId = state.panes[Math.max(0, Math.min(idx, state.panes.length - 1))].id;
  ensureLoaded(state.focusedId);
  save(); render();
}
function focusPane(id) {
  const wasLoaded = state.loaded.has(id);
  state.focusedId = id;
  ensureLoaded(id);
  save();
  if (wasLoaded) renderTabsOnly(); // no structural change: cheap update
  else render(); // pane needs to mount its iframe now
}
function unloadPane(id) {
  // Free the heavy iframe but keep the pane (lets the user reclaim memory).
  if (!state.loaded.has(id)) return;
  state.loaded.delete(id);
  render();
}
function duplicateFocused() {
  const p = state.panes.find(x => x.id === state.focusedId) || state.panes[0];
  if (p) addPane(p.url, p.picker, `${p.title} copy`);
}
function twoColumns() {
  while (state.panes.length < 2) { const p = defaultPane(); state.panes.push(p); }
  state.focusedId = state.panes[0].id;
  ensureLoaded(state.panes[0].id); ensureLoaded(state.panes[1].id);
  save(); render();
}

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
  if (state.loaded.has(pane.id)) {
    const reload = document.createElement('button'); reload.className = 'pane-btn'; reload.textContent = '↻'; reload.title = 'Reload pane';
    const sleep = document.createElement('button'); sleep.className = 'pane-btn'; sleep.textContent = '☾'; sleep.title = 'Выгрузить (освободить память)';
    const close = document.createElement('button'); close.className = 'pane-btn'; close.textContent = '×'; close.title = 'Close pane';
    head.append(reload, sleep, close);
    reload.addEventListener('click', e => { e.stopPropagation(); const f = head.parentElement.querySelector('iframe'); if (f) f.src = pane.url; });
    sleep.addEventListener('click', e => { e.stopPropagation(); unloadPane(pane.id); });
    close.addEventListener('click', e => { e.stopPropagation(); closePane(pane.id); });
  } else {
    const close = document.createElement('button'); close.className = 'pane-btn'; close.textContent = '×'; close.title = 'Close pane';
    head.append(close);
    close.addEventListener('click', e => { e.stopPropagation(); closePane(pane.id); });
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
  btn.addEventListener('click', e => { e.stopPropagation(); focusPane(pane.id); });
  card.append(t, hint, btn); wrap.append(card);
  wrap.addEventListener('click', () => focusPane(pane.id));
  return wrap;
}

function render() {
  app.replaceChildren();
  const workspace = document.createElement('div'); workspace.className = 'workspace';
  const tabs = document.createElement('div'); tabs.className = 'tabs';
  app.append(workspace, tabs);

  for (const pane of state.panes) {
    const el = document.createElement('section'); el.className = 'pane'; el.dataset.id = pane.id;
    const body = state.loaded.has(pane.id) ? buildLoadedBody(pane) : buildPlaceholderBody(pane);
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
    const t = document.createElement('button'); t.className = `tab ${pane.id === state.focusedId ? 'active' : ''}${state.loaded.has(pane.id) ? '' : ' sleeping'}`;
    t.innerHTML = '<span class="tab-title"></span><span class="tab-close">×</span>';
    t.querySelector('.tab-title').textContent = pane.title;
    t.title = pane.url;
    t.addEventListener('click', () => focusPane(pane.id));
    t.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closePane(pane.id); });
    tabs.append(t);
  }
  const plus = document.createElement('button'); plus.className = 'plus'; plus.textContent = '+'; plus.title = 'Add picker pane'; plus.addEventListener('click', () => addPane(PICKER_URL, true)); tabs.append(plus);
  const two = document.createElement('button'); two.className = 'global-btn'; two.dataset.action = 'two'; two.textContent = '2 panes'; two.addEventListener('click', twoColumns); tabs.append(two);
  const dup = document.createElement('button'); dup.className = 'global-btn'; dup.textContent = 'duplicate'; dup.addEventListener('click', duplicateFocused); tabs.append(dup);
  const opts = document.createElement('button'); opts.className = 'global-btn'; opts.textContent = '⚙'; opts.title = 'Настройки'; opts.addEventListener('click', () => chrome.runtime.openOptionsPage()); tabs.append(opts);
}

// React to settings changes (e.g. toggling lazy mode) without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  const next = SETTINGS ? SETTINGS.withDefaults(changes[SETTINGS_KEY].newValue) : changes[SETTINGS_KEY].newValue || {};
  const wasLazy = isLazy();
  state.settings = next;
  if (wasLazy && !isLazy()) { for (const p of state.panes) ensureLoaded(p.id); render(); }
});

(async function init() {
  const res = await load();
  const saved = res[STORAGE_KEY] || {};
  state.settings = SETTINGS ? SETTINGS.withDefaults(res[SETTINGS_KEY]) : state.settings;
  state.panes = Array.isArray(saved.panes) && saved.panes.length ? saved.panes.slice(0, 8) : [defaultPane()];
  state.focusedId = saved.focusedId && state.panes.some(p => p.id === saved.focusedId) ? saved.focusedId : state.panes[0].id;
  if (isLazy()) ensureLoaded(state.focusedId); // restore: only the focused pane loads eagerly
  else for (const p of state.panes) ensureLoaded(p.id);
  render();
})();
