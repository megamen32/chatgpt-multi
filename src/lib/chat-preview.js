/*
 * Pure helpers for chat previews in the picker: from a full conversation
 * payload, pull the most recent user message and the most recent assistant
 * message, and make a short "first N … last N chars" excerpt that can be
 * expanded. No DOM/fetch — the picker does the fetching + rendering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).chatPreview = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function messageText(node) {
    const c = node && node.message && node.message.content;
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

  function roleOf(node) {
    return node && node.message && node.message.author && node.message.author.role;
  }

  /**
   * Walk the active branch from current_node up to root, capturing the latest
   * user + assistant message text.
   * @returns {{user:string, assistant:string}}
   */
  function extractPreview(data) {
    const out = { user: '', assistant: '' };
    if (!data || !data.mapping || !data.current_node) return out;
    const mapping = data.mapping;
    const seen = new Set();
    let id = data.current_node;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      const node = mapping[id];
      const role = roleOf(node);
      if (role === 'assistant' && !out.assistant) {
        const t = messageText(node);
        if (t) out.assistant = t;
      } else if (role === 'user' && !out.user) {
        const t = messageText(node);
        if (t) out.user = t;
      }
      if (out.user && out.assistant) break;
      id = node.parent;
    }
    return out;
  }

  /**
   * "first head chars … last tail chars" when the text is long; otherwise the
   * whole (whitespace-collapsed) text.
   */
  function excerpt(text, head = 200, tail = 200) {
    const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (clean.length <= head + tail + 3) return clean;
    return clean.slice(0, head).trim() + ' … ' + clean.slice(-tail).trim();
  }

  /**
   * Latest user/assistant message timestamps (epoch seconds) on the active
   * branch — used by /status to tell whether a chat is "alive".
   * @returns {{userAt:number, assistantAt:number}}
   */
  function lastActivity(data) {
    const out = { userAt: 0, assistantAt: 0 };
    if (!data || !data.mapping || !data.current_node) return out;
    const mapping = data.mapping;
    const seen = new Set();
    let id = data.current_node;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      const node = mapping[id];
      const r = node.message && node.message.author && node.message.author.role;
      const t = node.message && node.message.create_time;
      if (r === 'assistant' && !out.assistantAt && t) out.assistantAt = t;
      if (r === 'user' && !out.userAt && t) out.userAt = t;
      if (out.userAt && out.assistantAt) break;
      id = node.parent;
    }
    return out;
  }

  return { extractPreview, excerpt, messageText, lastActivity };
});
