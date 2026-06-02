/*
 * Pure conversation-trimming logic.
 *
 * ChatGPT loads an entire conversation via GET /backend-api/conversation/{id}.
 * For very long chats the returned `mapping` can contain thousands of message
 * nodes; rendering all of them is what makes long chats freeze. We keep only
 * the last N messages on the active path and rewrite the mapping into a simple
 * linear chain, which is enough for ChatGPT to render and keep working.
 *
 * This file is intentionally dependency-free and side-effect-free so it can be
 * unit-tested in Node and loaded as a classic content script in the MAIN world.
 * Adapted from the open-source "ChatGPT Performance Long Chats" extension.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).trim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function isMessageNode(node) {
    const msg = node && node.message;
    const role = msg && msg.author && msg.author.role;
    return !!(node && node.id && msg && msg.content && (role === 'user' || role === 'assistant' || role === 'tool'));
  }

  function collectPathToRoot(mapping, startId) {
    const ids = [];
    const seen = new Set();
    let currentId = startId;
    while (currentId && mapping[currentId] && !seen.has(currentId)) {
      seen.add(currentId);
      ids.push(currentId);
      currentId = mapping[currentId].parent || null;
    }
    return ids;
  }

  /**
   * @param {object} data  Parsed conversation JSON from the backend.
   * @param {number} keepCount  How many trailing messages to keep.
   * @returns {object|null} A trimmed clone, or null when no trimming is needed
   *                        (caller should then pass through the original).
   */
  function trimConversationData(data, keepCount) {
    if (!data || typeof data !== 'object') return null;
    if (!data.mapping || typeof data.mapping !== 'object') return null;
    if (!data.current_node) return null;
    if (!Number.isFinite(keepCount) || keepCount <= 0) return null;

    const mapping = data.mapping;
    const messageNodes = Object.values(mapping).filter(isMessageNode);
    if (messageNodes.length <= keepCount) return null;

    const pathIds = collectPathToRoot(mapping, data.current_node);
    const orderedMessages = pathIds
      .map((id) => mapping[id])
      .filter(isMessageNode)
      .reverse();

    const keptMessages = orderedMessages.slice(-keepCount);
    if (!keptMessages.length) return null;

    const rootId = data.root || 'root';
    const newMapping = {
      [rootId]: { id: rootId, parent: null, children: [], message: null },
    };

    let prevId = rootId;
    for (const node of keptMessages) {
      const id = node.id;
      newMapping[id] = Object.assign({}, node, { parent: prevId, children: [] });
      newMapping[prevId].children.push(id);
      prevId = id;
    }

    return Object.assign({}, data, {
      mapping: newMapping,
      current_node: prevId,
      root: rootId,
    });
  }

  return { trimConversationData, isMessageNode, collectPathToRoot };
});
