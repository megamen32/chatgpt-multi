const test = require('node:test');
const assert = require('node:assert/strict');

const { createPaneStore } = require('../src/lib/pane-store.js');

// Deterministic ids for assertions.
function makeStore(settings = { lazyPanes: true }) {
  let n = 0;
  const store = createPaneStore({ uid: () => `id${n++}`, inferTitle: () => 'T' });
  store.init(null, settings);
  return store;
}

test('init with no saved state creates one default pane, focused & loaded', () => {
  const s = makeStore();
  assert.equal(s.state.panes.length, 1);
  assert.equal(s.state.focusedId, s.state.panes[0].id);
  assert.equal(s.isLoaded(s.state.panes[0].id), true);
});

test('lazy init loads only the focused pane', () => {
  let n = 0;
  const store = createPaneStore({ uid: () => `id${n++}` });
  store.init({ panes: [{ id: 'a', url: 'u', picker: false }, { id: 'b', url: 'u', picker: false }], focusedId: 'b' }, { lazyPanes: true });
  assert.equal(store.isLoaded('b'), true);
  assert.equal(store.isLoaded('a'), false, 'non-focused pane stays asleep');
});

test('non-lazy init loads every pane', () => {
  const store = createPaneStore({ uid: () => 'x' });
  store.init({ panes: [{ id: 'a' }, { id: 'b' }], focusedId: 'a' }, { lazyPanes: false });
  assert.equal(store.isLoaded('a'), true);
  assert.equal(store.isLoaded('b'), true);
});

test('focusPane on a sleeping pane is structural and loads it', () => {
  const store = createPaneStore({ uid: () => 'x' });
  store.init({ panes: [{ id: 'a' }, { id: 'b' }], focusedId: 'a' }, { lazyPanes: true });
  const r = store.focusPane('b');
  assert.equal(r.structural, true);
  assert.equal(store.isLoaded('b'), true);
  assert.equal(store.state.focusedId, 'b');
});

test('focusPane on an already-loaded pane is non-structural', () => {
  const store = createPaneStore({ uid: () => 'x' });
  store.init({ panes: [{ id: 'a' }, { id: 'b' }], focusedId: 'a' }, { lazyPanes: true });
  store.focusPane('b'); // loads b
  const r = store.focusPane('a'); // a was loaded as initial focus
  assert.equal(r.structural, false);
});

test('addPane appends, focuses and loads the new pane', () => {
  const s = makeStore();
  const p = s.addPane('https://chatgpt.com/?cgpt_picker=1', true);
  assert.equal(s.state.panes.length, 2);
  assert.equal(s.state.focusedId, p.id);
  assert.equal(s.isLoaded(p.id), true);
});

test('closePane removes pane, frees its load slot, refocuses a neighbour', () => {
  const s = makeStore();
  const p1 = s.addPane('u', false);
  const p2 = s.addPane('u', false);
  s.closePane(p2.id);
  assert.equal(s.state.panes.find((p) => p.id === p2.id), undefined);
  assert.equal(s.isLoaded(p2.id), false);
  assert.ok(s.state.panes.some((p) => p.id === s.state.focusedId));
});

test('closing the last pane recreates a default pane', () => {
  const s = makeStore();
  s.closePane(s.state.panes[0].id);
  assert.equal(s.state.panes.length, 1);
  assert.equal(s.isLoaded(s.state.focusedId), true);
});

test('unloadPane frees memory but keeps the pane', () => {
  const s = makeStore();
  const id = s.state.panes[0].id;
  assert.equal(s.unloadPane(id), true);
  assert.equal(s.isLoaded(id), false);
  assert.equal(s.state.panes.length, 1);
  assert.equal(s.unloadPane(id), false, 'idempotent when already unloaded');
});

test('setLazy(false) mounts all panes', () => {
  const store = createPaneStore({ uid: () => 'x' });
  store.init({ panes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], focusedId: 'a' }, { lazyPanes: true });
  assert.equal(store.isLoaded('b'), false);
  store.setLazy(false);
  assert.equal(store.isLoaded('a'), true);
  assert.equal(store.isLoaded('b'), true);
  assert.equal(store.isLoaded('c'), true);
});

test('duplicateFocused clones url/picker of the focused pane', () => {
  const s = makeStore();
  s.state.panes[0].url = 'https://chatgpt.com/c/abc';
  s.state.panes[0].picker = false;
  const dup = s.duplicateFocused();
  assert.equal(dup.url, 'https://chatgpt.com/c/abc');
  assert.equal(dup.picker, false);
});

test('init clamps to MAX_PANES', () => {
  const many = { panes: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` })), focusedId: 'p0' };
  const store = createPaneStore({ uid: () => 'x' });
  store.init(many, { lazyPanes: true });
  assert.equal(store.state.panes.length, store.MAX_PANES);
});

test('init ignores a stale focusedId not present in panes', () => {
  const store = createPaneStore({ uid: () => 'x' });
  store.init({ panes: [{ id: 'a' }], focusedId: 'gone' }, { lazyPanes: true });
  assert.equal(store.state.focusedId, 'a');
});

test('snapshot returns only persisted fields', () => {
  const s = makeStore();
  const snap = s.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), ['focusedId', 'panes']);
});
