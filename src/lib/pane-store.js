/*
 * Pure pane state machine for the multi-pane workspace.
 *
 * Holds panes, the focused pane, and the set of "loaded" panes (those whose
 * heavy iframe is actually mounted — the core of lazy loading). It has no DOM
 * or chrome dependencies: the view layer (app.js) calls these methods, reads
 * `store.state`, and handles rendering + persistence via the returned hints.
 *
 * Methods that change which panes are *mounted* return { structural: true } so
 * the view knows it must rebuild (placeholder <-> iframe); cheap focus changes
 * return { structural: false } so the view can do a light update.
 *
 * UMD so it loads as a classic script in the workspace page and under node:test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).PaneStore = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHATGPT_HOME = 'https://chatgpt.com/';
  const PICKER_URL = 'https://chatgpt.com/?cgpt_picker=1';
  const MAX_PANES = 8;

  function defaultUid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * @param {object} [opts]
   * @param {() => string} [opts.uid] id generator (injectable for tests)
   * @param {(url:string)=>string} [opts.inferTitle]
   */
  function createPaneStore(opts = {}) {
    const uid = opts.uid || defaultUid;
    const inferTitle = opts.inferTitle || ((url) => (url && url.includes('cgpt_picker') ? '+ Выбор чата' : 'ChatGPT'));

    const state = {
      panes: [],
      focusedId: null,
      loaded: new Set(),
      settings: { lazyPanes: true },
    };

    const isLazy = () => !!state.settings.lazyPanes;
    const ensureLoaded = (id) => state.loaded.add(id);
    const defaultPane = () => ({ id: uid(), title: 'ChatGPT', url: CHATGPT_HOME, picker: false });

    function init(saved, settings) {
      state.settings = settings || state.settings;
      const panes = saved && Array.isArray(saved.panes) && saved.panes.length
        ? saved.panes.slice(0, MAX_PANES)
        : [defaultPane()];
      state.panes = panes;
      state.focusedId = saved && saved.focusedId && panes.some((p) => p.id === saved.focusedId)
        ? saved.focusedId
        : panes[0].id;
      state.loaded = new Set();
      if (isLazy()) ensureLoaded(state.focusedId);
      else for (const p of panes) ensureLoaded(p.id);
      return state;
    }

    function addPane(url = PICKER_URL, picker = true, title = null) {
      const pane = { id: uid(), title: title || inferTitle(url), url, picker };
      state.panes.push(pane);
      state.focusedId = pane.id;
      ensureLoaded(pane.id);
      return pane;
    }

    function closePane(id) {
      const idx = state.panes.findIndex((p) => p.id === id);
      if (idx < 0) return;
      state.panes.splice(idx, 1);
      state.loaded.delete(id);
      if (!state.panes.length) {
        const p = defaultPane();
        state.panes.push(p);
        ensureLoaded(p.id);
      }
      state.focusedId = state.panes[Math.max(0, Math.min(idx, state.panes.length - 1))].id;
      ensureLoaded(state.focusedId);
    }

    /** @returns {{structural:boolean}} structural=true when the pane had to mount. */
    function focusPane(id) {
      const wasLoaded = state.loaded.has(id);
      state.focusedId = id;
      ensureLoaded(id);
      return { structural: !wasLoaded };
    }

    function unloadPane(id) {
      if (!state.loaded.has(id)) return false;
      state.loaded.delete(id);
      return true;
    }

    function duplicateFocused() {
      const p = state.panes.find((x) => x.id === state.focusedId) || state.panes[0];
      if (!p) return null;
      return addPane(p.url, p.picker, `${p.title} copy`);
    }

    function twoColumns() {
      while (state.panes.length < 2) state.panes.push(defaultPane());
      state.focusedId = state.panes[0].id;
      ensureLoaded(state.panes[0].id);
      ensureLoaded(state.panes[1].id);
    }

    /** When lazy mode is turned off, every pane should mount. */
    function setLazy(lazy) {
      state.settings = Object.assign({}, state.settings, { lazyPanes: lazy });
      if (!lazy) for (const p of state.panes) ensureLoaded(p.id);
    }

    function isLoaded(id) { return state.loaded.has(id); }
    function snapshot() { return { panes: state.panes, focusedId: state.focusedId }; }

    return {
      state,
      init, addPane, closePane, focusPane, unloadPane, duplicateFocused,
      twoColumns, setLazy, isLoaded, isLazy, snapshot, defaultPane,
      CHATGPT_HOME, PICKER_URL, MAX_PANES,
    };
  }

  return { createPaneStore, CHATGPT_HOME, PICKER_URL, MAX_PANES };
});
