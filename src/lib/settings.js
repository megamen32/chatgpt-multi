/*
 * Central settings schema for ChatGPT Multi Pane.
 *
 * One source of truth for defaults + the storage key, shared by:
 *   - the options/settings page,
 *   - the ISOLATED-world settings bridge that mirrors values into the DOM
 *     dataset so MAIN-world scripts (fetch trim) can read them,
 *   - the injected feature bundle (auto-confirm / queue / collapse).
 *
 * Dependency-free UMD so it loads as a classic content script and as a test
 * module in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).settings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STORAGE_KEY = 'cgptMultiPane.settings.v1';

  const DEFAULTS = {
    // Performance
    trimEnabled: true, // trim long conversations on load
    trimLimit: 20, // messages to keep when trimming
    lazyPanes: true, // only load the focused pane's iframe
    // Features ported from standalone extensions
    autoConfirm: false, // auto-click Confirm on Custom GPT actions
    autoExpandToolCalls: false,
    queueEnabled: false, // prompt queue with auto-send
    collapseEnabled: false, // auto-collapse old messages in the live pane
    // UX
    syncPaneTitles: true, // pane tab title follows the real chat title
  };

  // Map of setting key -> dataset attribute name on <html> used by MAIN world.
  const DATASET_KEYS = {
    trimEnabled: 'cgptmpTrimEnabled',
    trimLimit: 'cgptmpTrimLimit',
  };

  function withDefaults(stored) {
    return Object.assign({}, DEFAULTS, stored || {});
  }

  return { STORAGE_KEY, DEFAULTS, DATASET_KEYS, withDefaults };
});
