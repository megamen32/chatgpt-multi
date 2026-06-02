/*
 * Goal controller (runs in the workspace page, app.html). Orchestrates the goal
 * loop across an executor pane and an agent pane by exchanging postMessage
 * commands with their agent-runtime content scripts, and reports to Telegram via
 * the background service worker. Pure decisions come from goal-loop.js; this is
 * the side-effecting glue.
 *
 * Exposed as window.CGPTMP.createGoalController(ctx) where ctx provides:
 *   getIframe(paneId) -> HTMLIFrameElement | null
 *   ensureLoaded(paneId) -> void           (focus/mount a pane)
 *   getSettings() -> settings object
 *   notify(text) -> void                   (surface status to the user)
 */
(function () {
  const CGPTMP = (window.CGPTMP = window.CGPTMP || {});
  const GA = CGPTMP.goalAgent;
  const TG = CGPTMP.telegram;
  const GL = CGPTMP.goalLoop;
  const SESSION_KEY = 'cgptmp.goal.session';

  function createGoalController(ctx) {
    let session = null; // goal-loop instance
    let cfg = null; // { goal, executorPaneId, agentPaneId, marker }
    const gen = new Map(); // paneId -> generating?
    const pending = new Map(); // requestId -> resolver
    let reqSeq = 0;

    function tg(text) {
      const s = ctx.getSettings();
      if (!s.tgEnabled || !s.tgBotToken || !s.tgUserId) return;
      chrome.runtime.sendMessage({ type: 'tg-send', text });
    }

    function persist() {
      if (!session || !cfg) { chrome.storage.local.remove(SESSION_KEY); return; }
      chrome.storage.local.set({ [SESSION_KEY]: { cfg, state: session.snapshot() } });
    }

    // ---- command/reply transport over postMessage ----
    function sendCmd(paneId, cmd, extra = {}, timeout = 8000) {
      const frame = ctx.getIframe(paneId);
      if (!frame || !frame.contentWindow) return Promise.reject(new Error('pane not loaded'));
      const requestId = `r${++reqSeq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('cmd timeout: ' + cmd)); }, timeout);
        pending.set(requestId, (payload) => { clearTimeout(timer); pending.delete(requestId); resolve(payload); });
        frame.contentWindow.postMessage(Object.assign({ type: 'cgptmp:cmd', cmd, requestId }, extra), '*');
      });
    }

    async function waitPaneReady(paneId, tries = 20) {
      for (let i = 0; i < tries; i++) {
        try {
          const st = await sendCmd(paneId, 'status', {}, 2000);
          if (st && !st.generating) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    }

    // ---- loop actions ----
    async function dispatch(action) {
      if (!action || action.type === 'noop' || action.type === 'wait') { persist(); return; }
      if (action.type === 'sendToExecutor') {
        ctx.ensureLoaded(cfg.executorPaneId);
        await waitPaneReady(cfg.executorPaneId);
        await sendCmd(cfg.executorPaneId, 'send', { text: action.text }).catch(() => {});
      } else if (action.type === 'sendToAgent') {
        ctx.ensureLoaded(cfg.agentPaneId);
        // fresh, memory-clean chat for each evaluation
        await sendCmd(cfg.agentPaneId, 'newChat').catch(() => {});
        await waitPaneReady(cfg.agentPaneId);
        const s = ctx.getSettings();
        if (s.goalDisableMemory) await sendCmd(cfg.agentPaneId, 'patchMemory', { features: GA.MEMORY_DISABLE_FEATURES }).catch(() => {});
        await sendCmd(cfg.agentPaneId, 'send', { text: action.text }).catch(() => {});
      } else if (action.type === 'finish') {
        tg(action.report);
        ctx.notify('🎯 Цель достигнута. ' + (action.report || ''));
        session = null; cfg = null;
      } else if (action.type === 'abort') {
        ctx.notify('⏹ Goal Agent остановлен: ' + (action.reason || ''));
        session = null; cfg = null;
      }
      persist();
    }

    // ---- turn-end handling ----
    async function onPaneTurnEnded(paneId) {
      if (!session || !cfg) return;
      if (paneId === cfg.executorPaneId && session.state.phase === 'awaitingExecutor') {
        let answer = '';
        try { const r = await sendCmd(paneId, 'getFinalAnswer'); answer = (r && r.finalAnswer) || ''; } catch {}
        const s = ctx.getSettings();
        if (answer && s.tgEnabled && s.tgForwardExecutor) tg(answer);
        await dispatch(session.onExecutorIdle(answer));
      } else if (paneId === cfg.agentPaneId && session.state.phase === 'awaitingAgent') {
        let answer = '';
        try { const r = await sendCmd(paneId, 'getFinalAnswer'); answer = (r && r.finalAnswer) || ''; } catch {}
        const s = ctx.getSettings();
        if (answer && s.tgEnabled && s.tgForwardAgent && s.tgSendAgentOpinion) tg('🧭 Агент: ' + answer);
        await dispatch(session.onAgentIdle(answer));
      }
    }

    // ---- public: window message handler (called by app.js) ----
    function handleMessage(e) {
      const d = e.data;
      if (!d) return;
      if (d.type === 'cgptmp:reply' && d.requestId && pending.has(d.requestId)) {
        pending.get(d.requestId)(d);
        return;
      }
      if (d.type === 'cgptmp:gen' && cfg) {
        // map source window -> paneId
        const paneId = ctx.paneIdForSource ? ctx.paneIdForSource(e.source) : null;
        if (!paneId) return;
        const was = gen.get(paneId);
        gen.set(paneId, d.generating);
        if (was === true && d.generating === false) onPaneTurnEnded(paneId);
      }
    }

    // ---- TG inbound (called by app.js on inbox change) ----
    function handleTgInbound(items) {
      const s = ctx.getSettings();
      if (!s.tgEnabled || !s.tgInboundToExecutor) return;
      const target = (cfg && cfg.executorPaneId) || ctx.boundPaneId && ctx.boundPaneId();
      if (!target) return;
      for (const it of items) {
        ctx.ensureLoaded(target);
        sendCmd(target, 'send', { text: it.text }).catch(() => {});
      }
    }

    function start({ goal, executorPaneId, agentPaneId }) {
      if (!goal || !executorPaneId || !agentPaneId) return false;
      const s = ctx.getSettings();
      cfg = { goal, executorPaneId, agentPaneId, marker: s.goalMarker || GA.GOAL_MARKER };
      session = GL.createGoalSession({
        goal,
        marker: cfg.marker,
        maxIterations: s.goalMaxIterations,
        buildEvaluatorPrompt: GA.buildEvaluatorPrompt,
        detectGoalMarker: GA.detectGoalMarker,
        formatReport: TG.formatFinalReport,
      });
      ctx.ensureLoaded(executorPaneId);
      dispatch(session.start());
      ctx.notify('🎯 Goal Agent запущен');
      return true;
    }

    function stop() {
      if (session) dispatch(session.abort('manual'));
      else { session = null; cfg = null; persist(); }
    }

    function restore() {
      chrome.storage.local.get([SESSION_KEY], (res) => {
        const saved = res && res[SESSION_KEY];
        if (!saved || !saved.cfg) return;
        // We restore config + a fresh session in the saved phase is non-trivial;
        // for safety we just surface that a session was active and let the user
        // resume by pressing Goal again. (Full mid-phase resume is future work.)
        ctx.notify('ℹ️ Прерванная Goal-сессия найдена. Нажмите 🎯, чтобы запустить заново.');
        chrome.storage.local.remove(SESSION_KEY);
      });
    }

    function isActive() { return !!session; }

    async function requestFinalAnswer(paneId) {
      try { const r = await sendCmd(paneId, 'getFinalAnswer'); return (r && r.finalAnswer) || ''; }
      catch { return ''; }
    }

    return { start, stop, handleMessage, handleTgInbound, restore, isActive, requestFinalAnswer };
  }

  CGPTMP.createGoalController = createGoalController;
})();
