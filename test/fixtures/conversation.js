/*
 * Builds a realistic ChatGPT GET /backend-api/conversation/{id} payload.
 *
 * Real payloads are a tree: `mapping` is an id -> node map, each node has
 * parent/children and a `message` (or null for the synthetic root). The active
 * branch is found by walking parents from `current_node` up to `root`. We model
 * exactly that so the trim logic is exercised against the real shape.
 */
function msgNode(id, parent, role, text) {
  return {
    id,
    parent,
    children: [],
    message: {
      id,
      author: { role, name: null, metadata: {} },
      create_time: 1700000000 + Number(String(id).replace(/\D/g, '') || 0),
      content: { content_type: 'text', parts: [text] },
      status: 'finished_successfully',
      metadata: {},
    },
  };
}

/**
 * @param {number} pairs Number of user/assistant exchanges (=> 2*pairs messages).
 * @param {object} [opts] { withSystem: boolean, branchAt: number|null }
 */
function makeConversation(pairs, opts = {}) {
  const mapping = {
    root: { id: 'root', parent: null, children: [], message: null },
  };
  let prev = 'root';
  // optional system/root message node
  if (opts.withSystem) {
    const sys = msgNode('sys', prev, 'system', '');
    sys.message.author.role = 'system';
    sys.message.content = { content_type: 'text', parts: [''] };
    mapping.sys = sys;
    mapping[prev].children.push('sys');
    prev = 'sys';
  }

  let last = prev;
  for (let i = 0; i < pairs; i++) {
    const uId = `u${i}`;
    const aId = `a${i}`;
    mapping[uId] = msgNode(uId, last, 'user', `question ${i}`);
    mapping[last].children.push(uId);
    mapping[aId] = msgNode(aId, uId, 'assistant', `answer ${i}`);
    mapping[uId].children.push(aId);
    last = aId;
  }

  // Optionally add an abandoned side branch to ensure trim follows current_node
  if (Number.isInteger(opts.branchAt) && opts.branchAt < pairs) {
    const parent = `a${opts.branchAt}`;
    const stray = msgNode('stray', parent, 'user', 'abandoned branch');
    mapping.stray = stray;
    mapping[parent].children.push('stray');
  }

  return {
    title: 'Test Conversation',
    create_time: 1700000000,
    update_time: 1700000999,
    mapping,
    current_node: last,
    root: 'root',
    conversation_id: 'abc-123',
  };
}

/** Count user/assistant/tool message nodes on the active path from current_node. */
function activePathMessageCount(data) {
  const { mapping } = data;
  let id = data.current_node;
  let n = 0;
  const seen = new Set();
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    const role = mapping[id].message && mapping[id].message.author && mapping[id].message.author.role;
    if (role === 'user' || role === 'assistant' || role === 'tool') n++;
    id = mapping[id].parent;
  }
  return n;
}

module.exports = { makeConversation, msgNode, activePathMessageCount };
