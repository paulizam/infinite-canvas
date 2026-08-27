import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import type { WorkflowExecutionState } from "@infinite-canvas/workflow-runtime";

export type WorkflowWorkerRecord = {
  state: WorkflowExecutionState;
  definition: WorkflowDefinition;
  revision: number;
  workspaceId: string;
  createdBy: string;
  workerId: string | null;
  leaseUntil: string | null;
  nextRunAt: string;
};
export type WorkflowWorkerOperation =
  | { type: "node.start"; nodeId: string; input?: unknown }
  | { type: "node.complete"; nodeId: string; output?: unknown }
  | {
      type: "node.fail";
      nodeId: string;
      error: { code: string; message: string };
      retryAt?: string;
    }
  | { type: "node.wait"; nodeId: string; wakeAt?: string; eventKey?: string }
  | {
      type: "node.skip";
      nodeId: string;
      reason: "condition_false" | "upstream_skipped";
    }
  | {
      type: "step.start";
      nodeId: string;
      key: string;
      input?: unknown;
      maxAttempts?: number;
    }
  | { type: "step.complete"; nodeId: string; key: string; output?: unknown }
  | {
      type: "step.fail";
      nodeId: string;
      key: string;
      error: { code: string; message: string };
      retryAt?: string;
    }
  | {
      type: "step.wait";
      nodeId: string;
      key: string;
      wakeAt?: string;
      eventKey?: string;
    }
  | { type: "execution.cancel.complete" };
