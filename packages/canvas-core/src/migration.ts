import { CANVAS_SCHEMA_VERSION, type CanvasDocument } from "@infinite-canvas/contracts";
type Legacy = Partial<CanvasDocument> & { id?: string };
export function migrateCanvasDocument(input: Legacy, now = new Date().toISOString()): CanvasDocument {
  if (!input?.id) throw new Error("Canvas document id is required");
  return { id: input.id, schemaVersion: CANVAS_SCHEMA_VERSION, revision: Number.isInteger(input.revision) && input.revision! >= 0 ? input.revision! : 0, title: input.title?.trim() || "Untitled", createdAt: input.createdAt || now, updatedAt: input.updatedAt || now, nodes: Array.isArray(input.nodes) ? input.nodes.map(n => ({ ...n, schemaVersion: n.schemaVersion || 1 })) : [], connections: Array.isArray(input.connections) ? input.connections : [], chatSessions: Array.isArray(input.chatSessions) ? input.chatSessions : [], activeChatId: input.activeChatId || null, backgroundMode: input.backgroundMode || "lines", showImageInfo: input.showImageInfo || false, viewport: input.viewport || { x: 0, y: 0, k: 1 } };
}
