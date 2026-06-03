/*
 * MAIN-world IndexedDB cache for conversation payloads (same-origin per
 * chatgpt.com). Stores trimmed-or-whole conversation JSON keyed by id so the
 * fetch patch can serve a chat instantly while revalidating in the background.
 * Eviction policy is the pure cache-policy lib; limits come from <html> dataset
 * mirrored by the settings bridge.
 */
(function () {
  const CGPTMP = (window.CGPTMP = window.CGPTMP || {});
  if (CGPTMP.chatCache) return;
  const policy = CGPTMP.cachePolicy;

  const DB = 'cgptmp-cache';
  const STORE = 'chats';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(mode) {
    return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }
  function pr(req) {
    return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }

  async function get(id) {
    try { const store = await tx('readonly'); return (await pr(store.get(id))) || null; }
    catch { return null; }
  }

  async function listMeta() {
    try {
      const store = await tx('readonly');
      const all = await pr(store.getAll());
      return all.map((e) => ({ id: e.id, updatedAt: e.updatedAt, size: e.size }));
    } catch { return []; }
  }

  function limits() {
    const ds = document.documentElement.dataset;
    const maxChats = Number(ds.cgptmpCacheMaxChats) || 10;
    const maxBytes = (Number(ds.cgptmpCacheMaxMb) || 100) * 1024 * 1024;
    return { maxChats, maxBytes };
  }

  async function put(id, json) {
    try {
      const entry = { id, json, size: json.length, updatedAt: Date.now() };
      let store = await tx('readwrite');
      await pr(store.put(entry));
      // evict
      const meta = await listMeta();
      const plan = policy ? policy.evictionPlan(meta, limits()) : [];
      if (plan.length) {
        store = await tx('readwrite');
        for (const evId of plan) store.delete(evId);
      }
    } catch (e) { /* cache is best-effort */ }
  }

  CGPTMP.chatCache = { get, put, listMeta };
})();
