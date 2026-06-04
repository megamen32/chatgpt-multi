/* Auto-scroll ChatGPT if the parent workspace says this iframe is TG-bound
 * and the user has been idle. Runs inside the ChatGPT frame, where scrolling is allowed. */
(() => {
  if (window.__CGPTMP_AUTO_SCROLL_INACTIVE__) return;
  window.__CGPTMP_AUTO_SCROLL_INACTIVE__ = true;
  let lastSignature = '';
  let lastScrollAt = 0;

  function bottomScroller() {
    const candidates = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      document.querySelector('main'),
      document.querySelector('[class*="react-scroll-to-bottom"]'),
      document.querySelector('[data-testid="conversation-turn-list"]'),
    ].filter(Boolean);
    let best = candidates[0];
    for (const el of candidates) {
      if ((el.scrollHeight || 0) - (el.clientHeight || 0) > (best.scrollHeight || 0) - (best.clientHeight || 0)) best = el;
    }
    return best || document.scrollingElement || document.documentElement;
  }

  function assistantSignature() {
    const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], [data-testid*="assistant"], article'));
    const tail = nodes.slice(-3).map((n) => (n.innerText || n.textContent || '').trim()).filter(Boolean).join('\n---\n');
    return `${nodes.length}:${tail.length}:${tail.slice(-512)}`;
  }

  function scrollIfAssistantChanged(force) {
    const sig = assistantSignature();
    if (!force && sig && sig === lastSignature) return;
    lastSignature = sig;
    const now = Date.now();
    if (now - lastScrollAt < 1200) return;
    lastScrollAt = now;
    requestAnimationFrame(() => {
      const el = bottomScroller();
      try { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }
      catch { el.scrollTop = el.scrollHeight; }
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }

  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.source !== 'cgptmp' || d.type !== 'auto-scroll-if-inactive') return;
    scrollIfAssistantChanged(!!d.force);
  });
})();
