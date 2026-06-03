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
  function cacheEnabled() { return ds().cgptmpCacheEnabled === 'on'; }
  function cacheWhole() { return ds().cgptmpCacheWhole === 'on'; }
  const cache = () => window.CGPTMP && window.CGPTMP.chatCache;

  function convIdFromUrl(url) {
    try { return new URL(url, location.origin).pathname.split('/').pop(); } catch { return null; }
  }
  function jsonResponse(text, base) {
    const headers = new Headers(base ? base.headers : { 'content-type': 'application/json' });
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json');
    const r = new Response(text, { status: 200, statusText: 'OK', headers });
    if (base) { try { Object.defineProperty(r, 'url', { value: base.url }); } catch {} }
    return r;
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

  // Network fetch for a conversation: trim, then update the cache.
  async function networkConversation(input, init, id) {
    const response = await originalFetch(input, init);
    try {
      const ct = response.headers.get('content-type') || '';
      if (!response.ok || !ct.includes('application/json')) return response;
      const data = await response.clone().json();
      const trimmed = trimEnabled() ? trimLib.trimConversationData(data, messageLimit()) : null;
      // store trimmed-or-whole per setting
      if (cacheEnabled() && cache() && id) {
        const toStore = cacheWhole() ? data : (trimmed || data);
        cache().put(id, JSON.stringify(toStore));
      }
      if (trimmed) return jsonResponse(JSON.stringify(trimmed), response);
      return response;
    } catch (e) {
      return response;
    }
  }

  async function conversationFetch(input, init, url) {
    const id = convIdFromUrl(url);
    // Cache-first: serve instantly, revalidate (and re-cache) in the background.
    if (cacheEnabled() && cache() && id) {
      try {
        const hit = await cache().get(id);
        if (hit && hit.json) {
          networkConversation(input, init, id).catch(() => {}); // background revalidate
          window.dispatchEvent(new CustomEvent('cgptmp:cache-hit', { detail: { id } }));
          return jsonResponse(hit.json, null);
        }
      } catch {}
    }
    return networkConversation(input, init, id);
  }

  window.fetch = async function patchedFetch(input, init) {
    const url = getUrl(input);
    const method = getMethod(input, init);
    if (isConversationGet(url, method) && (cacheEnabled() || trimEnabled())) {
      return conversationFetch(input, init, url);
    }
    const response = await originalFetch(input, init);
    return maybeTrim(input, init, response);
  };
})();
