const STORAGE_KEY = 'chatgptMultiPane.v1';
const CHATGPT_HOME = 'https://chatgpt.com/';
const PICKER_URL = 'https://chatgpt.com/?cgpt_picker=1';
const CHAT_PATH_RE = /\/(?:g\/[^/]+\/)?c\/[0-9a-f-]{8,}/i;

const state = { panes: [], focusedId: null };
const app = document.getElementById('app');

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function cleanTitle(text) { return (text || '').replace(/\s+/g, ' ').trim().replace(/^ChatGPT\s*-\s*/i, '').slice(0, 60) || 'ChatGPT'; }
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
  return new Promise(resolve => chrome.storage.local.get([STORAGE_KEY], res => resolve(res?.[STORAGE_KEY] || {})));
}
function defaultPane() { return { id: uid(), title: 'ChatGPT', url: CHATGPT_HOME, picker: false }; }
function addPane(url = PICKER_URL, picker = true, title = null) {
  const pane = { id: uid(), title: title || inferTitle(url), url: normalizeUrl(url), picker };
  state.panes.push(pane); state.focusedId = pane.id; save(); render();
}
function closePane(id) {
  const idx = state.panes.findIndex(p => p.id === id);
  if (idx < 0) return;
  state.panes.splice(idx, 1);
  if (!state.panes.length) state.panes.push(defaultPane());
  state.focusedId = state.panes[Math.max(0, Math.min(idx, state.panes.length - 1))].id;
  save(); render();
}
function focusPane(id) { state.focusedId = id; save(); renderTabsOnly(); }
function duplicateFocused() {
  const p = state.panes.find(x => x.id === state.focusedId) || state.panes[0];
  if (p) addPane(p.url, p.picker, `${p.title} copy`);
}
function twoColumns() {
  while (state.panes.length < 2) state.panes.push(defaultPane());
  state.focusedId = state.panes[0].id; save(); render();
}

function injectPickerCss(frame) {
  // Best effort. Cross-origin access is normally denied; the extension relies on URL query plus DNR.
  // If access is denied, app still works as full ChatGPT pane.
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

function render() {
  app.replaceChildren();
  const workspace = document.createElement('div'); workspace.className = 'workspace';
  const tabs = document.createElement('div'); tabs.className = 'tabs';
  app.append(workspace, tabs);

  for (const pane of state.panes) {
    const el = document.createElement('section'); el.className = 'pane'; el.dataset.id = pane.id;
    const head = document.createElement('div'); head.className = 'pane-head';
    const title = document.createElement('div'); title.className = 'pane-title'; title.textContent = pane.title;
    const reload = document.createElement('button'); reload.className = 'pane-btn'; reload.textContent = '↻'; reload.title = 'Reload pane';
    const close = document.createElement('button'); close.className = 'pane-btn'; close.textContent = '×'; close.title = 'Close pane';
    head.append(title, reload, close);

    const wrap = document.createElement('div'); wrap.className = 'frame-wrap';
    const frame = document.createElement('iframe'); frame.className = 'chat-frame'; frame.src = pane.url;
    frame.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; camera; fullscreen');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    wrap.append(frame);
    if (pane.picker) { const mask = document.createElement('div'); mask.className = 'picker-mask'; wrap.append(mask); }
    el.append(head, wrap); workspace.append(el);

    el.addEventListener('mousedown', () => focusPane(pane.id));
    reload.addEventListener('click', e => { e.stopPropagation(); frame.src = pane.url; });
    close.addEventListener('click', e => { e.stopPropagation(); closePane(pane.id); });
    frame.addEventListener('load', () => {
      const current = frame.src;
      pane.url = current;
      if (isChatUrl(current)) { pane.picker = false; pane.title = inferTitle(current, pane.title); }
      else if (new URL(current).searchParams.get('cgpt_picker') === '1') { pane.picker = true; pane.title = '+ Выбор чата'; injectPickerCss(frame); }
      save(); renderTabsOnly();
    });
  }

  renderTabsInto(tabs);
}
function renderTabsOnly() {
  const tabs = app.querySelector('.tabs'); if (tabs) renderTabsInto(tabs);
  for (const p of app.querySelectorAll('.pane')) p.style.outline = p.dataset.id === state.focusedId ? '2px solid rgba(16,163,127,.6)' : 'none';
}
function renderTabsInto(tabs) {
  tabs.replaceChildren();
  for (const pane of state.panes) {
    const t = document.createElement('button'); t.className = `tab ${pane.id === state.focusedId ? 'active' : ''}`;
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
}

(async function init() {
  const saved = await load();
  state.panes = Array.isArray(saved.panes) && saved.panes.length ? saved.panes.slice(0, 8) : [defaultPane()];
  state.focusedId = saved.focusedId || state.panes[0].id;
  render();
})();
