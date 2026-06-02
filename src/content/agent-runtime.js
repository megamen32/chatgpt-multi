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

  // Report generation-state changes (poll: robust against React DOM churn).
  let lastGen = null;
  setInterval(() => {
    const gen = A.isGenerating();
    if (gen !== lastGen) {
      lastGen = gen;
      try { window.parent.postMessage({ type: 'cgptmp:gen', generating: gen, convId: A.convId() }, '*'); } catch {}
    }
  }, 600);
})();
