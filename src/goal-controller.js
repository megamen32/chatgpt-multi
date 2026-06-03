/*
 * Goal controller (workspace page). Orchestrates the goal loop across an
 * executor pane and an agent pane by exchanging postMessage commands with their
 * agent-runtime content scripts, and reports to Telegram via the background SW.
 * Pure decisions come from goal-loop.js; this is the side-effecting glue.
 *
 * Robustness: surfaces command/load errors (toast + Telegram), reloads a broken
 * pane (e.g. a 504), supports pause/resume, and persists the session (incl. pane
 * roles) so a reload can restore it.
 *
 * ctx: getIframe, reloadPane, ensureLoaded, getSettings, notify, paneIdForSource,
 *      boundPaneId, onStatusChange
 */
(function () {
  const CGPTMP = (window.CGPTMP = window.CGPTMP || {});
  const GA = CGPTMP.goalAgent;
  const TG = CGPTMP.telegram;
  const GL = CGPTMP.goalLoop;
  const SESSION_KEY = 'cgptmp.goal.session';

  function createGoalController(ctx) {
    let session = null;
    let cfg = null; // { goal, executorPaneId, agentPaneId, marker }
    let paused = false;
    let pendingAction = null; // deferred send action while paused / after error
    const gen = new Map();
    const pending = new Map();
    let reqSeq = 0;

    function changed() { if (ctx.onStatusChange) ctx.onStatusChange(getStatus()); }

    function tg(text) {
      const s = ctx.getSettings();
      if (!s.tgEnabled || !s.tgBotToken || !s.tgUserId) return;
      chrome.runtime.sendMessage({ type: 'tg-send', text });
    }
    function error(msg) {
      ctx.notify('⚠️ ' + msg);
      console.warn('[CGPTMP] goal:', msg);
      tg('⚠️ Goal Agent: ' + msg);
    }

    function persist() {
      if (!session || !cfg) { chrome.storage.local.remove(SESSION_KEY); return; }
      chrome.storage.local.set({ [SESSION_KEY]: { cfg, state: session.snapshot(), paused } });
    }

    // ---- command/reply transport ----
    function sendCmd(paneId, cmd, extra = {}, timeout = 8000) {
      const frame = ctx.getIframe(paneId);
      if (!frame || !frame.contentWindow) return Promise.reject(new Error('панель не загружена'));
      const requestId = `r${++reqSeq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('таймаут команды ' + cmd)); }, timeout);
        pending.set(requestId, (payload) => { clearTimeout(timer); pending.delete(requestId); resolve(payload); });
        frame.contentWindow.postMessage(Object.assign({ type: 'cgptmp:cmd', cmd, requestId }, extra), '*');
      });
    }

    async function waitPaneReady(paneId, { reloadOnFail = true } = {}) {
      for (let attempt = 0; attempt < 2; attempt++) {
        for (let i = 0; i < 16; i++) {
          try {
            const st = await sendCmd(paneId, 'status', {}, 2000);
            if (st && !st.generating) return true;
          } catch {}
          await new Promise((r) => setTimeout(r, 500));
        }
        if (reloadOnFail && attempt === 0 && ctx.reloadPane) {
          ctx.notify('↻ Перезагружаю зависшую панель…');
          ctx.reloadPane(paneId);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      throw new Error('панель не отвечает (возможно 504 — попробуйте ▶ ещё раз)');
    }

    // ---- perform a loop action ----
    async function dispatch(action) {
      if (!action || action.type === 'noop' || action.type === 'wait') { persist(); return; }

      // Defer outgoing prompts while paused.
      if (paused && (action.type === 'sendToExecutor' || action.type === 'sendToAgent')) {
        pendingAction = action; persist(); changed();
        ctx.notify('⏸ На паузе — следующий шаг отложен'); return;
      }

      try {
        if (action.type === 'sendToExecutor') {
          ctx.ensureLoaded(cfg.executorPaneId);
          await waitPaneReady(cfg.executorPaneId);
          const r = await sendCmd(cfg.executorPaneId, 'send', { text: action.text });
          if (!r || !r.ok) throw new Error('не удалось отправить исполнителю');
        } else if (action.type === 'sendToAgent') {
          ctx.ensureLoaded(cfg.agentPaneId);
          await sendCmd(cfg.agentPaneId, 'newChat').catch(() => {});
          await waitPaneReady(cfg.agentPaneId);
          const s = ctx.getSettings();
          if (s.goalDisableMemory) await sendCmd(cfg.agentPaneId, 'patchMemory', { features: GA.MEMORY_DISABLE_FEATURES }).catch(() => {});
          const r = await sendCmd(cfg.agentPaneId, 'send', { text: action.text });
          if (!r || !r.ok) throw new Error('не удалось отправить агенту');
        } else if (action.type === 'finish') {
          tg(action.report);
          ctx.notify('🎯 Цель достигнута');
          session = null; cfg = null; pendingAction = null;
        } else if (action.type === 'abort') {
          ctx.notify('⏹ Goal Agent остановлен: ' + (action.reason || ''));
          session = null; cfg = null; pendingAction = null;
        }
        pendingAction = null;
      } catch (e) {
        // Don't kill the session: pause it and keep the action for retry on ▶.
        pendingAction = action;
        paused = true;
        error(String(e && e.message ? e.message : e) + ' — сессия на паузе, нажмите ▶ для повтора');
      }
      persist(); changed();
    }

    async function onPaneTurnEnded(paneId) {
      if (!session || !cfg) return;
      if (paneId === cfg.executorPaneId && session.state.phase === 'awaitingExecutor') {
        let answer = '';
        try { const r = await sendCmd(paneId, 'getFinalAnswer'); answer = (r && r.finalAnswer) || ''; }
        catch (e) { error('не смог прочитать ответ исполнителя'); }
        const s = ctx.getSettings();
        if (answer && s.tgEnabled && s.tgForwardExecutor) tg(answer);
        await dispatch(session.onExecutorIdle(answer));
      } else if (paneId === cfg.agentPaneId && session.state.phase === 'awaitingAgent') {
        let answer = '';
        try { const r = await sendCmd(paneId, 'getFinalAnswer'); answer = (r && r.finalAnswer) || ''; }
        catch (e) { error('не смог прочитать ответ агента'); }
        const s = ctx.getSettings();
        if (answer && s.tgEnabled && s.tgForwardAgent && s.tgSendAgentOpinion) tg('🧭 Агент: ' + answer);
        await dispatch(session.onAgentIdle(answer));
      }
    }

    function handleMessage(e) {
      const d = e.data;
      if (!d) return;
      if (d.type === 'cgptmp:reply' && d.requestId && pending.has(d.requestId)) { pending.get(d.requestId)(d); return; }
      if (d.type === 'cgptmp:gen' && cfg) {
        const paneId = ctx.paneIdForSource ? ctx.paneIdForSource(e.source) : null;
        if (!paneId) return;
        const was = gen.get(paneId);
        gen.set(paneId, d.generating);
        if (was === true && d.generating === false) onPaneTurnEnded(paneId);
      }
    }

    function handleTgInbound(items) {
      const s = ctx.getSettings();
      if (!s.tgEnabled || !s.tgInboundToExecutor) return;
      const target = (cfg && cfg.executorPaneId) || (ctx.boundPaneId && ctx.boundPaneId());
      if (!target) return;
      for (const it of items) {
        ctx.ensureLoaded(target);
        sendCmd(target, 'send', { text: it.text }).catch(() => {});
      }
    }

    function buildSession(goal, marker, initialState) {
      const s = ctx.getSettings();
      return GL.createGoalSession({
        goal, marker,
        maxIterations: s.goalMaxIterations,
        buildEvaluatorPrompt: GA.buildEvaluatorPrompt,
        detectGoalMarker: GA.detectGoalMarker,
        formatReport: TG.formatFinalReport,
        initialState,
      });
    }

    function start({ goal, executorPaneId, agentPaneId }) {
      if (!goal || !executorPaneId || !agentPaneId) return false;
      const s = ctx.getSettings();
      cfg = { goal, executorPaneId, agentPaneId, marker: s.goalMarker || GA.GOAL_MARKER };
      paused = false; pendingAction = null;
      session = buildSession(goal, cfg.marker);
      ctx.ensureLoaded(executorPaneId);
      ctx.notify('🎯 Goal Agent запущен');
      dispatch(session.start());
      changed();
      return true;
    }

    function pause() { if (!session) return; paused = true; persist(); changed(); ctx.notify('⏸ Пауза. Можете вмешаться вручную, затем ▶'); }
    function resume() {
      if (!session) return;
      paused = false; persist(); changed(); ctx.notify('▶ Продолжаю');
      if (pendingAction) { const a = pendingAction; pendingAction = null; dispatch(a); }
    }
    function stop() {
      if (session) dispatch(session.abort('manual'));
      else { session = null; cfg = null; pendingAction = null; persist(); changed(); }
    }

    function restore() {
      chrome.storage.local.get([SESSION_KEY], (res) => {
        const saved = res && res[SESSION_KEY];
        if (!saved || !saved.cfg || !saved.state) return;
        const ph = saved.state.phase;
        if (ph === 'done' || ph === 'aborted' || ph === 'new') { chrome.storage.local.remove(SESSION_KEY); return; }
        cfg = saved.cfg;
        session = buildSession(cfg.goal, cfg.marker, saved.state);
        paused = true; // restored sessions start paused so the user is in control
        ctx.notify('ℹ️ Goal-сессия восстановлена и на паузе. ▶ чтобы продолжить.');
        changed();
      });
    }

    function isActive() { return !!session; }
    function isPaused() { return paused; }
    function getStatus() {
      return {
        active: !!session,
        paused,
        phase: session ? session.state.phase : null,
        executorPaneId: cfg ? cfg.executorPaneId : null,
        agentPaneId: cfg ? cfg.agentPaneId : null,
        iterations: session ? session.state.iterations : 0,
      };
    }
    function roleForPane(paneId) {
      if (!cfg) return null;
      if (paneId === cfg.executorPaneId) return 'executor';
      if (paneId === cfg.agentPaneId) return 'agent';
      return null;
    }

    async function requestFinalAnswer(paneId) {
      try { const r = await sendCmd(paneId, 'getFinalAnswer'); return (r && r.finalAnswer) || ''; }
      catch { return ''; }
    }

    return {
      start, stop, pause, resume, handleMessage, handleTgInbound, restore,
      isActive, isPaused, getStatus, roleForPane, requestFinalAnswer,
    };
  }

  CGPTMP.createGoalController = createGoalController;
})();
