/*
 * Pure eviction policy for the chat cache. Given the current entries and the
 * limits (max number of chats, max total bytes), decide which entry ids to
 * evict — always dropping the least-recently-updated first. The IndexedDB glue
 * applies the plan.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).cachePolicy = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * @param {Array<{id:string, updatedAt:number, size:number}>} entries
   * @param {{maxChats:number, maxBytes:number}} limits
   * @returns {string[]} ids to evict
   */
  function evictionPlan(entries, limits) {
    if (!Array.isArray(entries) || !entries.length) return [];
    const maxChats = Number.isFinite(limits && limits.maxChats) ? limits.maxChats : Infinity;
    const maxBytes = Number.isFinite(limits && limits.maxBytes) ? limits.maxBytes : Infinity;

    // newest first
    const sorted = entries.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const evict = new Set();

    // 1) count cap: anything past the first maxChats goes
    for (let i = Math.max(0, maxChats); i < sorted.length; i++) evict.add(sorted[i].id);

    // 2) size cap: keep removing the oldest survivors until under maxBytes
    let total = 0;
    for (const e of sorted) if (!evict.has(e.id)) total += e.size || 0;
    for (let i = sorted.length - 1; i >= 0 && total > maxBytes; i--) {
      const e = sorted[i];
      if (evict.has(e.id)) continue;
      evict.add(e.id);
      total -= e.size || 0;
    }
    return [...evict];
  }

  return { evictionPlan };
});
