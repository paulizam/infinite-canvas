import {
  CANVAS_SCHEMA_VERSION,
  type CanvasDocument,
} from "@infinite-canvas/contracts";
type Legacy = Partial<CanvasDocument> & { id?: string };
export function migrateCanvasDocument(
  input: Legacy,
  now = new Date().toISOString(),
): CanvasDocument {
  if (!input?.id) throw new Error("Canvas document id is required");
  return {
    id: input.id,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision:
      Number.isInteger(input.revision) && input.revision! >= 0
        ? input.revision!
        : 0,
    title: input.title?.trim() || "Untitled",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    nodes: Array.isArray(input.nodes)
      ? input.nodes.map((n) => ({ ...n, schemaVersion: n.schemaVersion || 1 }))
      : [],
    connections: Array.isArray(input.connections) ? input.connections : [],
    chatSessions: Array.isArray(input.chatSessions) ? input.chatSessions : [],
    activeChatId: input.activeChatId || null,
    backgroundMode: input.backgroundMode || "lines",
    showImageInfo: input.showImageInfo || false,
    viewport: input.viewport || { x: 0, y: 0, k: 1 },
    folderId:
      typeof input.folderId === "string" && input.folderId.trim()
        ? input.folderId.trim()
        : null,
    favorite: Boolean(input.favorite),
    coverUrl: normalizeCoverUrl(input.coverUrl),
    lastOpenedAt: input.lastOpenedAt || input.updatedAt || now,
    templateId:
      typeof input.templateId === "string" && input.templateId.trim()
        ? input.templateId.trim()
        : undefined,
  };
}

function normalizeCoverUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  return /^(?:https?:\/\/|data:image\/|blob:|\/)/i.test(url) ? url : undefined;
}
