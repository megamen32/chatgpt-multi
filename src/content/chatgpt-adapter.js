/*
 * Shared ChatGPT DOM/API adapter (ISOLATED world). Centralizes the brittle
 * selectors + backend-api calls so the queue, agent runtime and picker reuse
 * one implementation. Exposed as window.CGPTMP.chatgptAdapter.
 */
(function () {
  const CGPTMP = (window.CGPTMP = window.CGPTMP || {});
  if (CGPTMP.chatgptAdapter) return;

  let cachedToken = null;

  function convId() {
    const m = location.pathname.match(/\/c\/([0-9a-f-]{8,})/i);
    return m ? m[1] : null;
  }

  function composer() {
    return document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], div.ProseMirror[contenteditable="true"]');
  }
  function sendButton() {
    return document.querySelector('[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send"], button[aria-label*="Отправить"]');
  }
  // A turn is NOT finished until: the stop button is gone, no async tool
  // (image generation) is still rendering, and the composer can accept input
  // again. The stop button disappears before image-gen finishes, which is why
  // the queue/goal loop used to fire too early.
  function stopButton() {
    return document.querySelector('[data-testid="stop-button"], button[data-testid="stop-streaming-button"], button[aria-label*="Stop"], button[aria-label*="Остановить"]');
  }
  function imageGenerating() {
    return !!document.querySelector('[data-testid="image-gen-loading-state"], [data-testid^="image-gen-loading"]');
  }
  function isGenerating() {
    if (stopButton()) return true;
    if (imageGenerating()) return true;
    return false;
  }

  function setText(text) {
    const el = composer();
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
  }

  function send() {
    const btn = sendButton();
    if (btn && !btn.disabled) { btn.click(); return true; }
    const el = composer();
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      return true;
    }
    return false;
  }

  /** Send a prompt: set text, then click send once React enables it. */
  function sendPrompt(text) {
    if (!setText(text)) return Promise.resolve(false);
    return new Promise((resolve) => setTimeout(() => resolve(send()), 140));
  }

  async function getToken() {
    if (cachedToken) return cachedToken;
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      cachedToken = (j && j.accessToken) || null;
    } catch { cachedToken = null; }
    return cachedToken;
  }

  async function fetchConversation(id) {
    const cid = id || convId();
    if (!cid) return null;
    const token = await getToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const r = await fetch('/backend-api/conversation/' + encodeURIComponent(cid), { headers, credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function patchSetting(feature, value) {
    const token = await getToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const url = `/backend-api/settings/account_user_setting?feature=${encodeURIComponent(feature)}&value=${encodeURIComponent(value)}`;
    const r = await fetch(url, { method: 'PATCH', headers, credentials: 'include', body: null });
    return r.ok;
  }

  CGPTMP.chatgptAdapter = {
    convId, composer, sendButton, isGenerating, setText, send, sendPrompt,
    getToken, fetchConversation, patchSetting,
  };
})();
