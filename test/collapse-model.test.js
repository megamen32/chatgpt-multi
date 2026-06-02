const test = require('node:test');
const assert = require('node:assert/strict');

const { indicesToCollapse, shouldCollapse } = require('../src/lib/collapse-model.js');

test('collapses everything except the last keepVisible messages', () => {
  assert.deepEqual(indicesToCollapse(10, 3), [0, 1, 2, 3, 4, 5, 6]);
});

test('collapses nothing when count <= keepVisible', () => {
  assert.deepEqual(indicesToCollapse(3, 5), []);
  assert.deepEqual(indicesToCollapse(5, 5), []);
});

test('handles edge / bad input', () => {
  assert.deepEqual(indicesToCollapse(0, 5), []);
  assert.deepEqual(indicesToCollapse(-2, 5), []);
  assert.deepEqual(indicesToCollapse(4, 0), [0, 1, 2, 3]);
  assert.deepEqual(indicesToCollapse(NaN, 5), []);
});

test('shouldCollapse agrees with indicesToCollapse', () => {
  const count = 8, keep = 2;
  const set = new Set(indicesToCollapse(count, keep));
  for (let i = 0; i < count; i++) {
    assert.equal(shouldCollapse(i, count, keep), set.has(i), `index ${i}`);
  }
});
