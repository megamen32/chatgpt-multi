/*
 * Pure helpers for the native chat picker: normalize, sort, and filter the
 * conversation list returned by /backend-api/conversations. DOM/fetch glue
 * lives in the picker content script.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).pickerModel = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter((it) => it && it.id)
      .map((it) => ({
        id: String(it.id),
        title: (it.title && String(it.title).trim()) || 'Без названия',
        updateTime: Number(it.update_time || it.update_time_ms || 0) || 0,
      }));
  }

  function sortByRecent(list) {
    return list.slice().sort((a, b) => b.updateTime - a.updateTime);
  }

  function filterByQuery(list, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => it.title.toLowerCase().includes(q));
  }

  /** Convenience: normalize -> sort -> filter, for direct rendering. */
  function prepare(items, query) {
    return filterByQuery(sortByRecent(normalize(items)), query);
  }

  return { normalize, sortByRecent, filterByQuery, prepare };
});
