const test = require('node:test');
const assert = require('node:assert/strict');

const { trimConversationData, isMessageNode, collectPathToRoot } = require('../src/lib/conversation-trim.js');
const { makeConversation, activePathMessageCount } = require('./fixtures/conversation.js');

test('returns null (passthrough) when message count <= keepCount', () => {
  const data = makeConversation(5); // 10 messages
  assert.equal(trimConversationData(data, 20), null);
  assert.equal(trimConversationData(data, 10), null);
});

test('trims a long conversation down to the last N messages', () => {
  const data = makeConversation(50); // 100 messages
  const trimmed = trimConversationData(data, 20);
  assert.ok(trimmed, 'should trim');
  assert.equal(activePathMessageCount(trimmed), 20);
});

test('keeps the most recent messages, drops the oldest', () => {
  const data = makeConversation(50);
  const trimmed = trimConversationData(data, 4);
  // last 4 messages are u49/a49 and u48/a48 -> answers 48 and 49 present
  const texts = Object.values(trimmed.mapping)
    .filter((n) => n.message)
    .map((n) => n.message.content.parts[0]);
  assert.ok(texts.includes('answer 49'));
  assert.ok(texts.includes('question 49'));
  assert.ok(!texts.includes('answer 0'), 'old messages dropped');
});

test('produces a valid linear chain rooted at root ending at current_node', () => {
  const data = makeConversation(30);
  const trimmed = trimConversationData(data, 6);
  // walk from root following single-child links; must reach current_node
  let id = trimmed.root;
  let steps = 0;
  while (trimmed.mapping[id] && trimmed.mapping[id].children.length) {
    assert.equal(trimmed.mapping[id].children.length, 1, 'linear chain');
    id = trimmed.mapping[id].children[0];
    steps++;
    assert.ok(steps < 100, 'no infinite loop');
  }
  assert.equal(id, trimmed.current_node);
});

test('follows the active branch and ignores abandoned side branches', () => {
  const data = makeConversation(20, { branchAt: 5 });
  const trimmed = trimConversationData(data, 8);
  const texts = Object.values(trimmed.mapping)
    .filter((n) => n.message)
    .map((n) => n.message.content.parts[0]);
  assert.ok(!texts.includes('abandoned branch'), 'stray branch excluded');
});

test('handles a leading system message gracefully', () => {
  const data = makeConversation(40, { withSystem: true });
  const trimmed = trimConversationData(data, 10);
  assert.ok(trimmed);
  assert.equal(activePathMessageCount(trimmed), 10);
});

test('guards against bad input', () => {
  assert.equal(trimConversationData(null, 10), null);
  assert.equal(trimConversationData({}, 10), null);
  assert.equal(trimConversationData({ mapping: {} }, 10), null);
  assert.equal(trimConversationData(makeConversation(50), 0), null);
  assert.equal(trimConversationData(makeConversation(50), -5), null);
  assert.equal(trimConversationData(makeConversation(50), NaN), null);
});

test('does not mutate the original payload', () => {
  const data = makeConversation(30);
  const before = JSON.stringify(data);
  trimConversationData(data, 5);
  assert.equal(JSON.stringify(data), before, 'original untouched');
});

test('isMessageNode / collectPathToRoot helpers', () => {
  const data = makeConversation(3);
  assert.equal(isMessageNode(data.mapping.u0), true);
  assert.equal(isMessageNode(data.mapping.root), false);
  const path = collectPathToRoot(data.mapping, data.current_node);
  assert.equal(path[path.length - 1], 'root');
});
