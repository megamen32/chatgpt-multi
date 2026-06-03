/*
 * ISOLATED-world content script: reads our settings from chrome.storage and
 * mirrors the performance-relevant ones into <html> dataset attributes so the
 * MAIN-world fetch patch can read them. Keeps them in sync on change.
 *
 * Depends on src/lib/settings.js loaded just before it (same world).
 */
(function () {
  const S = window.CGPTMP && window.CGPTMP.settings;
  if (!S) {
    console.warn('[CGPTMP] settings lib missing in bridge');
    return;
  }

  function apply(settings) {
    const root = document.documentElement;
    root.dataset.cgptmpTrimEnabled = settings.trimEnabled ? 'on' : 'off';
    root.dataset.cgptmpTrimLimit = String(settings.trimLimit);
    root.dataset.cgptmpCacheEnabled = settings.cacheEnabled ? 'on' : 'off';
    root.dataset.cgptmpCacheWhole = settings.cacheWholeChat ? 'on' : 'off';
    root.dataset.cgptmpCacheMaxChats = String(settings.cacheMaxChats);
    root.dataset.cgptmpCacheMb = String(settings.cacheMaxMB);
  }

  // Seed defaults synchronously so the very first conversation fetch is covered
  // even before storage resolves.
  apply(S.DEFAULTS);

  chrome.storage.local.get([S.STORAGE_KEY], (res) => {
    apply(S.withDefaults(res && res[S.STORAGE_KEY]));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[S.STORAGE_KEY]) return;
    apply(S.withDefaults(changes[S.STORAGE_KEY].newValue));
  });
})();
