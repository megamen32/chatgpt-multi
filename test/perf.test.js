const test = require('node:test');
const assert = require('node:assert/strict');

const { trimConversationData } = require('../src/lib/conversation-trim.js');
const { makeConversation, activePathMessageCount } = require('./fixtures/conversation.js');

test('perf: trimming a 4000-message chat is fast and shrinks payload', () => {
  const data = makeConversation(2000); // 4000 messages — a "freezing" long chat
  const fullSize = JSON.stringify(data).length;

  const t0 = process.hrtime.bigint();
  const trimmed = trimConversationData(data, 20);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;

  assert.ok(trimmed, 'should trim');
  assert.equal(activePathMessageCount(trimmed), 20);

  const trimmedSize = JSON.stringify(trimmed).length;
  const ratio = trimmedSize / fullSize;

  // Keeping 20 of 4000 messages should cut the payload by well over 90%.
  assert.ok(ratio < 0.05, `payload should shrink >95% (got ${(ratio * 100).toFixed(1)}%)`);

  // Trimming itself must be cheap (generous bound for slow CI).
  assert.ok(ms < 250, `trim should run under 250ms (took ${ms.toFixed(1)}ms)`);

  // Surface the numbers in test output for manual tracking.
  console.log(
    `[perf] 4000->20 msgs: ${(fullSize / 1024) | 0}KB -> ${(trimmedSize / 1024) | 0}KB ` +
      `(${(ratio * 100).toFixed(2)}%) in ${ms.toFixed(1)}ms`,
  );
});

test('perf: node count in trimmed mapping is bounded by keepCount (+root)', () => {
  const data = makeConversation(1000);
  const trimmed = trimConversationData(data, 30);
  assert.ok(Object.keys(trimmed.mapping).length <= 31);
});
