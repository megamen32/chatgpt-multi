/*
 * Pure logic for the "goal agent" loop.
 *
 * An executor chat works on a task; after each executor turn we take ONLY the
 * final user-facing text it produced (skipping tool calls + reasoning) and ask
 * a separate memory-disabled "agent" chat to judge whether the goal is reached.
 * The agent either lists what's missing (fed back to the executor) or emits an
 * exact marker meaning done.
 *
 * No DOM/fetch here — just parsing + prompt building, so it is unit-tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).goalAgent = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GOAL_MARKER = 'GOAL REACHED GOAL';

  // Account settings to PATCH to false so the agent chat has no memory.
  // (PATCH /backend-api/settings/account_user_setting?feature=<f>&value=false)
  const MEMORY_DISABLE_FEATURES = ['hive_referenced_in_internal_knowledge', 'sunshine'];

  function content(node) { return node && node.message && node.message.content; }
  function role(node) { return node && node.message && node.message.author && node.message.author.role; }

  function messageText(node) {
    const c = content(node);
    if (!c) return '';
    if (Array.isArray(c.parts)) {
      return c.parts
        .map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    }
    if (typeof c.text === 'string') return c.text.trim();
    return '';
  }

  /**
   * Is this node the user-facing final answer? In ChatGPT's payload that means
   * an assistant text message addressed to "all" on the "final" channel. Tool
   * calls use content_type "code" / plugin recipients; reasoning uses
   * "thoughts"/"reasoning_recap" — all excluded here.
   */
  function isFinalAnswer(node) {
    const m = node && node.message;
    if (!m) return false;
    if (role(node) !== 'assistant') return false;
    if (m.recipient && m.recipient !== 'all') return false;
    const ct = m.content && m.content.content_type;
    if (ct !== 'text') return false;
    if (m.channel && m.channel !== 'final') return false;
    return true;
  }

  /** Walk the active branch up from current_node and return the latest final answer text. */
  function extractFinalAnswer(data) {
    if (!data || !data.mapping || !data.current_node) return '';
    const mapping = data.mapping;
    const seen = new Set();
    let id = data.current_node;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      const node = mapping[id];
      if (isFinalAnswer(node)) {
        const t = messageText(node);
        if (t) return t;
      }
      id = node.parent;
    }
    return '';
  }

  /** True when the agent declared the goal reached (marker on its own line). */
  function detectGoalMarker(text, marker = GOAL_MARKER) {
    if (!text) return false;
    const m = marker.trim().toLowerCase();
    return text.split(/\r?\n/).some((line) => line.trim().toLowerCase() === m) ||
      text.trim().toLowerCase() === m;
  }

  /**
   * Build the evaluator prompt. Worded to keep the agent strict and prevent it
   * from inventing extra requirements or endless "could also improve" edits.
   */
  function buildEvaluatorPrompt(goal, executorAnswer, marker = GOAL_MARKER) {
    return [
      'Ты — строгий приёмщик результата. Твоя единственная задача — проверить, достигнута ли ЗАЯВЛЕННАЯ цель.',
      'Правила: не предлагай улучшений сверх цели, не изобретай новых требований, не переписывай работу, не добавляй «было бы неплохо». Оценивай строго по факту.',
      '',
      'ЦЕЛЬ:',
      String(goal || '').trim(),
      '',
      'ФИНАЛЬНЫЙ ОТВЕТ ИСПОЛНИТЕЛЯ:',
      String(executorAnswer || '').trim(),
      '',
      `Если цель полностью достигнута — ответь РОВНО одной строкой, без кавычек и любого другого текста: ${marker}`,
      'Иначе кратко перечисли ТОЛЬКО то, чего конкретно не хватает для достижения цели. Каждый пункт — реально блокирующий недостаток, без украшательств и без предложений по улучшению.',
    ].join('\n');
  }

  return {
    GOAL_MARKER,
    MEMORY_DISABLE_FEATURES,
    messageText,
    isFinalAnswer,
    extractFinalAnswer,
    detectGoalMarker,
    buildEvaluatorPrompt,
  };
});
