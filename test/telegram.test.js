const test = require('node:test');
const assert = require('node:assert/strict');

const { chunkText, formatDuration, formatFinalReport, TG_LIMIT } = require('../src/lib/telegram.js');

test('short text -> single chunk; empty -> none', () => {
  assert.deepEqual(chunkText('hello'), ['hello']);
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText(null), []);
});

test('long text is split into <=limit chunks covering all content', () => {
  const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= TG_LIMIT, 'chunk within limit');
  // reassembling (chunks were split on newlines, which are stripped) keeps tokens
  assert.ok(chunks.join('\n').includes('line 499'));
});

test('hard-cuts when there is no whitespace boundary', () => {
  const text = 'x'.repeat(TG_LIMIT * 2 + 10);
  const chunks = chunkText(text);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, TG_LIMIT);
  assert.equal(chunks[1].length, TG_LIMIT);
});

test('prefers newline boundary near the limit', () => {
  const head = 'a'.repeat(TG_LIMIT - 5);
  const text = head + '\n' + 'b'.repeat(100);
  const chunks = chunkText(text);
  assert.equal(chunks[0], head);
  assert.equal(chunks[1], 'b'.repeat(100));
});

test('formatDuration', () => {
  assert.equal(formatDuration(65 * 60 * 1000), '1ч 5м');
  assert.equal(formatDuration(5 * 60 * 1000), '5м');
  assert.equal(formatDuration(42 * 1000), '42с');
  assert.equal(formatDuration(0), '0с');
});

test('formatFinalReport contains goal, duration, count', () => {
  const r = formatFinalReport({ goal: 'Ship it', durationMs: 65 * 60 * 1000, messageCount: 34 });
  assert.ok(r.includes('Ship it'));
  assert.ok(r.includes('1ч 5м'));
  assert.ok(r.includes('34'));
  assert.ok(r.includes('ЦЕЛЬ ДОСТИГНУТА'));
});
