import type { CanvasDocument } from "./canvas.js";

export const AGENT_TOOL_CONTRACT_VERSION = 1 as const;

/** Local Canvas Agent 与远端团队 Agent 必须保持兼容的核心工具名。 */
export const agentCoreToolNames = [
  "canvas_get_state",
  "canvas_apply_ops",
] as const;

export type AgentCoreToolName = (typeof agentCoreToolNames)[number];
export type AgentToolDefinition = {
  name: AgentCoreToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffect: "read" | "write";
  approval?: "delete";
};

export type AgentCanvasToolOperation =
  | {
      type: "add_node";
      nodeType?: string;
      id?: string;
      title?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      position?: { x: number; y: number };
      metadata?: Record<string, unknown>;
    }
  | {
      type: "update_node";
      id: string;
      patch?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  | { type: "delete_node"; id?: string; ids?: string[] }
  | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
  | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
  | { type: "set_viewport"; viewport: { x: number; y: number; k: number } }
  | { type: "select_nodes"; ids: string[] }
  | {
      type: "run_generation";
      nodeId: string;
      mode?: "text" | "image" | "video" | "audio";
      prompt?: string;
    };

export const agentCoreTools: readonly AgentToolDefinition[] = [
  {
    name: "canvas_get_state",
    description: "Read the bound canvas snapshot.",
    inputSchema: { type: "object", additionalProperties: false },
    sideEffect: "read",
  },
  {
    name: "canvas_apply_ops",
    description: "Apply Canvas Agent operations to the bound project.",
    inputSchema: {
      type: "object",
      required: ["ops"],
      properties: { ops: { type: "array", minItems: 1, maxItems: 200 } },
      additionalProperties: false,
    },
    sideEffect: "write",
    approval: "delete",
  },
] as const;

export type AgentToolContext = {
  contractVersion: typeof AGENT_TOOL_CONTRACT_VERSION;
  project: { id: string; revision: number; document: CanvasDocument } | null;
  selection: string[];
  assets: Array<{
    id: string;
    kind: string;
    mimeType: string;
    bytes: number;
    originalName: string;
  }>;
};

export type AgentRemoteToolCall = {
  id: string;
  name: "canvas_apply_ops";
  input: { ops: AgentCanvasToolOperation[] };
  expectedRevision: number;
};

export type AgentRemoteResult = {
  id: string;
  kind: "text" | "image" | "video" | "audio" | "asset" | "drama_item";
  payload: Record<string, unknown>;
  assetId?: string;
};

export type RemoteAgentTurnRequest = {
  contractVersion: typeof AGENT_TOOL_CONTRACT_VERSION;
  idempotencyKey: string;
  run: {
    id: string;
    workspaceId: string;
    prompt: string;
    attachments: Array<{ assetId: string; kind: string }>;
    modelId: string | null;
    parameters: Record<string, unknown>;
    skillPolicy: Record<string, unknown>;
    attempt: number;
  };
  context: AgentToolContext;
  tools: readonly AgentToolDefinition[];
  approvals: Array<{ action: string; status: string }>;
};

export type RemoteAgentTurnResponse = {
  plan?: { steps: Array<{ id: string; title: string }> };
  events?: Array<{
    type: "status" | "output.delta" | "tool.started" | "tool.completed";
    data: Record<string, unknown>;
  }>;
  toolCalls?: AgentRemoteToolCall[];
  results?: AgentRemoteResult[];
  approval?: {
    action: "delete" | "batch_paid_generation" | "external_access";
    request: Record<string, unknown>;
  };
  finalText?: string;
  done?: boolean;
};
