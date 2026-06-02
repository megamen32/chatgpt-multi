/*
 * Pure prompt-queue model: an ordered list of pending prompts with the
 * operations the UI needs. No DOM, no storage — the feature layer persists
 * `items` and drives sending. Kept pure so the queue mechanics are unit-tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).QueueModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function createQueue(initial) {
    let items = Array.isArray(initial) ? initial.filter((t) => typeof t === 'string') : [];

    const api = {
      get items() { return items.slice(); },
      get length() { return items.length; },
      isEmpty() { return items.length === 0; },

      add(text) {
        const t = (text || '').trim();
        if (!t) return false;
        items.push(t);
        return true;
      },
      /** Add many at once; blank lines are skipped. */
      addBulk(list) {
        let n = 0;
        for (const t of list || []) if (api.add(t)) n++;
        return n;
      },
      removeAt(i) {
        if (i < 0 || i >= items.length) return false;
        items.splice(i, 1);
        return true;
      },
      updateAt(i, text) {
        const t = (text || '').trim();
        if (i < 0 || i >= items.length || !t) return false;
        items[i] = t;
        return true;
      },
      move(from, to) {
        if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return false;
        const [it] = items.splice(from, 1);
        items.splice(to, 0, it);
        return true;
      },
      moveUp(i) { return api.move(i, i - 1); },
      moveDown(i) { return api.move(i, i + 1); },
      clear() { const had = items.length > 0; items = []; return had; },

      /** Peek the next prompt without removing it. */
      peek() { return items.length ? items[0] : null; },
      /** Remove and return the next prompt. */
      shift() { return items.length ? items.shift() : null; },

      replaceAll(list) { items = (list || []).filter((t) => typeof t === 'string'); },
    };
    return api;
  }

  return { createQueue };
});
