/*
 * ISOLATED-world feature orchestrator, injected into every chatgpt.com frame
 * (including the multi-pane iframes). Owns a single MutationObserver and a
 * rAF-throttled scheduler shared by all features, and starts/stops features as
 * settings change so we never run work the user disabled.
 *
 * Feature modules push a definition via CGPTMP.featureDefs before this runs:
 *   { key: <settings key>, create(ctx) => { tick(reason), dispose() } }
 * `ctx` exposes { settings, requestTick }.
 *
 * Depends on src/lib/settings.js (same ISOLATED world).
 */
(function () {
  const S = window.CGPTMP && window.CGPTMP.settings;
  const defs = (window.CGPTMP && window.CGPTMP.featureDefs) || [];
  if (!S) {
    console.warn('[CGPTMP] features: settings lib missing');
    return;
  }

  let settings = Object.assign({}, S.DEFAULTS);
  const active = new Map(); // key -> feature instance

  const ctx = {
    get settings() { return settings; },
    requestTick: scheduleTick,
  };

  let scheduled = false;
  function scheduleTick(reason) {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (document.visibilityState !== 'visible') return;
      for (const inst of active.values()) {
        try { inst.tick && inst.tick(reason); } catch (e) { /* keep other features alive */ }
      }
    });
  }

  const observer = new MutationObserver(() => {
    if (active.size) scheduleTick('mutation');
  });

  function startObserver() {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  function reconcile() {
    for (const def of defs) {
      const want = !!settings[def.key];
      const has = active.has(def.key);
      if (want && !has) {
        try { active.set(def.key, def.create(ctx)); } catch (e) { console.warn('[CGPTMP] feature start failed', def.key, e); }
      } else if (!want && has) {
        try { active.get(def.key).dispose && active.get(def.key).dispose(); } catch {}
        active.delete(def.key);
      }
    }
    if (active.size) scheduleTick('reconcile');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && active.size) scheduleTick('visible');
  });

  S && chrome.storage.local.get([S.STORAGE_KEY], (res) => {
    settings = S.withDefaults(res && res[S.STORAGE_KEY]);
    reconcile();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[S.STORAGE_KEY]) return;
    settings = S.withDefaults(changes[S.STORAGE_KEY].newValue);
    reconcile();
  });

  startObserver();
})();
