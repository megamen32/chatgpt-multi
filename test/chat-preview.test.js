const test = require('node:test');
const assert = require('node:assert/strict');

const { extractPreview, excerpt, messageText } = require('../src/lib/chat-preview.js');
const { makeConversation } = require('./fixtures/conversation.js');

test('extractPreview returns the most recent user + assistant text', () => {
  const data = makeConversation(5); // questions/answers 0..4
  const p = extractPreview(data);
  assert.equal(p.user, 'question 4');
  assert.equal(p.assistant, 'answer 4');
});

test('extractPreview follows the active branch only', () => {
  const data = makeConversation(10, { branchAt: 3 });
  const p = extractPreview(data);
  assert.equal(p.user, 'question 9');
  assert.equal(p.assistant, 'answer 9');
});

test('extractPreview tolerates missing/bad data', () => {
  assert.deepEqual(extractPreview(null), { user: '', assistant: '' });
  assert.deepEqual(extractPreview({}), { user: '', assistant: '' });
});

test('messageText joins multimodal parts and ignores non-text', () => {
  const node = { message: { author: { role: 'user' }, content: { parts: ['hello', { text: 'world' }, { asset_pointer: 'x' }] } } };
  assert.equal(messageText(node), 'hello\nworld');
});

test('excerpt returns full text when short', () => {
  assert.equal(excerpt('short text', 200, 200), 'short text');
});

test('excerpt clips long text to head … tail', () => {
  const long = 'A'.repeat(300) + 'B'.repeat(300);
  const e = excerpt(long, 200, 200);
  assert.ok(e.startsWith('A'.repeat(200)));
  assert.ok(e.endsWith('B'.repeat(200)));
  assert.ok(e.includes(' … '));
  assert.ok(e.length < long.length);
});

test('excerpt collapses runs of spaces/blank lines', () => {
  assert.equal(excerpt('a    b\n\n\n\nc'), 'a b\n\nc');
});
