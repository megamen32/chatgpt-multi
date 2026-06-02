/*
 * Feature: auto-collapse old messages in the live pane. Complements the fetch
 * trim — even within the loaded messages, older ones are height-capped so the
 * layout/paint stays cheap. Click a collapsed message to expand it.
 * Selection logic is the pure collapse-model; this is the DOM glue.
 */
(function () {
  const CMod = window.CGPTMP && window.CGPTMP.collapseModel;
  const defs = (window.CGPTMP = window.CGPTMP || {}).featureDefs = window.CGPTMP.featureDefs || [];
  if (!CMod) { console.warn('[CGPTMP] collapse: model missing'); return; }

  const KEEP_VISIBLE = 6;
  const COLLAPSED = 'cgptmp-collapsed';
  const EXPANDED = 'cgptmp-expanded';

  function messageEls() {
    let els = document.querySelectorAll('article[data-testid^="conversation-turn"]');
    if (!els.length) els = document.querySelectorAll('[data-message-author-role]');
    return Array.from(els);
  }

  defs.push({
    key: 'collapseEnabled',
    create() {
      function onClick(e) {
        const el = e.target.closest('.' + COLLAPSED);
        if (!el) return;
        // expand only when the click is on our collapse chrome, not on real
        // interactive content like links/buttons.
        if (e.target.closest('a, button, [role="button"], input, textarea')) return;
        el.classList.remove(COLLAPSED);
        el.classList.add(EXPANDED);
      }
      document.addEventListener('click', onClick, true);

      function apply() {
        const els = messageEls();
        const collapseSet = new Set(CMod.indicesToCollapse(els.length, KEEP_VISIBLE));
        els.forEach((el, i) => {
          if (collapseSet.has(i)) {
            if (!el.classList.contains(EXPANDED)) el.classList.add(COLLAPSED);
          } else {
            el.classList.remove(COLLAPSED);
            el.classList.remove(EXPANDED);
          }
        });
      }

      return {
        tick() { apply(); },
        dispose() {
          document.removeEventListener('click', onClick, true);
          for (const el of document.querySelectorAll('.' + COLLAPSED + ', .' + EXPANDED)) {
            el.classList.remove(COLLAPSED, EXPANDED);
          }
        },
      };
    },
  });
})();
