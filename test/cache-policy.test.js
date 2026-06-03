const test = require('node:test');
const assert = require('node:assert/strict');

const { evictionPlan } = require('../src/lib/cache-policy.js');

const MB = 1024 * 1024;
function e(id, t, mb) { return { id, updatedAt: t, size: mb * MB }; }

test('no eviction when under both limits', () => {
  const entries = [e('a', 3, 10), e('b', 2, 10), e('c', 1, 10)];
  assert.deepEqual(evictionPlan(entries, { maxChats: 10, maxBytes: 100 * MB }), []);
});

test('count cap evicts the oldest beyond N', () => {
  const entries = [e('a', 5, 1), e('b', 4, 1), e('c', 3, 1), e('d', 2, 1), e('e', 1, 1)];
  const out = evictionPlan(entries, { maxChats: 3, maxBytes: 1000 * MB });
  assert.deepEqual(out.sort(), ['d', 'e']);
});

test('size cap evicts oldest survivors until under the byte budget', () => {
  const entries = [e('a', 3, 40), e('b', 2, 40), e('c', 1, 40)]; // 120MB total
  const out = evictionPlan(entries, { maxChats: 100, maxBytes: 100 * MB });
  assert.deepEqual(out, ['c']); // dropping oldest 40MB -> 80MB <= 100
});

test('count and size caps combine', () => {
  const entries = [e('a', 4, 60), e('b', 3, 60), e('c', 2, 60), e('d', 1, 60)];
  const out = evictionPlan(entries, { maxChats: 3, maxBytes: 100 * MB });
  // count cap drops d; size: a+b+c=180>100 -> drop c (120) -> drop b (60) ok
  assert.ok(out.includes('d'));
  assert.ok(out.includes('c'));
  assert.ok(out.includes('b'));
  assert.ok(!out.includes('a'));
});

test('handles empty / bad input', () => {
  assert.deepEqual(evictionPlan([], { maxChats: 1, maxBytes: 1 }), []);
  assert.deepEqual(evictionPlan(null, {}), []);
});
