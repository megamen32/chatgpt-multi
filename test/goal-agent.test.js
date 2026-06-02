const test = require('node:test');
const assert = require('node:assert/strict');

const GA = require('../src/lib/goal-agent.js');
const { makeConversation } = require('./fixtures/conversation.js');

function finalNode(id, parent, text) {
  return { id, parent, children: [], message: { id, author: { role: 'assistant' }, recipient: 'all', channel: 'final', content: { content_type: 'text', parts: [text] } } };
}
function toolNode(id, parent) {
  return { id, parent, children: [], message: { id, author: { role: 'assistant' }, recipient: 'x.callTool', channel: 'commentary', content: { content_type: 'code', text: 'CALL(...)' } } };
}
function thoughtNode(id, parent) {
  return { id, parent, children: [], message: { id, author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'thoughts', parts: ['thinking...'] } } };
}

test('extractFinalAnswer skips tool calls and reasoning, returns the final text', () => {
  const mapping = {
    root: { id: 'root', parent: null, children: ['u'], message: null },
    u: { id: 'u', parent: 'root', children: ['t'], message: { author: { role: 'user' }, recipient: 'all', content: { content_type: 'text', parts: ['do it'] } } },
    t: toolNode('t', 'u'),
    th: thoughtNode('th', 't'),
    f: finalNode('f', 'th', 'Here is the final answer.'),
  };
  const data = { mapping, current_node: 'f', root: 'root' };
  assert.equal(GA.extractFinalAnswer(data), 'Here is the final answer.');
});

test('extractFinalAnswer returns latest final answer along the active branch', () => {
  const mapping = {
    root: { id: 'root', parent: null, children: ['f1'], message: null },
    f1: finalNode('f1', 'root', 'first answer'),
    f2: finalNode('f2', 'f1', 'second answer'),
  };
  assert.equal(GA.extractFinalAnswer({ mapping, current_node: 'f2', root: 'root' }), 'second answer');
});

test('extractFinalAnswer handles missing data', () => {
  assert.equal(GA.extractFinalAnswer(null), '');
  assert.equal(GA.extractFinalAnswer({}), '');
});

test('isFinalAnswer rejects tool/thought/non-final messages', () => {
  assert.equal(GA.isFinalAnswer(toolNode('t', 'x')), false);
  assert.equal(GA.isFinalAnswer(thoughtNode('th', 'x')), false);
  assert.equal(GA.isFinalAnswer(finalNode('f', 'x', 'ok')), true);
});

test('detectGoalMarker matches marker on its own line, ignores it inside prose', () => {
  assert.equal(GA.detectGoalMarker('GOAL REACHED GOAL'), true);
  assert.equal(GA.detectGoalMarker('All good.\n\nGOAL REACHED GOAL'), true);
  assert.equal(GA.detectGoalMarker('Please reply with GOAL REACHED GOAL when done'), false);
  assert.equal(GA.detectGoalMarker('still missing X'), false);
  assert.equal(GA.detectGoalMarker(''), false);
});

test('buildEvaluatorPrompt embeds goal + answer and the marker instruction', () => {
  const p = GA.buildEvaluatorPrompt('Build a todo app', 'Done, here it is.');
  assert.ok(p.includes('Build a todo app'));
  assert.ok(p.includes('Done, here it is.'));
  assert.ok(p.includes(GA.GOAL_MARKER));
  assert.ok(/не изобретай новых требований/i.test(p));
});

test('MEMORY_DISABLE_FEATURES is the documented set', () => {
  assert.deepEqual(GA.MEMORY_DISABLE_FEATURES, ['hive_referenced_in_internal_knowledge', 'sunshine']);
});

test('parses the real responce.json fixture if present', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(__dirname, '..', 'responce.json');
  if (!fs.existsSync(file)) return; // fixture optional / gitignored
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; } // truncated curl dump
  const answer = GA.extractFinalAnswer(data);
  assert.equal(typeof answer, 'string');
});
