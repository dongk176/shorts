'use strict';

// ASTs contain parent/prev backlinks; only nodes are recursive walker edges.
module.exports = function assertBoundedAst(ast) {
  const pending = [{ node: ast, depth: 0 }];
  const seen = new Set();
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth >= 128 || ++count > 65536 || seen.has(node)) {
      throw new RangeError('Brace AST exceeds safe depth or size, or contains a cycle');
    }
    seen.add(node);
    if (Array.isArray(node.nodes)) {
      if (count + pending.length + node.nodes.length > 65536) {
        throw new RangeError('Brace AST exceeds safe size');
      }
      for (const child of node.nodes) pending.push({ node: child, depth: depth + 1 });
    }
  }
};
