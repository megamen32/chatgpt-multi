/*
 * Feature: prompt queue with auto-send. Lets you stack prompts while ChatGPT is
 * still answering; the next one is sent automatically when it goes idle.
 * Pure queue mechanics live in src/lib/queue-model.js; this is the DOM glue +
 * a small panel UI. Per-conversation queue, persisted in chrome.storage.
 */
(function () {
  const QM = window.CGPTMP && window.CGPTMP.QueueModel;
  const defs = (window.CGPTMP = window.CGPTMP || {}).featureDefs = window.CGPTMP.featureDefs || [];
  const adapter = window.CGPTMP && window.CGPTMP.chatgptAdapter;
  if (!QM || !adapter) { console.warn('[CGPTMP] queue: model/adapter missing'); return; }

  const storageKey = () => `cgptmp.queue.${location.pathname}`;

  defs.push({
    key: 'queueEnabled',
    create(ctx) {
      const queue = QM.createQueue();
      let paused = false;
      let sending = false;
      let lastSendAt = 0;
      let pollId = null;
      let lastInterceptAt = 0;

      // restore persisted queue for this conversation
      chrome.storage.local.get([storageKey()], (res) => {
        const saved = res && res[storageKey()];
        if (saved && Array.isArray(saved.items)) { queue.replaceAll(saved.items); paused = !!saved.paused; renderList(); }
      });
      const persist = () => chrome.storage.local.set({ [storageKey()]: { items: queue.items, paused } });

      // ---- UI ----
      const panel = document.createElement('div');
      panel.className = 'cgptmp-queue collapsed';
      panel.innerHTML = `
        <div class="cgptmp-q-head">
          <span class="cgptmp-q-grip" title="Перетащить">⋮⋮</span>
          <span class="cgptmp-q-title">Очередь</span>
          <button class="cgptmp-q-btn" data-act="pause" title="Пауза/Старт">⏸</button>
          <button class="cgptmp-q-btn" data-act="clear" title="Очистить">🗑</button>
          <button class="cgptmp-q-btn" data-act="collapse" title="Свернуть">▾</button>
        </div>
        <ul class="cgptmp-q-list"></ul>
        <div class="cgptmp-q-input">
          <textarea rows="1" placeholder="Добавить промпт… (Enter)"></textarea>
        </div>`;
      document.body.appendChild(panel);

      // collapse / expand
      const collapseBtn = panel.querySelector('[data-act="collapse"]');
      let collapsed = true;
      function applyCollapsed() {
        panel.classList.toggle('collapsed', collapsed);
        collapseBtn.textContent = collapsed ? '▸' : '▾';
        collapseBtn.title = collapsed ? 'Развернуть' : 'Свернуть';
        chrome.storage.local.set({ 'cgptmp.queue.ui': { collapsed, pos, version: 2 } });
      }
      collapseBtn.addEventListener('click', () => { collapsed = !collapsed; applyCollapsed(); });

      // drag the whole panel by its header
      let pos = null; // {left, top}
      const headEl = panel.querySelector('.cgptmp-q-head');
      headEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.cgptmp-q-btn')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const offX = e.clientX - r.left, offY = e.clientY - r.top;
        function move(ev) {
          pos = { left: Math.max(0, Math.min(innerWidth - 60, ev.clientX - offX)), top: Math.max(0, Math.min(innerHeight - 30, ev.clientY - offY)) };
          panel.style.left = pos.left + 'px'; panel.style.top = pos.top + 'px';
          panel.style.right = 'auto'; panel.style.transform = 'none';
        }
        function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); chrome.storage.local.set({ 'cgptmp.queue.ui': { collapsed, pos, version: 2 } }); }
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });

      // restore saved UI state
      chrome.storage.local.get(['cgptmp.queue.ui'], (r) => {
        const ui = r && r['cgptmp.queue.ui'];
        if (ui) {
          collapsed = typeof ui.collapsed === 'boolean' ? ui.collapsed : true; applyCollapsed();
          if (ui.pos) { pos = ui.pos; panel.style.left = pos.left + 'px'; panel.style.top = pos.top + 'px'; panel.style.right = 'auto'; panel.style.transform = 'none'; }
        } else applyCollapsed();
      });

      const listEl = panel.querySelector('.cgptmp-q-list');
      const inputEl = panel.querySelector('textarea');
      const pauseBtn = panel.querySelector('[data-act="pause"]');
      const titleEl = panel.querySelector('.cgptmp-q-title');

      function renderList() {
        listEl.replaceChildren();
        queue.items.forEach((text, i) => {
          const li = document.createElement('li');
          const span = document.createElement('span'); span.className = 'cgptmp-q-text'; span.textContent = text;
          const up = mkBtn('↑', () => { if (queue.moveUp(i)) { persist(); renderList(); } });
          const del = mkBtn('×', () => { if (queue.removeAt(i)) { persist(); renderList(); } });
          li.append(span, up, del);
          listEl.appendChild(li);
        });
        pauseBtn.textContent = paused ? '▶' : '⏸';
        const count = String(queue.length);
        panel.dataset.count = count;
        titleEl.dataset.count = count;
      }
      function mkBtn(label, on) {
        const b = document.createElement('button'); b.className = 'cgptmp-q-mini'; b.textContent = label;
        b.addEventListener('click', (e) => { e.stopPropagation(); on(); });
        return b;
      }

      function showQueue() {
        if (collapsed) { collapsed = false; applyCollapsed(); }
      }
      function composerText(el) {
        if (!el) return '';
        return (el.tagName === 'TEXTAREA' ? el.value : (el.innerText || el.textContent || '')).trim();
      }
      function clearComposer(el) {
        if (!el) return;
        if (el.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.addRange(range);
          document.execCommand('delete', false, null);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      function enqueueDraft(text, opts = {}) {
        if (!queue.add(text)) return false;
        if (opts.reveal !== false) showQueue();
        persist(); renderList(); maybeSend();
        return true;
      }

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (enqueueDraft(inputEl.value)) inputEl.value = '';
        }
      });
      const interceptComposerEnter = (e) => {
        if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
        const el = adapter.composer();
        if (!el || e.target !== el) return;
        const btn = adapter.sendButton && adapter.sendButton();
        const cannotSendNow = adapter.isGenerating() || !btn || btn.disabled;
        if (!cannotSendNow) return;
        const text = composerText(el);
        if (!text) return;
        const now = Date.now();
        if (now - lastInterceptAt < 300) return;
        lastInterceptAt = now;
        e.preventDefault();
        e.stopPropagation();
        if (enqueueDraft(text, { reveal: true })) clearComposer(el);
      };
      document.addEventListener('keydown', interceptComposerEnter, true);
      panel.querySelector('[data-act="pause"]').addEventListener('click', () => { paused = !paused; persist(); renderList(); maybeSend(); });
      panel.querySelector('[data-act="clear"]').addEventListener('click', () => { queue.clear(); persist(); renderList(); });

      // ---- send loop ----
      function maybeSend() {
        if (paused || sending || queue.isEmpty()) return;
        if (adapter.isGenerating()) return;
        if (Date.now() - lastSendAt < 800) return; // debounce after a send
        if (!adapter.composer()) return;
        const next = queue.peek();
        sending = true;
        adapter.setText(next);
        // give React a tick to enable the send button, then send
        setTimeout(() => {
          if (adapter.send()) {
            queue.shift();
            lastSendAt = Date.now();
            persist();
            renderList();
          }
          // wait until generation actually starts (or timeout) before unlocking
          setTimeout(() => { sending = false; }, 600);
        }, 120);
      }

      pollId = setInterval(maybeSend, 700);
      renderList();

      return {
        tick() { maybeSend(); },
        dispose() {
          clearInterval(pollId);
          document.removeEventListener('keydown', interceptComposerEnter, true);
          panel.remove();
        },
      };
    },
  });
})();
