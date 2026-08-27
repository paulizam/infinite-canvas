export type AssetRef = { assetId: string; variant?: "original" | "preview" | (string & {}); mimeType?: string; width?: number; height?: number; durationMs?: number };
export type GenerationCapability = "text" | "image" | "video" | "audio" | "agent";
export type GenerationJobPhase = "queued" | "claimed" | "submitting" | "submitted" | "polling" | "result_ready" | "persisting" | "succeeded" | "failed" | "cancel_requested" | "cancelled" | "needs_review";
export type GenerationJob = { id: string; clientRequestId: string; capability: GenerationCapability; phase: GenerationJobPhase; attempt: number; logicalModelId: string; upstreamTaskId?: string; createdAt: string; updatedAt: string };
export type PluginPermission = "canvas:read" | "canvas:write" | "assets:read" | "assets:write" | "ai:generate" | `network:${string}`;
export type PluginManifest = { id: string; name: string; version: string; minAppVersion?: string; entry: string; integrity: string; signature?: string; permissions: PluginPermission[] };
export type WorkflowPort = { id: string; valueType: string; required?: boolean; multiple?: boolean };
export type WorkflowDefinition = { id: string; schemaVersion: number; name: string; nodes: Array<{ id: string; type: string; inputs: WorkflowPort[]; outputs: WorkflowPort[]; config: unknown }>; edges: Array<{ id: string; fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string }> };
