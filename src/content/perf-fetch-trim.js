/*
 * MAIN-world content script: patches window.fetch inside each chatgpt.com frame
 * so that GET /backend-api/conversation/{id} responses are trimmed to the last
 * N messages. Runs at document_start, before ChatGPT's own bundle, so the patch
 * is in place by the time the app fetches the conversation.
 *
 * Reads configuration from <html> dataset attributes mirrored by the ISOLATED
 * settings bridge (MAIN world has no access to chrome.storage).
 *
 * Depends on src/lib/conversation-trim.js loaded just before it (same world).
 */
(function () {
  if (window.__CGPTMP_FETCH_PATCHED__) return;
  window.__CGPTMP_FETCH_PATCHED__ = true;

  const trimLib = (window.CGPTMP && window.CGPTMP.trim) || null;
  if (!trimLib) {
    console.warn('[CGPTMP] trim lib missing; fetch patch disabled');
    return;
  }

  const originalFetch = window.fetch.bind(window);
  const ds = () => document.documentElement.dataset;

  function trimEnabled() {
    return ds().cgptmpTrimEnabled !== 'off' && ds().cgptmpTrimEnabled !== undefined;
  }
  function messageLimit() {
    const n = Number(ds().cgptmpTrimLimit);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }

  function getUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }
  function getMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input.method === 'string') return String(input.method).toUpperCase();
    return 'GET';
  }
  function isConversationGet(url, method) {
    if (method !== 'GET' || !url) return false;
    try {
      const u = new URL(url, location.origin);
      return /^\/backend-api\/conversation\/[^/]+$/.test(u.pathname);
    } catch {
      return false;
    }
  }

  async function maybeTrim(input, init, response) {
    try {
      if (!trimEnabled()) return response;
      const url = getUrl(input);
      if (!isConversationGet(url, getMethod(input, init))) return response;
      if (!response.ok) return response;
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return response;

      const data = await response.clone().json();
      const trimmed = trimLib.trimConversationData(data, messageLimit());
      if (!trimmed) return response;

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      const next = new Response(JSON.stringify(trimmed), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      try {
        Object.defineProperty(next, 'url', { value: response.url });
      } catch {}
      window.dispatchEvent(new CustomEvent('cgptmp:trimmed', { detail: { url } }));
      return next;
    } catch (err) {
      console.warn('[CGPTMP] fetch trim failed:', err);
      return response;
    }
  }

  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch(input, init);
    return maybeTrim(input, init, response);
  };
})();
