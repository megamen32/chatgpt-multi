/*
 * Workspace view layer. State lives in the pure, tested PaneStore
 * (src/lib/pane-store.js); this file renders it, wires persistence, and hosts
 * the goal/Telegram controller.
 *
 * Rendering is reconciling: pane <section> elements (which hold live iframes)
 * are reused and *moved* across renders, never re-created, so reordering /
 * resizing / adding panes never reloads an existing chat.
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
const BOUND_KEY = 'cgptmp.tg.boundTargets';
let boundTargets = {}; // paneId -> { chatId, threadId } : mirror this pane to a TG chat/topic
const boundGen = new Map();
const sectionEls = new Map(); // paneId -> <section>
function saveBound() { chrome.storage.local.set({ [BOUND_KEY]: boundTargets }); }

function save() { chrome.storage.local.set({ [STORAGE_KEY]: store.snapshot() }); }

// ---------- toast ----------
function toast(text) {
  let el = document.getElementById('cgptmp-toast');
  if (!el) { el = document.createElement('div'); el.id = 'cgptmp-toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 6000);
}

// ---------- pane body ----------
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
    else { try { if (new URL(current).searchParams.get('cgpt_picker') === '1') { pane.picker = true; pane.title = '+ Выбор чата'; } } catch {} }
    save(); refreshChrome();
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

// ---------- pane head (per-chat toolbar) ----------
function btn(cls, label, title, on) {
  const b = document.createElement('button'); b.className = 'pane-btn ' + cls; b.textContent = label; b.title = title;
  b.addEventListener('click', e => { e.stopPropagation(); on(e); });
  return b;
}
function buildPaneHead(pane) {
  const head = document.createElement('div'); head.className = 'pane-head'; head.draggable = true;

  const role = goalController ? goalController.roleForPane(pane.id) : null;
  if (role) { const badge = document.createElement('span'); badge.className = 'role-badge ' + role; badge.textContent = role === 'executor' ? 'исполнитель' : 'агент'; head.append(badge); }

  const title = document.createElement('div'); title.className = 'pane-title'; title.textContent = pane.title;
  head.append(title);

  // pick chat — switch this pane to the picker
  head.append(btn('pick', '📋', 'Выбрать чат', () => { store.showPicker(pane.id); save(); render(); }));

  // goal
  const gst = goalController ? goalController.getStatus() : { active: false };
  if (gst.active && gst.executorPaneId === pane.id) {
    head.append(btn('goal active', gst.paused ? '▶' : '⏸', gst.paused ? 'Продолжить Goal' : 'Пауза Goal', () => { gst.paused ? goalController.resume() : goalController.pause(); }));
    head.append(btn('goal', '⏹', 'Остановить Goal', () => goalController.stop()));
  } else if (!gst.active) {
    head.append(btn('goal', '🎯', 'Goal Agent: эта панель — исполнитель', () => startGoalWithExecutor(pane.id)));
  }

  // telegram mirror (per-pane target: chat / forum topic)
  const tgt = boundTargets[pane.id];
  const tgTitle = tgt ? `Telegram: ${tgt.chatId || 'по умолчанию'}${tgt.threadId ? '/' + tgt.threadId : ''} (клик — изменить)` : 'Слать сообщения этой панели в Telegram';
  head.append(btn('tg' + (tgt ? ' on' : ''), '📤', tgTitle, () => configureBoundPane(pane.id)));

  if (store.isLoaded(pane.id)) {
    head.append(btn('', '↻', 'Перезагрузить', () => reloadPane(pane.id)));
    head.append(btn('', '☾', 'Выгрузить (память)', () => { store.unloadPane(pane.id); render(); }));
  }
  head.append(btn('', '×', 'Закрыть', () => { store.closePane(pane.id); save(); render(); }));

  // drag-reorder
  head.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', pane.id); e.dataTransfer.effectAllowed = 'move'; });
  return head;
}

// ---------- sections (reconciling) ----------
function buildSection(pane) {
  const el = document.createElement('section'); el.className = 'pane'; el.dataset.id = pane.id;
  el.append(buildPaneHead(pane), store.isLoaded(pane.id) ? buildLoadedBody(pane) : buildPlaceholderBody(pane));
  el.dataset.loaded = store.isLoaded(pane.id) ? '1' : '0';
  const rez = document.createElement('div'); rez.className = 'pane-resizer'; el.append(rez);
  attachResize(rez, pane.id);
  // focus + drop target
  el.addEventListener('mousedown', () => { if (state.focusedId !== pane.id) { store.focusPane(pane.id); save(); refreshChrome(); } });
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-hint'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hint'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drop-hint');
    const dragged = e.dataTransfer.getData('text/plain');
    if (dragged && store.reorder(dragged, pane.id)) { save(); render(); }
  });
  return el;
}
function syncSectionBody(el, pane) {
  const want = store.isLoaded(pane.id);
  if ((el.dataset.loaded === '1') === want) return;
  const oldBody = el.querySelector('.frame-wrap');
  const newBody = want ? buildLoadedBody(pane) : buildPlaceholderBody(pane);
  if (oldBody) oldBody.replaceWith(newBody); else el.insertBefore(newBody, el.querySelector('.pane-resizer'));
  el.dataset.loaded = want ? '1' : '0';
}

function render() {
  let workspace = app.querySelector('.workspace');
  let tabs = app.querySelector('.tabs');
  if (!workspace) { workspace = document.createElement('div'); workspace.className = 'workspace'; app.append(workspace); }
  if (!tabs) { tabs = document.createElement('div'); tabs.className = 'tabs'; app.append(tabs); }

  // drop sections for removed panes
  for (const [id, el] of sectionEls) {
    if (!state.panes.some(p => p.id === id)) { el.remove(); sectionEls.delete(id); }
  }
  // create/update + place in order (appendChild moves, preserving iframes)
  for (const pane of state.panes) {
    let el = sectionEls.get(pane.id);
    if (!el) { el = buildSection(pane); sectionEls.set(pane.id, el); }
    else { const h = el.querySelector('.pane-head'); if (h) h.replaceWith(buildPaneHead(pane)); syncSectionBody(el, pane); }
    el.style.flexGrow = String(pane.flex || 1);
    workspace.appendChild(el); // move into current order
  }
  renderTabsInto(tabs);
  applyFocusOutline();
}
function refreshChrome() {
  for (const pane of state.panes) {
    const el = sectionEls.get(pane.id);
    if (el) { const h = el.querySelector('.pane-head'); if (h) h.replaceWith(buildPaneHead(pane)); }
  }
  renderTabsOnly();
}
function applyFocusOutline() {
  for (const [id, el] of sectionEls) el.classList.toggle('focused', id === state.focusedId);
}
function reloadPane(id) {
  const el = sectionEls.get(id); if (!el) return;
  const f = el.querySelector('iframe.chat-frame');
  const pane = state.panes.find(p => p.id === id);
  if (f && pane) f.src = pane.url;
}

// ---------- resize ----------
function attachResize(handle, paneId) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = sectionEls.get(paneId);
    const next = el && el.nextElementSibling;
    if (!next) return;
    const nextId = next.dataset.id;
    const startX = e.clientX;
    const w1 = el.getBoundingClientRect().width, w2 = next.getBoundingClientRect().width;
    const f1 = state.panes.find(p => p.id === paneId).flex || 1;
    const f2 = state.panes.find(p => p.id === nextId).flex || 1;
    const totalF = f1 + f2, totalW = w1 + w2;
    document.body.classList.add('resizing');
    function move(ev) {
      const dx = ev.clientX - startX;
      const nw1 = Math.max(60, Math.min(totalW - 60, w1 + dx));
      const ratio = nw1 / totalW;
      store.setFlex(paneId, totalF * ratio);
      store.setFlex(nextId, totalF * (1 - ratio));
      el.style.flexGrow = String(state.panes.find(p => p.id === paneId).flex);
      next.style.flexGrow = String(state.panes.find(p => p.id === nextId).flex);
    }
    function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); save(); }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}

// ---------- tabs / global bar ----------
function focusPane(id) {
  const { structural } = store.focusPane(id);
  save();
  if (structural) render(); else { applyFocusOutline(); renderTabsOnly(); }
}
function renderTabsOnly() { const tabs = app.querySelector('.tabs'); if (tabs) renderTabsInto(tabs); applyFocusOutline(); }
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
  const plus = document.createElement('button'); plus.className = 'plus'; plus.textContent = '+'; plus.title = 'Новая панель (выбор чата)';
  plus.addEventListener('click', () => { store.addPane(PICKER_URL, true); save(); render(); }); tabs.append(plus);

  const gst = goalController ? goalController.getStatus() : { active: false };
  if (gst.active) {
    const chip = document.createElement('span'); chip.className = 'goal-chip';
    chip.textContent = `🎯 ${gst.paused ? 'пауза' : gst.phase === 'awaitingAgent' ? 'оценка' : 'работа'} · ${gst.iterations}`;
    tabs.append(chip);
  }
  const opts = document.createElement('button'); opts.className = 'global-btn'; opts.textContent = '⚙'; opts.title = 'Настройки';
  opts.addEventListener('click', () => chrome.runtime.openOptionsPage()); tabs.append(opts);
}

// ---------- goal / telegram ----------
function startGoalWithExecutor(executorPaneId) {
  const goal = window.prompt('Финальная цель задачи (что должно быть достигнуто):');
  if (!goal || !goal.trim()) return;
  let agent = state.panes.find(p => p.id !== executorPaneId && !p.picker);
  if (!agent) { agent = store.addPane('https://chatgpt.com/', false, 'Агент'); save(); render(); }
  goalController.start({ goal: goal.trim(), executorPaneId, agentPaneId: agent.id });
}
function configureBoundPane(id) {
  const cur = boundTargets[id];
  const def = cur ? `${cur.chatId || ''}${cur.threadId ? '/' + cur.threadId : ''}` : '';
  const ans = window.prompt(
    'Telegram-назначение для этой панели:\n' +
    '• chat_id  или  chat_id/topic_id (для топиков форум-группы)\n' +
    '• пусто = слать в чат по умолчанию из настроек\n' +
    '• "-" = отвязать', def);
  if (ans === null) return;
  const v = ans.trim();
  if (v === '-') delete boundTargets[id];
  else if (v === '') boundTargets[id] = { chatId: null, threadId: null };
  else { const [c, t] = v.split('/'); boundTargets[id] = { chatId: (c || '').trim() || null, threadId: (t || '').trim() || null }; }
  saveBound();
  toast(boundTargets[id] ? '📤 Панель привязана к Telegram' : 'Telegram-зеркало выключено');
  refreshChrome();
}

function paneForTarget(chatId, threadId) {
  for (const [pid, t] of Object.entries(boundTargets)) {
    if (String(t.chatId || '') === String(chatId || '') && String(t.threadId || '') === String(threadId || '')) return pid;
  }
  return null;
}
function tgReply(item, text) {
  chrome.runtime.sendMessage({ type: 'tg-send', text, chatId: item.chatId || undefined, messageThreadId: item.threadId || undefined });
}
function handleStatus(paneId, item) {
  const pane = state.panes.find(p => p.id === paneId);
  if (!pane) { tgReply(item, 'Нет привязанного чата.'); return; }
  store.isLoaded(paneId) || (store.focusPane(paneId), save(), render());
  goalController.cmd(paneId, 'chatStatus').then((st) => {
    const fmt = (t) => t ? new Date(t * 1000).toLocaleString('ru-RU') : '—';
    const ago = (t) => t ? Math.round((Date.now() / 1000 - t) / 60) + ' мин назад' : '—';
    tgReply(item, [
      `📊 ${st.title || pane.title}`,
      `URL: ${pane.url}`,
      `Генерирует сейчас: ${st.generating ? 'да ⏳' : 'нет'}`,
      `Ответ ИИ: ${fmt(st.assistantAt)} (${ago(st.assistantAt)})`,
      `Сообщение юзера: ${fmt(st.userAt)} (${ago(st.userAt)})`,
    ].join('\n'));
  }).catch(() => tgReply(item, 'Не удалось получить статус (панель спит или грузится).'));
}
function handleInbound(items) {
  if (!state.settings.tgEnabled) return;
  for (const it of items) {
    const text = (it.text || '').trim();
    let paneId = paneForTarget(it.chatId, it.threadId);
    if (!paneId) { const st = goalController.getStatus(); paneId = st.active ? st.executorPaneId : state.focusedId; }

    if (/^\/link\b/i.test(text)) {
      const pane = state.panes.find(p => p.id === paneId);
      tgReply(it, pane ? `🔗 ${pane.title}\n${pane.url}` : 'Нет привязанного чата. Нажмите 📤 на нужной панели.');
      continue;
    }
    if (/^\/status\b/i.test(text)) { handleStatus(paneId, it); continue; }
    if (/^\/help\b/i.test(text)) {
      tgReply(it, 'Команды:\n/link — ссылка на чат\n/status — состояние чата\nЛюбой другой текст уходит в очередь чата.');
      continue;
    }
    if (!state.settings.tgInboundToExecutor) continue;
    if (!paneId) { tgReply(it, 'Не настроена панель для этого топика. В ChatGPT нажмите 📤 на нужной панели.'); continue; }
    if (!store.isLoaded(paneId)) { store.focusPane(paneId); save(); render(); }
    goalController.cmd(paneId, 'send', { text }).catch(() => tgReply(it, 'Не удалось доставить сообщение в чат.'));
  }
}

function iframeForPane(paneId) {
  const el = sectionEls.get(paneId);
  return el ? el.querySelector('iframe.chat-frame') : null;
}
function paneByContentWindow(win) {
  for (const [id, el] of sectionEls) {
    const f = el.querySelector('iframe.chat-frame');
    if (f && f.contentWindow === win) return { pane: state.panes.find(p => p.id === id), section: el };
  }
  return {};
}

const goalController = window.CGPTMP.createGoalController({
  getIframe: iframeForPane,
  reloadPane,
  ensureLoaded: (paneId) => { if (!store.isLoaded(paneId)) { store.focusPane(paneId); save(); render(); } },
  getSettings: () => state.settings,
  notify: toast,
  paneIdForSource: (win) => { const { pane } = paneByContentWindow(win); return pane ? pane.id : null; },
  onStatusChange: () => refreshChrome(),
});

// ---------- cross-frame messages ----------
const CHATGPT_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
window.addEventListener('message', (e) => {
  if (!CHATGPT_ORIGINS.has(e.origin)) return;
  const d = e.data;
  if (!d) return;
  goalController.handleMessage(e);

  // Mirror a bound pane's finished turn to its Telegram chat/topic.
  if (d.type === 'cgptmp:gen') {
    const { pane } = paneByContentWindow(e.source);
    if (pane && boundTargets[pane.id]) {
      const was = boundGen.get(pane.id);
      boundGen.set(pane.id, d.generating);
      if (was === true && d.generating === false && state.settings.tgEnabled) {
        const t = boundTargets[pane.id];
        goalController.requestFinalAnswer(pane.id).then((ans) => {
          if (ans) chrome.runtime.sendMessage({ type: 'tg-send', text: ans, chatId: t.chatId || undefined, messageThreadId: t.threadId || undefined });
        });
      }
    }
  }

  if (d.type !== 'cgptmp:nav') return;
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
  save(); renderTabsOnly();
});

// Track focus when the user clicks inside a cross-origin iframe (no mousedown
// bubbles out of it) so the bottom tabs reflect the truly active pane.
window.addEventListener('blur', () => setTimeout(() => {
  const el = document.activeElement;
  if (el && el.tagName === 'IFRAME') {
    const sec = el.closest('.pane');
    if (sec && sec.dataset.id !== state.focusedId) { store.focusPane(sec.dataset.id); save(); applyFocusOutline(); renderTabsOnly(); }
  }
}, 0));

// Telegram inbound -> loop/queue
let inboxSeen = 0;
chrome.storage.local.get(['cgptmp.tg.inbox'], (r) => { inboxSeen = ((r && r['cgptmp.tg.inbox']) || []).length; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SETTINGS_KEY]) {
    const next = SETTINGS ? SETTINGS.withDefaults(changes[SETTINGS_KEY].newValue) : (changes[SETTINGS_KEY].newValue || {});
    const wasLazy = store.isLazy();
    store.setLazy(!!next.lazyPanes);
    state.settings = next;
    if (wasLazy && !store.isLazy()) render();
  }
  if (changes['cgptmp.tg.inbox']) {
    const list = changes['cgptmp.tg.inbox'].newValue || [];
    if (list.length > inboxSeen) handleInbound(list.slice(inboxSeen));
    inboxSeen = list.length;
  }
  if (changes[BOUND_KEY]) boundTargets = changes[BOUND_KEY].newValue || {};
});

(async function init() {
  const res = await new Promise(r => chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, BOUND_KEY], r));
  const settings = SETTINGS ? SETTINGS.withDefaults(res[SETTINGS_KEY]) : { lazyPanes: true };
  boundTargets = res[BOUND_KEY] || {};
  store.init(res[STORAGE_KEY] || null, settings);
  render();
  goalController.restore();
})();
