const test = require('node:test');
const assert = require('node:assert/strict');

const { normalize, sortByRecent, filterByQuery, prepare } = require('../src/lib/picker-model.js');

const RAW = [
  { id: 'a', title: 'Alpha', update_time: 100 },
  { id: 'b', title: '  Beta ', update_time: 300 },
  { id: 'c', title: '', update_time: 200 },
  { id: null, title: 'ignored' },
  { title: 'no id' },
];

test('normalize keeps valid items, trims titles, defaults empty title', () => {
  const out = normalize(RAW);
  assert.equal(out.length, 3);
  assert.equal(out.find((x) => x.id === 'b').title, 'Beta');
  assert.equal(out.find((x) => x.id === 'c').title, 'Без названия');
});

test('normalize tolerates non-array', () => {
  assert.deepEqual(normalize(null), []);
  assert.deepEqual(normalize(undefined), []);
});

test('sortByRecent orders by update_time desc', () => {
  const out = sortByRecent(normalize(RAW));
  assert.deepEqual(out.map((x) => x.id), ['b', 'c', 'a']);
});

test('filterByQuery is case-insensitive substring match; empty query passes all', () => {
  const list = normalize(RAW);
  assert.equal(filterByQuery(list, 'be').length, 1);
  assert.equal(filterByQuery(list, 'BET')[0].id, 'b');
  assert.equal(filterByQuery(list, '').length, 3);
  assert.equal(filterByQuery(list, '   ').length, 3);
});

test('prepare normalizes, sorts, filters in one call', () => {
  const out = prepare(RAW, 'a');
  // titles containing "a": Alpha, Beta -> sorted by recency: Beta(300), Alpha(100)
  assert.deepEqual(out.map((x) => x.id), ['b', 'a']);
});
