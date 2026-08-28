export const CANVAS_SCHEMA_VERSION = 4 as const;
export type Position = { x: number; y: number };
export type Size = { width: number; height: number };
export type ViewportTransform = { x: number; y: number; k: number };
export type CanvasNode = {
  id: string;
  type: string;
  title: string;
  position: Position;
  width: number;
  height: number;
  schemaVersion?: number;
  metadata?: Record<string, unknown>;
  pluginRef?: { id: string; version: string };
};
export type CanvasConnection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromPortId?: string;
  toPortId?: string;
};
export type CanvasDocument = {
  id: string;
  schemaVersion: typeof CANVAS_SCHEMA_VERSION;
  revision: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  chatSessions: unknown[];
  activeChatId: string | null;
  backgroundMode: "lines" | "dots" | "blank";
  showImageInfo: boolean;
  viewport: ViewportTransform;
  folderId?: string | null;
  favorite?: boolean;
  coverUrl?: string;
  lastOpenedAt?: string;
  templateId?: string;
};
export type CanvasOperation =
  | { type: "node.upsert"; node: CanvasNode }
  | { type: "node.remove"; nodeIds: string[] }
  | { type: "node.move"; nodeId: string; position: Position }
  | { type: "node.resize"; nodeId: string; size: Size }
  | { type: "connection.upsert"; connection: CanvasConnection }
  | { type: "connection.remove"; connectionIds: string[] }
  | { type: "viewport.set"; viewport: ViewportTransform }
  | {
      type: "document.sync";
      patch: Partial<
        Pick<
          CanvasDocument,
          | "nodes"
          | "connections"
          | "chatSessions"
          | "activeChatId"
          | "backgroundMode"
          | "showImageInfo"
          | "viewport"
        >
      >;
    }
  | {
      type: "document.patch";
      patch: Partial<
        Pick<
          CanvasDocument,
          | "title"
          | "backgroundMode"
          | "showImageInfo"
          | "activeChatId"
          | "folderId"
          | "favorite"
          | "coverUrl"
          | "lastOpenedAt"
          | "templateId"
        >
      >;
    };
export type CanvasMutation = {
  mutationId: string;
  projectId: string;
  baseRevision: number;
  operations: CanvasOperation[];
  clientId: string;
  createdAt: string;
};
