export type AssetRef = {
  assetId: string;
  variant?: "original" | "preview" | (string & {});
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
};
export type GenerationCapability =
  "text" | "image" | "video" | "audio" | "agent";
export type GenerationJobPhase =
  | "queued"
  | "claimed"
  | "submitting"
  | "submitted"
  | "polling"
  | "result_ready"
  | "persisting"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "needs_review";
export type GenerationJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needs_review";
export type GenerationEventType =
  "job.snapshot" | "text.delta" | "text.reasoning.delta" | "job.terminal";
export type GenerationEvent = {
  id: number;
  jobId: string;
  type: GenerationEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};
export type GenerationJob = {
  id: string;
  workspaceId: string;
  ownerId: string;
  clientRequestId: string;
  capability: GenerationCapability;
  status: GenerationJobStatus;
  phase: GenerationJobPhase;
  attempt: number;
  retryOf: string | null;
  logicalModelId: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  upstreamTaskId: string | null;
  provider: string | null;
  channelId: string | null;
  workerId: string | null;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
  nextRunAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  billing: {
    state: "free" | "reserved" | "settled" | "refunded" | "needs_review";
    estimatedUnits: number;
    reservedUnits: number;
    actualUnits: number | null;
  };
  createdAt: string;
  updatedAt: string;
};
export type BillingEstimate = {
  logicalModelId: string;
  capability: GenerationCapability;
  estimatedUnits: number;
  baseUnits: number;
  multiplierPermille: number;
  currency: "points";
};
export type BillingWallet = {
  userId: string;
  balanceUnits: number;
  updatedAt: string;
};
export type BillingLedgerEntry = {
  id: string;
  userId: string;
  jobId: string | null;
  type: "reserve" | "settle" | "refund" | "adjustment";
  amountUnits: number;
  balanceAfterUnits: number;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
export type PluginPermission =
  | "canvas:read"
  | "canvas:write"
  | "assets:read"
  | "assets:write"
  | "ai:generate"
  | `network:${string}`;
export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  entry: string;
  integrity: string;
  signature?: string;
  permissions: PluginPermission[];
};
export type WorkflowPort = {
  id: string;
  valueType: string;
  required?: boolean;
  multiple?: boolean;
};
export type WorkflowNodeDefinition = {
  id: string;
  type: string;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  config: unknown;
  requiredCapabilities?: string[];
  credentialRefs?: string[];
};
export type WorkflowNodeSchema = {
  type: string;
  schemaVersion: number;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  configSchema?: Record<string, unknown>;
  requiredCapabilities?: string[];
  credentialSlots?: string[];
};
export type WorkflowEdge = {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
};
export type WorkflowDefinition = {
  id: string;
  schemaVersion: number;
  name: string;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdge[];
  entryNodeIds?: string[];
};
