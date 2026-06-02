const test = require('node:test');
const assert = require('node:assert/strict');

const { createQueue } = require('../src/lib/queue-model.js');

test('starts empty (or from initial array, filtering non-strings)', () => {
  assert.equal(createQueue().length, 0);
  const q = createQueue(['a', 2, null, 'b']);
  assert.deepEqual(q.items, ['a', 'b']);
});

test('add trims and rejects blanks', () => {
  const q = createQueue();
  assert.equal(q.add('  hi  '), true);
  assert.equal(q.add('   '), false);
  assert.equal(q.add(''), false);
  assert.deepEqual(q.items, ['hi']);
});

test('addBulk adds many and returns count, skipping blanks', () => {
  const q = createQueue();
  assert.equal(q.addBulk(['one', '', '  ', 'two']), 2);
  assert.deepEqual(q.items, ['one', 'two']);
});

test('removeAt / updateAt with bounds checking', () => {
  const q = createQueue(['a', 'b', 'c']);
  assert.equal(q.removeAt(5), false);
  assert.equal(q.removeAt(1), true);
  assert.deepEqual(q.items, ['a', 'c']);
  assert.equal(q.updateAt(0, ' X '), true);
  assert.deepEqual(q.items, ['X', 'c']);
  assert.equal(q.updateAt(0, '  '), false, 'blank update rejected');
});

test('move / moveUp / moveDown reorder correctly', () => {
  const q = createQueue(['a', 'b', 'c']);
  assert.equal(q.moveUp(2), true);
  assert.deepEqual(q.items, ['a', 'c', 'b']);
  assert.equal(q.moveDown(0), true);
  assert.deepEqual(q.items, ['c', 'a', 'b']);
  assert.equal(q.move(0, 0), false, 'no-op move rejected');
  assert.equal(q.moveUp(0), false, 'cannot move first up');
});

test('peek does not remove, shift removes FIFO', () => {
  const q = createQueue(['first', 'second']);
  assert.equal(q.peek(), 'first');
  assert.equal(q.length, 2);
  assert.equal(q.shift(), 'first');
  assert.equal(q.shift(), 'second');
  assert.equal(q.shift(), null);
  assert.equal(q.peek(), null);
});

test('clear empties and reports whether it had items', () => {
  const q = createQueue(['a']);
  assert.equal(q.clear(), true);
  assert.equal(q.isEmpty(), true);
  assert.equal(q.clear(), false);
});

test('items getter returns a copy (no external mutation)', () => {
  const q = createQueue(['a']);
  q.items.push('hacked');
  assert.deepEqual(q.items, ['a']);
});
