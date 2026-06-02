/*
 * Feature: auto-confirm Custom GPT Action dialogs, and optionally auto-expand
 * tool-call sections. Registers definitions consumed by features-bundle.js.
 * DOM glue around the pure confirm-match lib.
 */
(function () {
  const CM = window.CGPTMP && window.CGPTMP.confirmMatch;
  const defs = (window.CGPTMP = window.CGPTMP || {}).featureDefs = window.CGPTMP.featureDefs || [];
  if (!CM) { console.warn('[CGPTMP] auto-confirm: confirm-match missing'); return; }

  const SEL = {
    PRIMARY: 'button.btn-primary',
    DIALOG: '[role="dialog"], [data-radix-dialog-content]',
    GROUP: '.mb-2.flex.items-center.gap-2',
    SECONDARY: '.btn-secondary',
    TEXT: 'div:not([class*="icon"]):not([class*="sprite"]), span:not([class*="icon"])',
  };

  function btnText(btn) {
    const el = btn.querySelector(SEL.TEXT);
    return (el ? el.textContent : btn.textContent) || '';
  }
  function valid(btn) {
    return !btn.disabled && !btn.ariaDisabled && btn.offsetParent !== null &&
      !btn.closest('[aria-hidden="true"], [hidden]') &&
      (typeof btn.checkVisibility !== 'function' || btn.checkVisibility());
  }
  function findConfirm() {
    for (const btn of document.querySelectorAll(SEL.PRIMARY)) {
      if (CM.isConfirmText(btnText(btn)) && valid(btn)) return btn;
    }
    const dialog = document.querySelector(SEL.DIALOG);
    if (dialog) {
      for (const btn of dialog.querySelectorAll('button, [role="button"]')) {
        if (CM.isConfirmText(btnText(btn)) && valid(btn)) return btn;
      }
    }
    for (const group of document.querySelectorAll(SEL.GROUP)) {
      const primary = group.querySelector(SEL.PRIMARY);
      if (primary && group.querySelector(SEL.SECONDARY) && CM.isConfirmText(btnText(primary)) && valid(primary)) return primary;
    }
    return null;
  }

  defs.push({
    key: 'autoConfirm',
    create() {
      return {
        tick() {
          const btn = findConfirm();
          if (btn) btn.click();
        },
        dispose() {},
      };
    },
  });

  // Optional: auto-expand tool-call sections.
  const TOOLCALL_RE = /tool\s*call|tool-call/i;
  function expandToolCalls() {
    const containers = Array.from(document.querySelectorAll('div, section, article'))
      .filter((n) => TOOLCALL_RE.test(n.textContent || ''));
    for (const c of containers) {
      const details = c.querySelector('details:not([open])');
      if (details) { details.open = true; continue; }
      const summaries = Array.from(c.querySelectorAll('summary')).filter((s) => s.parentElement && !s.parentElement.open);
      summaries.forEach((s) => { s.parentElement.open = true; });
      const buttons = Array.from(c.querySelectorAll('button[aria-expanded="false"], [data-state="closed"]'));
      buttons.forEach((b) => b.click());
    }
  }

  defs.push({
    key: 'autoExpandToolCalls',
    create() {
      return { tick() { expandToolCalls(); }, dispose() {} };
    },
  });
})();
