import type { CanvasDocument, CanvasOperation } from "@infinite-canvas/contracts";
export function applyCanvasOperations(document: CanvasDocument, operations: readonly CanvasOperation[]): CanvasDocument {
  const next = operations.reduce(applyOperation, document);
  return next === document ? document : { ...next, revision: document.revision + 1, updatedAt: new Date().toISOString() };
}
function applyOperation(doc: CanvasDocument, op: CanvasOperation): CanvasDocument {
  switch (op.type) {
    case "node.upsert": return { ...doc, nodes: doc.nodes.some(n => n.id === op.node.id) ? doc.nodes.map(n => n.id === op.node.id ? op.node : n) : [...doc.nodes, op.node] };
    case "node.remove": { const ids = new Set(op.nodeIds); return { ...doc, nodes: doc.nodes.filter(n => !ids.has(n.id)), connections: doc.connections.filter(e => !ids.has(e.fromNodeId) && !ids.has(e.toNodeId)) }; }
    case "node.move": return { ...doc, nodes: doc.nodes.map(n => n.id === op.nodeId ? { ...n, position: op.position } : n) };
    case "node.resize": return { ...doc, nodes: doc.nodes.map(n => n.id === op.nodeId ? { ...n, ...op.size } : n) };
    case "connection.upsert": return { ...doc, connections: doc.connections.some(e => e.id === op.connection.id) ? doc.connections.map(e => e.id === op.connection.id ? op.connection : e) : [...doc.connections, op.connection] };
    case "connection.remove": { const ids = new Set(op.connectionIds); return { ...doc, connections: doc.connections.filter(e => !ids.has(e.id)) }; }
    case "viewport.set": return { ...doc, viewport: op.viewport };
    case "document.patch": return { ...doc, ...op.patch };
  }
}
