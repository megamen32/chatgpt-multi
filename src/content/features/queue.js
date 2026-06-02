/*
 * Feature: prompt queue with auto-send. Lets you stack prompts while ChatGPT is
 * still answering; the next one is sent automatically when it goes idle.
 * Pure queue mechanics live in src/lib/queue-model.js; this is the DOM glue +
 * a small panel UI. Per-conversation queue, persisted in chrome.storage.
 */
(function () {
  const QM = window.CGPTMP && window.CGPTMP.QueueModel;
  const defs = (window.CGPTMP = window.CGPTMP || {}).featureDefs = window.CGPTMP.featureDefs || [];
  if (!QM) { console.warn('[CGPTMP] queue: model missing'); return; }

  // ---- ChatGPT DOM adapter -------------------------------------------------
  const adapter = {
    composer() {
      return document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], div.ProseMirror[contenteditable="true"]');
    },
    sendButton() {
      return document.querySelector('[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send"]');
    },
    isGenerating() {
      return !!document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"], button[data-testid="stop-streaming-button"]');
    },
    setText(text) {
      const el = adapter.composer();
      if (!el) return false;
      el.focus();
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const sel = window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
        document.execCommand('insertText', false, text);
      }
      return true;
    },
    send() {
      const btn = adapter.sendButton();
      if (btn && !btn.disabled) { btn.click(); return true; }
      // Fallback: Enter key on the composer.
      const el = adapter.composer();
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        return true;
      }
      return false;
    },
  };

  const storageKey = () => `cgptmp.queue.${location.pathname}`;

  defs.push({
    key: 'queueEnabled',
    create(ctx) {
      const queue = QM.createQueue();
      let paused = false;
      let sending = false;
      let lastSendAt = 0;
      let pollId = null;

      // restore persisted queue for this conversation
      chrome.storage.local.get([storageKey()], (res) => {
        const saved = res && res[storageKey()];
        if (saved && Array.isArray(saved.items)) { queue.replaceAll(saved.items); paused = !!saved.paused; renderList(); }
      });
      const persist = () => chrome.storage.local.set({ [storageKey()]: { items: queue.items, paused } });

      // ---- UI ----
      const panel = document.createElement('div');
      panel.className = 'cgptmp-queue';
      panel.innerHTML = `
        <div class="cgptmp-q-head">
          <span class="cgptmp-q-title">Очередь</span>
          <button class="cgptmp-q-btn" data-act="pause" title="Пауза/Старт">⏸</button>
          <button class="cgptmp-q-btn" data-act="clear" title="Очистить">🗑</button>
        </div>
        <ul class="cgptmp-q-list"></ul>
        <div class="cgptmp-q-input">
          <textarea rows="1" placeholder="Добавить промпт… (Enter)"></textarea>
        </div>`;
      document.body.appendChild(panel);

      const listEl = panel.querySelector('.cgptmp-q-list');
      const inputEl = panel.querySelector('textarea');
      const pauseBtn = panel.querySelector('[data-act="pause"]');

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
        panel.dataset.count = String(queue.length);
      }
      function mkBtn(label, on) {
        const b = document.createElement('button'); b.className = 'cgptmp-q-mini'; b.textContent = label;
        b.addEventListener('click', (e) => { e.stopPropagation(); on(); });
        return b;
      }

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (queue.add(inputEl.value)) { inputEl.value = ''; persist(); renderList(); maybeSend(); }
        }
      });
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
          panel.remove();
        },
      };
    },
  });
})();
