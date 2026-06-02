/*
 * Pure logic for auto-collapsing old messages: given how many messages are
 * present and how many should stay fully visible at the bottom, decide which
 * indices to collapse. DOM glue (capping height, expand on click/scroll) lives
 * in the feature layer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).collapseModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * @param {number} count total message elements
   * @param {number} keepVisible how many trailing messages stay expanded
   * @returns {number[]} indices (0-based) that should be collapsed
   */
  function indicesToCollapse(count, keepVisible) {
    if (!Number.isFinite(count) || count <= 0) return [];
    const keep = Math.max(0, Math.floor(keepVisible) || 0);
    const cutoff = count - keep; // collapse [0, cutoff)
    if (cutoff <= 0) return [];
    const out = [];
    for (let i = 0; i < cutoff; i++) out.push(i);
    return out;
  }

  /** Whether a given index should be collapsed (handy for incremental updates). */
  function shouldCollapse(index, count, keepVisible) {
    const keep = Math.max(0, Math.floor(keepVisible) || 0);
    return index < count - keep;
  }

  return { indicesToCollapse, shouldCollapse };
});
