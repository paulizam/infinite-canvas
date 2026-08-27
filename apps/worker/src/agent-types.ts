export type AgentWorkerOperation =
  | { type: "run.start"; plan?: unknown }
  | { type: "event.append"; eventType: string; data: Record<string, unknown> }
  | {
      type: "subtask.upsert";
      subtask: {
        id?: string;
        kind: string;
        title: string;
        status: "pending" | "running" | "succeeded" | "failed" | "skipped";
        input?: unknown;
        output?: unknown;
        error?: unknown;
      };
    }
  | {
      type: "result.add";
      result: {
        kind:
          | "text"
          | "image"
          | "video"
          | "audio"
          | "asset"
          | "canvas_operation"
          | "drama_item";
        payload: Record<string, unknown>;
        assetId?: string;
      };
    }
  | {
      type: "approval.request";
      action: "delete" | "batch_paid_generation" | "external_access";
      request: Record<string, unknown>;
    }
  | { type: "run.complete" }
  | { type: "run.fail"; error: { code: string; message: string } };
export type AgentWorkerRun = {
  run: {
    id: string;
    workspaceId: string;
    prompt: string;
    attachments: Array<{ assetId: string; kind: string }>;
    modelId: string | null;
    parameters: Record<string, unknown>;
    skillPolicy: Record<string, unknown>;
    attempt: number;
    maxAttempts: number;
    status: string;
  };
  events: unknown[];
  subtasks: unknown[];
  results: unknown[];
  approvals: unknown[];
};
