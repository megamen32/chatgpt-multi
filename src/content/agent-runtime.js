/*
 * Agent runtime (ISOLATED, runs inside chatgpt.com pane iframes). Bridges the
 * workspace controller (app.js, parent window) to a pane: executes commands
 * (send a prompt, read the final answer, disable memory, start a new chat) and
 * reports generation-state changes so the controller knows when a turn ended.
 *
 * The controller is trusted (it's the extension page that hosts this iframe),
 * so commands are accepted only from window.parent.
 */
(function () {
  if (window.parent === window) return; // only meaningful as an embedded pane
  const A = window.CGPTMP && window.CGPTMP.chatgptAdapter;
  const GA = window.CGPTMP && window.CGPTMP.goalAgent;
  const CP = window.CGPTMP && window.CGPTMP.chatPreview;
  if (!A || !GA) { console.warn('[CGPTMP] agent-runtime: deps missing'); return; }

  function reply(requestId, payload) {
    try { window.parent.postMessage(Object.assign({ type: 'cgptmp:reply', requestId }, payload), '*'); } catch {}
  }

  async function handle(cmd, msg) {
    switch (cmd) {
      case 'status':
        return { generating: A.isGenerating(), convId: A.convId() };
      case 'send': {
        const ok = await A.sendPrompt(String(msg.text || ''));
        return { ok };
      }
      case 'getFinalAnswer': {
        try {
          const data = await A.fetchConversation(msg.convId);
          return { ok: true, finalAnswer: GA.extractFinalAnswer(data), convId: A.convId() };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      }
      case 'patchMemory': {
        const features = (msg.features && msg.features.length) ? msg.features : GA.MEMORY_DISABLE_FEATURES;
        const results = {};
        for (const f of features) {
          try { results[f] = await A.patchSetting(f, 'false'); } catch { results[f] = false; }
        }
        return { ok: true, results };
      }
      case 'chatStatus': {
        const out = { generating: A.isGenerating(), convId: A.convId(), title: document.title, url: location.href, userAt: 0, assistantAt: 0 };
        try {
          if (CP && A.convId()) { const data = await A.fetchConversation(); const a = CP.lastActivity(data); out.userAt = a.userAt; out.assistantAt = a.assistantAt; }
        } catch {}
        return out;
      }
      case 'newChat':
        location.assign('/');
        return { ok: true };
      default:
        return { ok: false, error: 'unknown-cmd' };
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const msg = e.data;
    if (!msg || msg.type !== 'cgptmp:cmd' || !msg.cmd) return;
    Promise.resolve(handle(msg.cmd, msg)).then((res) => reply(msg.requestId, res));
  });

  // Report generation-state changes. To avoid firing on brief streaming gaps
  // (and the window between the stop button vanishing and image-gen finishing),
  // a transition to "idle" must hold for two consecutive polls before we emit.
  let reported = null; // last value we told the parent
  let idleStreak = 0;
  setInterval(() => {
    const gen = A.isGenerating();
    if (gen) idleStreak = 0; else idleStreak++;
    const stable = gen ? true : idleStreak >= 2; // ~1.2s of confirmed idle
    const value = gen ? true : (stable ? false : reported);
    if (value !== reported && value !== null) {
      reported = value;
      try { window.parent.postMessage({ type: 'cgptmp:gen', generating: value, convId: A.convId() }, '*'); } catch {}
    }
  }, 600);
})();
