export type WorkflowExecutionStatus =
  | "queued"
  | "running"
  | "waiting"
  | "cancel_requested"
  | "succeeded"
  | "failed"
  | "cancelled";
export type WorkflowNodeExecutionStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";
export type WorkflowSkipReason =
  "before_selection" | "condition_false" | "upstream_skipped";
export type WorkflowStepStatus = "running" | "waiting" | "succeeded" | "failed";
export type WorkflowExecutionEvent = {
  sequence: number;
  type: string;
  createdAt: string;
  nodeId?: string;
  stepKey?: string;
  data?: Record<string, unknown>;
};
export type WorkflowDurableStep = {
  key: string;
  status: WorkflowStepStatus;
  attempt: number;
  maxAttempts: number;
  input?: unknown;
  output?: unknown;
  error?: { code: string; message: string };
  wakeAt?: string;
  eventKey?: string;
  startedAt: string;
  completedAt?: string;
};
export type WorkflowNodeExecution = {
  nodeId: string;
  status: WorkflowNodeExecutionStatus;
  attempt: number;
  maxAttempts: number;
  input?: unknown;
  output?: unknown;
  error?: { code: string; message: string };
  skipReason?: WorkflowSkipReason;
  startedAt?: string;
  completedAt?: string;
  wakeAt?: string;
  eventKey?: string;
  steps: Record<string, WorkflowDurableStep>;
};
export type WorkflowExecutionState = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowExecutionStatus;
  selectedNodeIds: string[];
  layers: string[][];
  initialInputs: Record<string, unknown>;
  nodes: Record<string, WorkflowNodeExecution>;
  events: WorkflowExecutionEvent[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
