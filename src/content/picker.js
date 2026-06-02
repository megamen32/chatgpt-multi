/*
 * Native chat picker. When a pane is opened with ?cgpt_picker=1 we don't want
 * the whole ChatGPT app to render just to pick a chat — so this ISOLATED
 * content script (same-origin to chatgpt.com, so cookies + token work) fetches
 * the conversation list and renders a lightweight overlay. Clicking a chat
 * navigates this pane to it (which then benefits from fetch trim + title sync).
 *
 * Pure list shaping is in src/lib/picker-model.js.
 */
(function () {
  let isPicker = false;
  try { isPicker = new URL(location.href).searchParams.get('cgpt_picker') === '1'; } catch {}
  if (!isPicker) return;

  const PM = window.CGPTMP && window.CGPTMP.pickerModel;
  if (!PM) { console.warn('[CGPTMP] picker: model missing'); return; }

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
    <ul class="cgptmp-pk-list"></ul>`;
  function mount() {
    if (document.body) document.body.appendChild(root);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(root), { once: true });
  }
  mount();

  const searchEl = root.querySelector('.cgptmp-pk-search');
  const statusEl = root.querySelector('.cgptmp-pk-status');
  const listEl = root.querySelector('.cgptmp-pk-list');
  let all = [];

  root.querySelector('.cgptmp-pk-new').addEventListener('click', () => location.assign('/'));
  searchEl.addEventListener('input', () => renderList());

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
      li.appendChild(btn);
      listEl.appendChild(li);
    }
    if (!items.length) { statusEl.style.display = ''; statusEl.textContent = 'Ничего не найдено'; }
  }

  async function getToken() {
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.accessToken ? j.accessToken : null;
    } catch { return null; }
  }

  async function loadConversations() {
    const token = await getToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    try {
      const r = await fetch('/backend-api/conversations?offset=0&limit=40&order=updated', { headers, credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      all = PM.sortByRecent(PM.normalize(data.items || data.conversations || []));
      if (!all.length) statusEl.textContent = 'Нет чатов';
      renderList();
    } catch (err) {
      statusEl.textContent = 'Не удалось загрузить список чатов. Откройте ChatGPT и войдите в аккаунт.';
      console.warn('[CGPTMP] picker load failed:', err);
    }
  }

  loadConversations();
})();
