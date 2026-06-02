/*
 * Native chat picker. When a pane is opened with ?cgpt_picker=1 we don't want
 * the whole ChatGPT app to render just to pick a chat — so this ISOLATED
 * content script (same-origin to chatgpt.com, so cookies + token work) fetches
 * the conversation list and renders a lightweight overlay. Clicking a chat
 * navigates this pane to it (which then benefits from fetch trim + title sync).
 *
 * Hovering a chat shows a preview (last user prompt + last assistant reply),
 * excerpted to first/last 200 chars and expandable on click. Previews for the
 * top 10 chats are prefetched; others load on first hover. Cached per id.
 *
 * Pure list shaping is in src/lib/picker-model.js; preview extraction in
 * src/lib/chat-preview.js.
 */
(function () {
  let isPicker = false;
  try { isPicker = new URL(location.href).searchParams.get('cgpt_picker') === '1'; } catch {}
  if (!isPicker) return;

  const PM = window.CGPTMP && window.CGPTMP.pickerModel;
  const CP = window.CGPTMP && window.CGPTMP.chatPreview;
  if (!PM || !CP) { console.warn('[CGPTMP] picker: model(s) missing'); return; }

  const PREFETCH_COUNT = 10;
  const PREFETCH_CONCURRENCY = 3;

  // Hide the underlying app so its boot cost is never paid visually.
  const hide = document.createElement('style');
  hide.textContent = `
    html,body{overflow:hidden!important}
    body > *:not(#cgptmp-picker){visibility:hidden!important}
    #cgptmp-picker{visibility:visible!important}
  `;
  (document.head || document.documentElement).appendChild(hide);

  const root = document.createElement('div');
  root.id = 'cgptmp-picker';
  root.innerHTML = `
    <div class="cgptmp-pk-bar">
      <input type="search" class="cgptmp-pk-search" placeholder="Поиск чатов…" />
      <button class="cgptmp-pk-new" title="Новый чат">+ Новый</button>
    </div>
    <div class="cgptmp-pk-status">Загрузка…</div>
    <ul class="cgptmp-pk-list"></ul>
    <div class="cgptmp-pk-preview" hidden></div>`;
  function mount() {
    if (document.body) document.body.appendChild(root);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(root), { once: true });
  }
  mount();

  const searchEl = root.querySelector('.cgptmp-pk-search');
  const statusEl = root.querySelector('.cgptmp-pk-status');
  const listEl = root.querySelector('.cgptmp-pk-list');
  const previewEl = root.querySelector('.cgptmp-pk-preview');
  let all = [];
  let token = null;
  let hoverId = null;
  let expanded = false;

  // id -> { state:'loading'|'ok'|'error', user, assistant }
  const cache = new Map();

  root.querySelector('.cgptmp-pk-new').addEventListener('click', () => location.assign('/'));
  searchEl.addEventListener('input', () => renderList());
  previewEl.addEventListener('mouseleave', hidePreview);

  function renderList() {
    const items = PM.filterByQuery(all, searchEl.value);
    listEl.replaceChildren();
    if (!all.length) return;
    statusEl.style.display = 'none';
    for (const it of items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'cgptmp-pk-item';
      btn.textContent = it.title;
      btn.title = it.title;
      btn.addEventListener('click', () => location.assign('/c/' + it.id));
      btn.addEventListener('mouseenter', () => showPreview(it));
      li.appendChild(btn);
      listEl.appendChild(li);
    }
    if (!items.length) { statusEl.style.display = ''; statusEl.textContent = 'Ничего не найдено'; }
  }

  // ---- preview rendering ----
  function hidePreview() {
    hoverId = null;
    previewEl.hidden = true;
  }

  function renderPreview(it) {
    const entry = cache.get(it.id);
    previewEl.hidden = false;
    if (!entry || entry.state === 'loading') {
      previewEl.innerHTML = `<div class="cgptmp-pk-pv-title"></div><div class="cgptmp-pk-pv-loading">Загрузка превью…</div>`;
      previewEl.querySelector('.cgptmp-pk-pv-title').textContent = it.title;
      return;
    }
    if (entry.state === 'error') {
      previewEl.innerHTML = `<div class="cgptmp-pk-pv-title"></div><div class="cgptmp-pk-pv-loading">Не удалось загрузить превью</div>`;
      previewEl.querySelector('.cgptmp-pk-pv-title').textContent = it.title;
      return;
    }
    const u = expanded ? entry.user : CP.excerpt(entry.user);
    const a = expanded ? entry.assistant : CP.excerpt(entry.assistant);
    previewEl.innerHTML = `
      <div class="cgptmp-pk-pv-title"></div>
      <div class="cgptmp-pk-pv-role">Вы</div>
      <div class="cgptmp-pk-pv-text" data-k="u"></div>
      <div class="cgptmp-pk-pv-role">ChatGPT</div>
      <div class="cgptmp-pk-pv-text" data-k="a"></div>
      <div class="cgptmp-pk-pv-actions">
        <button class="cgptmp-pk-pv-toggle">${expanded ? 'Свернуть' : 'Раскрыть'}</button>
        <button class="cgptmp-pk-pv-open">Открыть чат →</button>
      </div>`;
    previewEl.classList.toggle('expanded', expanded);
    previewEl.querySelector('.cgptmp-pk-pv-title').textContent = it.title;
    previewEl.querySelector('[data-k="u"]').textContent = u || '—';
    previewEl.querySelector('[data-k="a"]').textContent = a || '—';
    previewEl.querySelector('.cgptmp-pk-pv-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      expanded = !expanded;
      renderPreview(it);
      if (expanded) previewEl.scrollTop = 0;
    });
    previewEl.querySelector('.cgptmp-pk-pv-open').addEventListener('click', () => location.assign('/c/' + it.id));
  }

  function showPreview(it) {
    hoverId = it.id;
    expanded = false;
    renderPreview(it);
    ensurePreview(it.id).then(() => { if (hoverId === it.id) renderPreview(it); });
  }

  // ---- fetching ----
  async function getToken() {
    if (token) return token;
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      token = j && j.accessToken ? j.accessToken : null;
    } catch { token = null; }
    return token;
  }

  async function ensurePreview(id) {
    const existing = cache.get(id);
    if (existing && existing.state !== 'error') return existing;
    cache.set(id, { state: 'loading' });
    try {
      const tk = await getToken();
      const headers = tk ? { Authorization: 'Bearer ' + tk } : {};
      const r = await fetch('/backend-api/conversation/' + encodeURIComponent(id), { headers, credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const p = CP.extractPreview(data);
      const entry = { state: 'ok', user: p.user, assistant: p.assistant };
      cache.set(id, entry);
      return entry;
    } catch (err) {
      cache.set(id, { state: 'error' });
      return cache.get(id);
    }
  }

  async function prefetchTop() {
    const ids = all.slice(0, PREFETCH_COUNT).map((x) => x.id);
    let i = 0;
    async function worker() {
      while (i < ids.length) {
        const id = ids[i++];
        await ensurePreview(id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, ids.length) }, worker));
  }

  async function loadConversations() {
    const tk = await getToken();
    const headers = tk ? { Authorization: 'Bearer ' + tk } : {};
    try {
      const r = await fetch('/backend-api/conversations?offset=0&limit=40&order=updated', { headers, credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      all = PM.sortByRecent(PM.normalize(data.items || data.conversations || []));
      if (!all.length) statusEl.textContent = 'Нет чатов';
      renderList();
      prefetchTop();
    } catch (err) {
      statusEl.textContent = 'Не удалось загрузить список чатов. Откройте ChatGPT и войдите в аккаунт.';
      console.warn('[CGPTMP] picker load failed:', err);
    }
  }

  loadConversations();
})();
