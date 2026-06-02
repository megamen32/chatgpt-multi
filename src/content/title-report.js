/*
 * ISOLATED content script (runs in chatgpt.com iframes only): reports the
 * current URL and chat title to the parent workspace via postMessage. This is
 * what keeps each pane's stored url/title in sync — crucial because ChatGPT
 * navigates via the History API (pushState), which does NOT fire iframe `load`
 * events, so the parent would otherwise never learn the pane changed chats.
 *
 * Always runs (URL sync is needed for persistence); the parent decides whether
 * to apply the title based on the syncPaneTitles setting.
 */
(function () {
  if (window.parent === window) return; // only meaningful when embedded as a pane

  function cleanTitle(t) {
    return (t || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^ChatGPT\s*[-–—]\s*/i, '')
      .slice(0, 80) || 'ChatGPT';
  }

  let lastUrl = '';
  let lastTitle = '';
  function report() {
    const url = location.href;
    const title = cleanTitle(document.title);
    if (url === lastUrl && title === lastTitle) return;
    lastUrl = url; lastTitle = title;
    try {
      window.parent.postMessage({ type: 'cgptmp:nav', url, title }, '*');
    } catch {}
  }

  // History API patches (SPA navigation).
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(report);
      return r;
    };
  }
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);

  // Title can update slightly after navigation; watch <title> too.
  const titleEl = document.querySelector('title');
  if (titleEl) new MutationObserver(report).observe(titleEl, { childList: true });

  // Initial report + a low-frequency safety net.
  report();
  setInterval(report, 2000);
})();
