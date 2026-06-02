/*
 * Pure Telegram helpers: split long messages to fit the 4096-char limit
 * (preferring line/space boundaries), format durations and the final report.
 * Network calls live in the background service worker. Kept pure for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).telegram = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TG_LIMIT = 4096;

  /** Split into chunks <= limit, breaking on newlines/spaces when possible. */
  function chunkText(text, limit = TG_LIMIT) {
    const s = String(text == null ? '' : text);
    if (s.length <= limit) return s.length ? [s] : [];
    const chunks = [];
    let rest = s;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf('\n', limit);
      if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
      if (cut < limit * 0.5) cut = limit; // no good boundary: hard cut
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
    if (rest.length) chunks.push(rest);
    return chunks;
  }

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.round(Number(ms) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (h) parts.push(`${h}ч`);
    if (m) parts.push(`${m}м`);
    if (!h && !m) parts.push(`${s}с`);
    else if (s && !h) parts.push(`${s}с`);
    return parts.join(' ');
  }

  function formatFinalReport({ goal, durationMs, messageCount }) {
    return [
      '✅ ЦЕЛЬ ДОСТИГНУТА',
      '',
      `Цель: ${String(goal || '').trim()}`,
      `Время выполнения: ${formatDuration(durationMs)}`,
      `Сообщений (от агента к исполнителю): ${messageCount}`,
    ].join('\n');
  }

  return { TG_LIMIT, chunkText, formatDuration, formatFinalReport };
});
